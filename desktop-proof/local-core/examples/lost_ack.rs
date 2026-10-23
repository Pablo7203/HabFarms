use habfarms_desktop_local_proof::Workspace;
use serde_json::{json, Value};
use std::{env, error::Error, path::PathBuf};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
fn required(name: &str) -> Result<String> {
    Ok(env::var(name)?)
}

fn submit(payload: &str) -> Result<Value> {
    let operation: Value = serde_json::from_str(payload)?;
    let body = json!({
        "p_schema_version": operation["schemaVersion"],
        "p_operation_type": operation["operationType"],
        "p_operation_id": operation["operationId"],
        "p_farm_id": operation["farmId"],
        "p_flock_id": operation["flockId"],
        "p_event_date": operation["eventDate"],
        "p_quantity": operation["payload"]["quantity"],
        "p_notes": operation["payload"]["notes"],
        "p_created_at_local": operation["createdAtLocal"],
        "p_queued_at_local": operation["queuedAtLocal"],
        "p_dependencies": operation["dependencies"],
    });
    let base = required("LOCAL_API_URL")?;
    if base != "http://127.0.0.1:60421" {
        return Err("Local proof API mismatch".into());
    }
    let result = ureq::post(&format!(
        "{base}/rest/v1/rpc/desktop_proof_submit_mortality_v1"
    ))
    .set("apikey", &required("LOCAL_ANON_KEY")?)
    .set(
        "Authorization",
        &format!("Bearer {}", required("PROOF_ACCESS_TOKEN")?),
    )
    .set("x-habfarms-active-farm", &required("PROOF_FARM")?)
    .send_json(body)?;
    Ok(result.into_json()?)
}

fn main() -> Result<()> {
    let stage = env::args().nth(1).ok_or("Stage required")?;
    let root = PathBuf::from(required("PROOF_ROOT")?);
    let user = required("PROOF_USER")?;
    let farm = required("PROOF_FARM")?;
    let operation_id = required("PROOF_OPERATION")?;
    let mut db = Workspace::open(
        &root,
        "proof-installation-1",
        &user,
        &farm,
        &required("PROOF_PIN")?,
    )?;
    match stage.as_str() {
        "prepare" => {
            let notes = if env::var("PROOF_RETRY_ONCE").as_deref() == Ok("1") {
                "Synthetic retry once"
            } else {
                "Synthetic lost acknowledgement"
            };
            let payload = json!({
                "schemaVersion": 1, "operationType": "MORTALITY_V1",
                "operationId": operation_id, "farmId": farm, "flockId": required("PROOF_FLOCK")?,
                "eventDate": "2026-10-20", "createdAtLocal": "2026-10-20T12:00:00Z",
                "queuedAtLocal": "2026-10-20T12:00:01Z", "dependencies": [],
                "payload": { "quantity": 5, "notes": notes }
            });
            db.save_farm_snapshot(&farm, "Synthetic Encrypted Farm A")?;
            db.save_draft(&operation_id, &farm, &payload.to_string())?;
            db.queue(&operation_id)?;
            println!("PREPARED encrypted pending operation");
        }
        "lost" => {
            let (state, payload, _) = db.operation(&operation_id)?;
            if state != "PENDING_SYNC" {
                return Err("Operation not pending".into());
            }
            db.mark_syncing(&operation_id)?;
            let receipt = submit(&payload)?;
            if receipt["code"] != "SUCCESS" {
                return Err("First commit failed".into());
            }
            // Deliberately discard the successful response, leaving local state unresolved.
            println!("LOST_ACK server committed; local receipt deliberately discarded");
        }
        "retryable" => {
            let (state, payload, _) = db.operation(&operation_id)?;
            if state != "PENDING_SYNC" {
                return Err("Operation not pending before retryable response".into());
            }
            db.mark_syncing(&operation_id)?;
            let response = submit(&payload)?;
            if response["code"] != "RETRYABLE_FAILURE" {
                return Err("Expected controlled server retryable response".into());
            }
            println!("RETRYABLE server response left encrypted operation unresolved");
        }
        "retry" => {
            let (state, payload, _) = db.operation(&operation_id)?;
            if state != "PENDING_SYNC" {
                return Err("Crash recovery did not restore pending state".into());
            }
            db.mark_syncing(&operation_id)?;
            let receipt = submit(&payload)?;
            if receipt["code"] != "ALREADY_SYNCED" {
                return Err("Retry did not return prior receipt".into());
            }
            db.save_receipt(&operation_id, &receipt.to_string())?;
            if db.operation(&operation_id)?.0 != "SYNCED" {
                return Err("Receipt not persisted".into());
            }
            println!("RETRIED original receipt stored in encrypted workspace");
        }
        "verify" => {
            let (state, _, receipt) = db.operation(&operation_id)?;
            if state != "SYNCED" || receipt.as_deref().unwrap_or("").is_empty() {
                return Err("Receipt did not survive restart".into());
            }
            println!("VERIFIED encrypted receipt survived restart");
        }
        "reject" => {
            let (state, payload, _) = db.operation(&operation_id)?;
            if state != "PENDING_SYNC" {
                return Err("Rejected operation not pending".into());
            }
            db.mark_syncing(&operation_id)?;
            match submit(&payload) {
                Err(error)
                    if matches!(
                        error.downcast_ref::<ureq::Error>(),
                        Some(ureq::Error::Status(401 | 403, _))
                    ) =>
                {
                    db.mark_needs_attention(&operation_id, "AUTHORIZATION_FAILED")?;
                    println!("REJECTED current authorization; original operation retained");
                }
                _ => return Err("Expected current authorization rejection".into()),
            }
        }
        "verify-rejected" => {
            let (state, payload, _) = db.operation(&operation_id)?;
            if state != "NEEDS_ATTENTION"
                || payload.is_empty()
                || db.error_code(&operation_id)?.as_deref() != Some("AUTHORIZATION_FAILED")
            {
                return Err("Rejected operation was not preserved".into());
            }
            println!("VERIFIED rejected encrypted operation survived restart");
        }
        _ => return Err("Unknown stage".into()),
    }
    Ok(())
}
