#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use habfarms_desktop_local::{
    read_local_farms, record_local_farm, verify_lease, LocalFarm, LocalOperation, PreparedSnapshot,
    Workspace,
};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{Manager, State};

struct OpenFarm {
    device: String,
    user: String,
    farm: String,
    db: Workspace,
}
struct Active(Mutex<Option<OpenFarm>>);

fn data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|_| "Local data unavailable".into())
}
fn installation_id(root: &PathBuf) -> Result<String, String> {
    fs::create_dir_all(root).map_err(|_| "Local data unavailable")?;
    let file = root.join("installation-id");
    if !file.exists() {
        let id = uuid::Uuid::new_v4().to_string();
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&file)
        {
            Ok(mut output) => {
                use std::io::Write;
                output
                    .write_all(id.as_bytes())
                    .map_err(|_| "Local data unavailable")?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(_) => return Err("Local data unavailable".into()),
        }
    }
    let id = fs::read_to_string(file).map_err(|_| "Local data unavailable")?;
    uuid::Uuid::parse_str(id.trim()).map_err(|_| "Installation identity unavailable")?;
    Ok(id.trim().to_owned())
}
#[tauri::command]
fn get_installation_id(app: tauri::AppHandle) -> Result<String, String> {
    installation_id(&data_root(&app)?)
}

