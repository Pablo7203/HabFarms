#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use habfarms_desktop_local_proof::Workspace;
use std::sync::Mutex;
use tauri::{Manager, State};

struct Active(Mutex<Option<(String, String, Workspace)>>);

fn with_workspace<T>(
    state: State<'_, Active>,
    f: impl FnOnce(&mut Workspace) -> Result<T, String>,
) -> Result<T, String> {
    let mut locked = state.0.lock().map_err(|_| "Workspace lock unavailable")?;
    let (_, _, db) = locked.as_mut().ok_or("Open a workspace first")?;
    f(db)
}

#[tauri::command]
fn open_workspace(
    app: tauri::AppHandle,
    state: State<'_, Active>,
    user_id: String,
    farm_id: String,
    pin: String,
) -> Result<String, String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Local data path unavailable")?;
    let db = Workspace::open(&root, "proof-installation-1", &user_id, &farm_id, &pin)
        .map_err(|_| "Workspace unlock failed")?;
    *state.0.lock().map_err(|_| "Workspace lock unavailable")? = Some((user_id, farm_id, db));
    Ok("Workspace unlocked".into())
}

#[tauri::command]
fn save_snapshot(
    state: State<'_, Active>,
    farm_id: String,
    name: String,
) -> Result<String, String> {
    let mut locked = state.0.lock().map_err(|_| "Workspace lock unavailable")?;
    let (_, active_farm, db) = locked.as_mut().ok_or("Open a workspace first")?;
    if *active_farm != farm_id {
        return Err("Farm mismatch".into());
    }
    db.save_farm_snapshot(&farm_id, &name)
        .map_err(|_| "Local save failed")?;
    Ok("Encrypted snapshot committed".into())
}

#[tauri::command]
fn save_draft(
    state: State<'_, Active>,
    operation_id: String,
    farm_id: String,
    quantity: i32,
) -> Result<String, String> {
    if quantity <= 0 {
        return Err("Quantity must be positive".into());
    }
    let mut locked = state.0.lock().map_err(|_| "Workspace lock unavailable")?;
    let (_, active_farm, db) = locked.as_mut().ok_or("Open a workspace first")?;
    if *active_farm != farm_id {
        return Err("Farm mismatch".into());
    }
    db.save_draft(&operation_id, &farm_id, &format!("mortality={quantity}"))
        .map_err(|_| "Draft save failed")?;
    Ok("Draft committed".into())
}

#[tauri::command]
fn queue_operation(state: State<'_, Active>, operation_id: String) -> Result<String, String> {
    with_workspace(state, |db| {
        db.queue(&operation_id)
            .map_err(|_| "Queue commit failed".into())
    })?;
    Ok("Saved offline".into())
}

#[tauri::command]
fn read_operation(
    state: State<'_, Active>,
    operation_id: String,
) -> Result<(String, String, Option<String>), String> {
    with_workspace(state, |db| {
        db.operation(&operation_id)
            .map_err(|_| "Operation unavailable".into())
    })
}

fn main() {
    tauri::Builder::default()
        .manage(Active(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            open_workspace,
            save_snapshot,
            save_draft,
            queue_operation,
            read_operation
        ])
        .run(tauri::generate_context!())
        .expect("Tauri proof failed");
}