#[tauri::command]
fn list_local_farms(
    app: tauri::AppHandle,
    email: String,
    pin: String,
) -> Result<Vec<LocalFarm>, String> {
    let root = data_root(&app)?;
    let device = installation_id(&root)?;
    read_local_farms(&root, &device, &email, &pin)
        .map_err(|_| "No prepared farms found or unlock details are incorrect".into())
}
#[tauri::command]
fn prepare_workspace(
    app: tauri::AppHandle,
    state: State<'_, Active>,
    email: String,
    pin: String,
    user_id: String,
    farm_id: String,
    snapshot_json: String,
    claims_json: String,
    signature_b64: String,
) -> Result<PreparedSnapshot, String> {
    let root = data_root(&app)?;
    let device = installation_id(&root)?;
    verify_lease(
        &claims_json,
        &signature_b64,
        &device,
        &user_id,
        &farm_id,
        &snapshot_json,
    )
    .map_err(|_| "Farm preparation could not be verified")?;
    let snapshot: serde_json::Value =
        serde_json::from_str(&snapshot_json).map_err(|_| "Farm information is invalid")?;
    let farm_name = snapshot
        .get("farm")
        .and_then(|v| v.get("name"))
        .and_then(|v| v.as_str())
        .ok_or("Farm information is incomplete")?
        .to_owned();
    let mut db = Workspace::open(&root, &device, &user_id, &farm_id, &pin)
        .map_err(|_| "Workspace could not be unlocked")?;
    db.store_bootstrap(
        &device,
        &user_id,
        &farm_id,
        &snapshot_json,
        &claims_json,
        &signature_b64,
    )
    .map_err(|_| "Farm preparation could not be saved")?;
    record_local_farm(
        &root,
        &device,
        &email,
        &pin,
        LocalFarm {
            user_id: user_id.clone(),
            farm_id: farm_id.clone(),
            farm_name,
        },
    )
    .map_err(|_| "Local farm list could not be saved")?;
    let prepared = db
        .read_prepared(&device, &user_id, &farm_id)
        .map_err(|_| "Prepared farm unavailable")?;
    *state.0.lock().map_err(|_| "Workspace unavailable")? = Some(OpenFarm {
        device,
        user: user_id,
        farm: farm_id,
        db,
    });
    Ok(prepared)
}
#[tauri::command]
fn unlock_workspace(
    app: tauri::AppHandle,
    state: State<'_, Active>,
    email: String,
    pin: String,
    farm_id: String,
) -> Result<PreparedSnapshot, String> {
    let root = data_root(&app)?;
    let device = installation_id(&root)?;
    let farms = read_local_farms(&root, &device, &email, &pin)
        .map_err(|_| "Workspace cannot be unlocked")?;
    let selected = farms
        .iter()
        .find(|f| f.farm_id == farm_id)
        .ok_or("Prepared farm not found")?;
    let mut db = Workspace::open_existing(&root, &device, &selected.user_id, &farm_id, &pin)
        .map_err(|_| "Workspace cannot be unlocked")?;
    let prepared = db
        .read_prepared(&device, &selected.user_id, &farm_id)
        .map_err(|_| "Prepared farm cannot be verified")?;
    *state.0.lock().map_err(|_| "Workspace unavailable")? = Some(OpenFarm {
        device,
        user: selected.user_id.clone(),
        farm: farm_id,
        db,
    });
    Ok(prepared)
}
#[tauri::command]
fn get_local_farm_snapshot(state: State<'_, Active>) -> Result<PreparedSnapshot, String> {
    let mut active = state.0.lock().map_err(|_| "Workspace unavailable")?;
    let current = active.as_mut().ok_or("Unlock a workspace first")?;
    current
        .db
        .read_prepared(&current.device, &current.user, &current.farm)
        .map_err(|_| "Prepared farm cannot be verified".into())
}
#[tauri::command]
fn lock_workspace(state: State<'_, Active>) -> Result<(), String> {
    *state.0.lock().map_err(|_| "Workspace unavailable")? = None;
    Ok(())
}
#[tauri::command]
fn list_local_operations(state: State<'_, Active>) -> Result<Vec<LocalOperation>, String> {
    let active = state.0.lock().map_err(|_| "Workspace unavailable")?;
    let current = active.as_ref().ok_or("Unlock a workspace first")?;
    current
        .db
        .list_local_operations(&current.farm)
        .map_err(|_| "Local entries could not be read".into())
}
#[tauri::command]
fn save_local_draft(state: State<'_, Active>, operation_json: String) -> Result<(), String> {
    let mut active = state.0.lock().map_err(|_| "Workspace unavailable")?;
    let current = active.as_mut().ok_or("Unlock a workspace first")?;
    let prepared = current
        .db
        .read_prepared(&current.device, &current.user, &current.farm)
        .map_err(|_| "Prepared farm cannot be verified")?;
    if prepared.lease_expired {
        return Err("Offline access has expired. Reconnect to record new entries.".into());
    }
    let operation: serde_json::Value =
        serde_json::from_str(&operation_json).map_err(|_| "Invalid local entry")?;
    let capability = match operation.get("operationType").and_then(|v| v.as_str()) {
        Some("MORTALITY_V1") => "queue_mortality_v1",
        Some("DAILY_PRODUCTION_V1") => "queue_daily_production_v1",
        _ => return Err("Unsupported local entry type".into()),
    };
    if !prepared
        .operation_capabilities
        .iter()
        .any(|c| c == capability)
    {
        return Err("Reconnect and prepare this farm before recording offline entries.".into());
    }
    let workspace = format!("{}:{}:{}", current.device, current.user, current.farm);
    current
        .db
        .save_local_draft(&current.farm, &workspace, "0.1.0", &operation_json)
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn confirm_local_operation(state: State<'_, Active>, operation_id: String) -> Result<(), String> {
    let mut active = state.0.lock().map_err(|_| "Workspace unavailable")?;
    let current = active.as_mut().ok_or("Unlock a workspace first")?;
    let prepared = current
        .db
        .read_prepared(&current.device, &current.user, &current.farm)
        .map_err(|_| "Prepared farm cannot be verified")?;
    current
        .db
        .confirm_local_operation(
            &operation_id,
            &current.farm,
            &prepared.operation_capabilities,
            prepared.lease_expired,
        )
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn mark_local_operation_syncing(
    state: State<'_, Active>,
    operation_id: String,
) -> Result<(), String> {
    let mut active = state.0.lock().map_err(|_| "Workspace unavailable")?;
    let current = active.as_mut().ok_or("Unlock a workspace first")?;
    current
        .db
        .mark_local_operation_syncing(&operation_id, &current.farm)
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn save_local_sync_receipt(
    state: State<'_, Active>,
    operation_id: String,
    receipt_json: String,
) -> Result<(), String> {
    let mut active = state.0.lock().map_err(|_| "Workspace unavailable")?;
    let current = active.as_mut().ok_or("Unlock a workspace first")?;
    current
        .db
        .save_local_sync_receipt(&operation_id, &current.farm, &receipt_json)
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn mark_local_needs_attention(
    state: State<'_, Active>,
    operation_id: String,
    code: String,
) -> Result<(), String> {
    let mut active = state.0.lock().map_err(|_| "Workspace unavailable")?;
    let current = active.as_mut().ok_or("Unlock a workspace first")?;
    current
        .db
        .mark_local_needs_attention(&operation_id, &current.farm, &code)
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn restore_local_pending(state: State<'_, Active>, operation_id: String) -> Result<(), String> {
    let mut active = state.0.lock().map_err(|_| "Workspace unavailable")?;
    let current = active.as_mut().ok_or("Unlock a workspace first")?;
    current
        .db
        .restore_local_pending(&operation_id, &current.farm)
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn refresh_workspace_snapshot(
    state: State<'_, Active>,
    snapshot_json: String,
    claims_json: String,
    signature_b64: String,
) -> Result<PreparedSnapshot, String> {
    let mut active = state.0.lock().map_err(|_| "Workspace unavailable")?;
    let current = active.as_mut().ok_or("Unlock a workspace first")?;
    current
        .db
        .store_bootstrap(
            &current.device,
            &current.user,
            &current.farm,
            &snapshot_json,
            &claims_json,
            &signature_b64,
        )
        .map_err(|_| "Canonical farm refresh could not be verified".to_string())?;
    current
        .db
        .read_prepared(&current.device, &current.user, &current.farm)
        .map_err(|_| "Canonical farm refresh could not be opened".to_string())
}

#[tauri::command]
fn discard_local_draft(state: State<'_, Active>, operation_id: String) -> Result<(), String> {
    let mut active = state.0.lock().map_err(|_| "Workspace unavailable")?;
    let current = active.as_mut().ok_or("Unlock a workspace first")?;
    current
        .db
        .discard_local_draft(&operation_id, &current.farm)
        .map_err(|_| "Only editable drafts can be discarded".into())
}
fn main() {
    tauri::Builder::default()
        .manage(Active(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_installation_id,
            list_local_farms,
            prepare_workspace,
            unlock_workspace,
            get_local_farm_snapshot,
            lock_workspace,
            list_local_operations,
            save_local_draft,
            confirm_local_operation,
            mark_local_operation_syncing,
            save_local_sync_receipt,
            mark_local_needs_attention,
            restore_local_pending,
            refresh_workspace_snapshot,
            discard_local_draft
        ])
        .run(tauri::generate_context!())
        .expect("HabFarms Desktop failed to start");
}
