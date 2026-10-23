#![cfg(windows)]

use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::{DateTime, Utc};
use openssl::{pkey::PKey, sign::Verifier};
use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    error::Error,
    fs,
    path::{Path, PathBuf},
};
use windows_sys::Win32::{
    Foundation::LocalFree,
    Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    },
};
use zeroize::Zeroize;

type Result<T> = std::result::Result<T, Box<dyn Error>>;

pub struct Workspace {
    db: Connection,
    pub database_path: PathBuf,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaseClaims {
    pub version: u32,
    pub key_id: String,
    pub user_id: String,
    pub farm_id: String,
    pub installation_id: String,
    pub issued_at: String,
    pub expires_at: String,
    pub local_schema_min: u32,
    pub local_schema_max: u32,
    pub capabilities: Vec<String>,
    pub snapshot_sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedSnapshot {
    pub snapshot_json: String,
    pub synchronized_at: String,
    pub expires_at: String,
    pub lease_expired: bool,
    pub operation_capabilities: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalOperation {
    pub operation_json: String,
    pub state: String,
    pub server_receipt_json: Option<String>,
    pub sync_error_code: Option<String>,
    pub synced_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalFarm {
    pub user_id: String,
    pub farm_id: String,
    pub farm_name: String,
}

fn index_path(root: &Path, device: &str, email: &str) -> PathBuf {
    root.join(format!(
        "{}.index",
        hex::encode(Sha256::digest(
            format!("{device}\0{}", email.trim().to_lowercase()).as_bytes()
        ))
    ))
}

fn index_entropy(pin: &str, salt: &[u8]) -> Result<[u8; 32]> {
    if pin.len() < 8 {
        return Err("Offline unlock secret is too short".into());
    }
    let mut entropy = [0u8; 32];
    Argon2::default()
        .hash_password_into(pin.as_bytes(), salt, &mut entropy)
        .map_err(|_| "Unlock derivation failed")?;
    Ok(entropy)
}

pub fn read_local_farms(
    root: &Path,
    device: &str,
    email: &str,
    pin: &str,
) -> Result<Vec<LocalFarm>> {
    let envelope = fs::read(index_path(root, device, email))?;
    if envelope.len() < 17 {
        return Err("Invalid local account index".into());
    }
    let mut entropy = index_entropy(pin, &envelope[..16])?;
    let plaintext = dpapi(&envelope[16..], &entropy, false);
    entropy.zeroize();
    Ok(serde_json::from_slice(&plaintext?)?)
}

pub fn record_local_farm(
    root: &Path,
    device: &str,
    email: &str,
    pin: &str,
    farm: LocalFarm,
) -> Result<()> {
    fs::create_dir_all(root)?;
    let path = index_path(root, device, email);
    let mut farms = if path.exists() {
        read_local_farms(root, device, email, pin)?
    } else {
        Vec::new()
    };
    if let Some(existing) = farms.iter_mut().find(|f| f.farm_id == farm.farm_id) {
        *existing = farm;
    } else {
        farms.push(farm);
    }
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    let mut entropy = index_entropy(pin, &salt)?;
    let mut payload = serde_json::to_vec(&farms)?;
    let encrypted = dpapi(&payload, &entropy, true)?;
    payload.zeroize();
    entropy.zeroize();
    let mut envelope = salt.to_vec();
    envelope.extend(encrypted);
    let temporary = path.with_extension("index.tmp");
    fs::write(&temporary, envelope)?;
    fs::rename(&temporary, &path)?;
    Ok(())
}

pub fn verify_lease(
    claims_json: &str,
    signature_b64: &str,
    device: &str,
    user: &str,
    farm: &str,
    snapshot_json: &str,
) -> Result<LeaseClaims> {
    let public_der = STANDARD.decode(include_str!("../../src/lease-public-key.b64").trim())?;
    verify_lease_with_key(
        &public_der,
        claims_json,
        signature_b64,
        device,
        user,
        farm,
        snapshot_json,
    )
}

fn verify_lease_with_key(
    public_der: &[u8],
    claims_json: &str,
    signature_b64: &str,
    device: &str,
    user: &str,
    farm: &str,
    snapshot_json: &str,
) -> Result<LeaseClaims> {
    let key = PKey::public_key_from_der(public_der)?;
    let mut verifier = Verifier::new_without_digest(&key)?;
    if !verifier.verify_oneshot(&STANDARD.decode(signature_b64)?, claims_json.as_bytes())? {
        return Err("Invalid offline lease signature".into());
    }
    let claims: LeaseClaims = serde_json::from_str(claims_json)?;
    if claims.version != 1
        || claims.key_id != "development-2026-10"
        || claims.user_id != user
        || claims.farm_id != farm
        || claims.installation_id != device
        || claims.local_schema_min > 4
        || claims.local_schema_max < 2
        || !claims.capabilities.iter().any(|c| c == "snapshot_read")
    {
        return Err("Offline lease does not match this workspace".into());
    }
    let issued = DateTime::parse_from_rfc3339(&claims.issued_at)?.with_timezone(&Utc);
    let expires = DateTime::parse_from_rfc3339(&claims.expires_at)?.with_timezone(&Utc);
    let now = Utc::now();
    if issued > now + chrono::Duration::minutes(5)
        || expires <= issued
        || expires > issued + chrono::Duration::days(7)
    {
        return Err("Invalid offline lease time window".into());
    }
    if hex::encode(Sha256::digest(snapshot_json.as_bytes())) != claims.snapshot_sha256 {
        return Err("Offline snapshot does not match lease".into());
    }
    let snapshot: serde_json::Value = serde_json::from_str(snapshot_json)?;
    if snapshot.get("farmId").and_then(|v| v.as_str()) != Some(farm)
        || snapshot.get("userId").and_then(|v| v.as_str()) != Some(user)
        || snapshot.get("schemaVersion").and_then(|v| v.as_u64()) != Some(2)
    {
        return Err("Offline snapshot identity mismatch".into());
    }
    Ok(claims)
}

fn dpapi(input: &[u8], entropy: &[u8], protect: bool) -> Result<Vec<u8>> {
    let data = CRYPT_INTEGER_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_ptr() as *mut u8,
    };
    let entropy_blob = CRYPT_INTEGER_BLOB {
        cbData: entropy.len() as u32,
        pbData: entropy.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let success = unsafe {
        if protect {
            CryptProtectData(
                &data,
                std::ptr::null(),
                &entropy_blob,
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &data,
                std::ptr::null_mut(),
                &entropy_blob,
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if success == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let bytes =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData as *mut core::ffi::c_void);
    }
    Ok(bytes)
}

fn paths(root: &Path, device: &str, user: &str, farm: &str) -> (PathBuf, PathBuf) {
    let digest = Sha256::digest(format!("{device}\0{user}\0{farm}").as_bytes());
    let stem = hex::encode(digest);
    (
        root.join(format!("{stem}.sqlite")),
        root.join(format!("{stem}.key")),
    )
}

impl Workspace {
    pub fn open_existing(
        root: &Path,
        device: &str,
        user: &str,
        farm: &str,
        pin: &str,
    ) -> Result<Self> {
        let (database, key) = paths(root, device, user, farm);
        if !database.exists() || !key.exists() {
            return Err("Workspace has not been prepared".into());
        }
        Self::open(root, device, user, farm, pin)
    }
    pub fn open(root: &Path, device: &str, user: &str, farm: &str, pin: &str) -> Result<Self> {
        if device.is_empty() || user.is_empty() || farm.is_empty() || pin.len() < 8 {
            return Err("Invalid workspace identity or unlock secret".into());
        }
        fs::create_dir_all(root)?;
        let (database_path, key_path) = paths(root, device, user, farm);
        let mut key = [0u8; 32];
        if key_path.exists() {
            let envelope = fs::read(&key_path)?;
            if envelope.len() < 17 {
                return Err("Invalid key envelope".into());
            }
            let mut entropy = [0u8; 32];
            Argon2::default()
                .hash_password_into(pin.as_bytes(), &envelope[..16], &mut entropy)
                .map_err(|_| "Unlock derivation failed")?;
            let unwrapped = dpapi(&envelope[16..], &entropy, false);
            entropy.zeroize();
            let mut unwrapped = unwrapped.map_err(|_| "Workspace unlock denied")?;
            if unwrapped.len() != 32 {
                return Err("Invalid workspace key".into());
            }
            key.copy_from_slice(&unwrapped);
            unwrapped.zeroize();
        } else {
            if database_path.exists() {
                return Err("Workspace key missing; refusing to replace it".into());
            }
            rand::thread_rng().fill_bytes(&mut key);
            let mut salt = [0u8; 16];
            rand::thread_rng().fill_bytes(&mut salt);
            let mut entropy = [0u8; 32];
            Argon2::default()
                .hash_password_into(pin.as_bytes(), &salt, &mut entropy)
                .map_err(|_| "Unlock derivation failed")?;
            let wrapped = dpapi(&key, &entropy, true)?;
            entropy.zeroize();
            let mut envelope = salt.to_vec();
            envelope.extend(wrapped);
            fs::write(&key_path, envelope)?;
        }
        let db = Connection::open(&database_path)?;
        db.pragma_update(None, "key", format!("x'{}'", hex::encode(key)))?;
        key.zeroize();
        let cipher_version: String = db.query_row("PRAGMA cipher_version", [], |r| r.get(0))?;
        if cipher_version.is_empty() {
            return Err("SQLite encryption unavailable".into());
        }
        let local_schema: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if local_schema > 4 {
            return Err("Workspace requires a newer desktop version".into());
        }
        db.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON;
          CREATE TABLE IF NOT EXISTS farm_snapshot(farm_id TEXT PRIMARY KEY, farm_name TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS journal(
            operation_id TEXT PRIMARY KEY, farm_id TEXT NOT NULL, payload TEXT NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('DRAFT','PENDING_SYNC','SYNCING','SYNCED','NEEDS_ATTENTION')),
            receipt TEXT, error_code TEXT);")?;
        let has_error_code = db
            .prepare("PRAGMA table_info(journal)")?
            .query_map([], |r| r.get::<_, String>(1))?
            .collect::<std::result::Result<Vec<_>, _>>()?
            .iter()
            .any(|name| name == "error_code");
        if !has_error_code && local_schema == 0 {
            db.execute_batch("ALTER TABLE journal ADD COLUMN error_code TEXT")?;
        } else if !has_error_code {
            return Err("Workspace schema is inconsistent".into());
        }
        if local_schema == 0 {
            db.execute_batch("PRAGMA user_version=1")?;
        }
        if local_schema < 2 {
            db.execute_batch("BEGIN IMMEDIATE;
              CREATE TABLE IF NOT EXISTS prepared_snapshot(id INTEGER PRIMARY KEY CHECK(id=1), snapshot_json TEXT NOT NULL,
                claims_json TEXT NOT NULL, signature_b64 TEXT NOT NULL, synchronized_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
              PRAGMA user_version=2; COMMIT;")?;
        }
        if local_schema < 3 {
            db.execute_batch("BEGIN IMMEDIATE;
              CREATE TABLE IF NOT EXISTS local_operations(
                operation_id TEXT PRIMARY KEY, farm_id TEXT NOT NULL, flock_id TEXT NOT NULL,
                operation_type TEXT NOT NULL CHECK(operation_type IN ('MORTALITY_V1','DAILY_PRODUCTION_V1')),
                event_date TEXT NOT NULL, created_at_local TEXT NOT NULL, queued_at_local TEXT NOT NULL,
                payload_json TEXT NOT NULL, operation_json TEXT NOT NULL,
                local_workspace_identity TEXT NOT NULL, app_version TEXT NOT NULL,
                state TEXT NOT NULL CHECK(state IN ('DRAFT','PENDING_SYNC','SYNCING','SYNCED','NEEDS_ATTENTION')),
                created_order INTEGER NOT NULL DEFAULT (unixepoch()));
              CREATE INDEX IF NOT EXISTS local_operations_farm_state_date
                ON local_operations(farm_id,state,event_date,created_order);
              PRAGMA user_version=3; COMMIT;")?;
        }
        if local_schema < 4 {
            db.execute_batch("BEGIN IMMEDIATE;
              ALTER TABLE local_operations ADD COLUMN server_receipt_json TEXT;
              ALTER TABLE local_operations ADD COLUMN sync_error_code TEXT;
              ALTER TABLE local_operations ADD COLUMN synced_at TEXT;
              PRAGMA user_version=4; COMMIT;")?;
        }
        db.execute_batch("UPDATE journal SET state='PENDING_SYNC' WHERE state='SYNCING';")?;
        db.execute_batch("UPDATE local_operations SET state='PENDING_SYNC' WHERE state='SYNCING';")?;
        Ok(Self { db, database_path })
    }

    pub fn store_bootstrap(
        &mut self,
        device: &str,
        user: &str,
        farm: &str,
        snapshot_json: &str,
        claims_json: &str,
        signature_b64: &str,
    ) -> Result<()> {
        let claims = verify_lease(
            claims_json,
            signature_b64,
            device,
            user,
            farm,
            snapshot_json,
        )?;
        if DateTime::parse_from_rfc3339(&claims.expires_at)?.with_timezone(&Utc) <= Utc::now() {
            return Err("Offline lease expired".into());
        }
        let synchronized_at = serde_json::from_str::<serde_json::Value>(snapshot_json)?
            .get("synchronizedAt")
            .and_then(|v| v.as_str())
            .ok_or("Snapshot timestamp missing")?
            .to_owned();
        let tx = self.db.transaction()?;
        tx.execute("INSERT INTO prepared_snapshot(id,snapshot_json,claims_json,signature_b64,synchronized_at,last_seen_at)
          VALUES(1,?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET snapshot_json=excluded.snapshot_json,
          claims_json=excluded.claims_json,signature_b64=excluded.signature_b64,
          synchronized_at=excluded.synchronized_at,last_seen_at=excluded.last_seen_at",
          params![snapshot_json, claims_json, signature_b64, synchronized_at, Utc::now().to_rfc3339()])?;
        tx.commit()?;
        Ok(())
    }

    pub fn read_prepared(
        &mut self,
        device: &str,
        user: &str,
        farm: &str,
    ) -> Result<PreparedSnapshot> {
        let (snapshot_json, claims_json, signature_b64, synchronized_at, last_seen): (String,String,String,String,String) =
            self.db.query_row("SELECT snapshot_json,claims_json,signature_b64,synchronized_at,last_seen_at FROM prepared_snapshot WHERE id=1", [],
                |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)))?;
        let claims = verify_lease(
            &claims_json,
            &signature_b64,
            device,
            user,
            farm,
            &snapshot_json,
        )?;
        let now = Utc::now();
        if DateTime::parse_from_rfc3339(&last_seen)?.with_timezone(&Utc)
            > now + chrono::Duration::minutes(5)
        {
            return Err("Device clock moved backwards; reconnect to verify access".into());
        }
        self.db.execute(
            "UPDATE prepared_snapshot SET last_seen_at=?1 WHERE id=1",
            [now.to_rfc3339()],
        )?;
        Ok(PreparedSnapshot {
            snapshot_json,
            synchronized_at,
            expires_at: claims.expires_at.clone(),
            lease_expired: DateTime::parse_from_rfc3339(&claims.expires_at)?.with_timezone(&Utc)
                <= now,
            operation_capabilities: claims.capabilities,
        })
    }

    pub fn save_local_draft(&mut self, farm: &str, workspace: &str, app_version: &str, operation_json: &str) -> Result<()> {
        let operation: serde_json::Value = serde_json::from_str(operation_json)?;
        validate_local_operation(&operation)?;
        if operation["farmId"].as_str() != Some(farm) { return Err("Operation farm does not match workspace".into()); }
        let state = self.db.query_row("SELECT state FROM local_operations WHERE operation_id=?1", [operation["operationId"].as_str().unwrap()], |r| r.get::<_,String>(0)).optional()?;
        if state.as_deref().is_some_and(|s| s != "DRAFT") { return Err("Confirmed operations cannot be edited".into()); }
        let payload = serde_json::to_string(&operation["payload"])?;
        self.db.execute("INSERT INTO local_operations(operation_id,farm_id,flock_id,operation_type,event_date,created_at_local,queued_at_local,payload_json,operation_json,local_workspace_identity,app_version,state)
          VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'DRAFT')
          ON CONFLICT(operation_id) DO UPDATE SET flock_id=excluded.flock_id,event_date=excluded.event_date,payload_json=excluded.payload_json,operation_json=excluded.operation_json,app_version=excluded.app_version
          WHERE local_operations.state='DRAFT'",
          params![operation["operationId"].as_str(), farm, operation["flockId"].as_str(), operation["operationType"].as_str(), operation["eventDate"].as_str(), operation["createdAtLocal"].as_str(), operation["queuedAtLocal"].as_str(), payload, operation_json, workspace, app_version])?;
        Ok(())
    }

    pub fn confirm_local_operation(&mut self, id: &str, farm: &str, operation_capabilities: &[String], lease_expired: bool) -> Result<()> {
        if lease_expired { return Err("Offline access has expired. Reconnect to record new entries.".into()); }
        let tx = self.db.transaction()?;
        let (operation_type, operation_json): (String,String) = tx.query_row("SELECT operation_type,operation_json FROM local_operations WHERE operation_id=?1 AND farm_id=?2 AND state='DRAFT'", params![id,farm], |r| Ok((r.get(0)?,r.get(1)?)))?;
        let capability = match operation_type.as_str() { "MORTALITY_V1" => "queue_mortality_v1", "DAILY_PRODUCTION_V1" => "queue_daily_production_v1", _ => return Err("Unsupported offline operation".into()) };
        if !operation_capabilities.iter().any(|c| c == capability) { return Err("This farm lease does not permit offline entry. Reconnect and prepare the farm again.".into()); }
        let mut operation: serde_json::Value = serde_json::from_str(&operation_json)?;
        operation["queuedAtLocal"] = serde_json::Value::String(Utc::now().to_rfc3339());
        validate_local_operation(&operation)?;
        let frozen = serde_json::to_string(&operation)?;
        tx.execute("UPDATE local_operations SET queued_at_local=?2,operation_json=?3,state='PENDING_SYNC' WHERE operation_id=?1 AND state='DRAFT'", params![id,operation["queuedAtLocal"].as_str(),frozen])?;
        tx.commit()?;
        Ok(())
    }

    pub fn list_local_operations(&self, farm: &str) -> Result<Vec<LocalOperation>> {
        let mut query = self.db.prepare("SELECT operation_json,state,server_receipt_json,sync_error_code,synced_at FROM local_operations WHERE farm_id=?1 ORDER BY event_date,created_order,operation_id")?;
        let rows = query.query_map([farm], |r| Ok(LocalOperation { operation_json: r.get(0)?, state: r.get(1)?, server_receipt_json: r.get(2)?, sync_error_code: r.get(3)?, synced_at: r.get(4)? }))?;
        let operations = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        for operation in &operations {
            let value: serde_json::Value = serde_json::from_str(&operation.operation_json)
                .map_err(|_| "Corrupted local operation payload")?;
            validate_local_operation(&value)
                .map_err(|_| "Corrupted local operation payload")?;
            if value["farmId"].as_str() != Some(farm) {
                return Err("Local operation workspace binding is invalid".into());
            }
        }
        Ok(operations)
    }

    pub fn mark_local_operation_syncing(&mut self, id: &str, farm: &str) -> Result<()> {
        let changed = self.db.execute(
            "UPDATE local_operations SET state='SYNCING',sync_error_code=NULL WHERE operation_id=?1 AND farm_id=?2 AND state='PENDING_SYNC'",
            params![id, farm],
        )?;
        if changed != 1 { return Err("Operation is not waiting to sync".into()); }
        Ok(())
    }

    pub fn save_local_sync_receipt(&mut self, id: &str, farm: &str, receipt_json: &str) -> Result<()> {
        if receipt_json.len() > 65536 { return Err("Server receipt is too large".into()); }
        let receipt: serde_json::Value = serde_json::from_str(receipt_json)?;
        let stored_operation: String = self.db.query_row(
            "SELECT operation_json FROM local_operations WHERE operation_id=?1 AND farm_id=?2 AND state IN ('SYNCING','PENDING_SYNC')",
            params![id, farm], |r| r.get(0))?;
        let operation: serde_json::Value = serde_json::from_str(&stored_operation)?;
        let operation_type = operation["operationType"].as_str().ok_or("Invalid local operation")?;
        let canonical_id_present = match operation_type {
            "MORTALITY_V1" => receipt["movementId"].as_str().is_some(),
            "DAILY_PRODUCTION_V1" => receipt["productionRecordId"].as_str().is_some(),
            _ => false,
        };
        if receipt["operationId"].as_str() != Some(id)
            || receipt["farmId"].as_str() != Some(farm)
            || receipt["operationType"].as_str() != Some(operation_type)
            || receipt["schemaVersion"].as_i64() != Some(1)
            || receipt["committedAt"].as_str().is_none()
            || receipt["payloadFingerprint"].as_str().is_none_or(|hash| hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()))
            || !canonical_id_present
        { return Err("Server receipt does not match this local operation".into()); }
        let tx = self.db.transaction()?;
        tx.execute("UPDATE local_operations SET server_receipt_json=?3 WHERE operation_id=?1 AND farm_id=?2 AND state IN ('SYNCING','PENDING_SYNC')", params![id,farm,receipt_json])?;
        tx.execute("UPDATE local_operations SET state='SYNCED',sync_error_code=NULL,synced_at=?3 WHERE operation_id=?1 AND farm_id=?2 AND state IN ('SYNCING','PENDING_SYNC')", params![id,farm,Utc::now().to_rfc3339()])?;
        tx.commit()?;
        Ok(())
    }

    pub fn mark_local_needs_attention(&mut self, id: &str, farm: &str, code: &str) -> Result<()> {
        if code.is_empty() || code.len() > 64 || !code.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_') {
            return Err("Invalid synchronization result code".into());
        }
        let changed = self.db.execute(
            "UPDATE local_operations SET state='NEEDS_ATTENTION',sync_error_code=?3 WHERE operation_id=?1 AND farm_id=?2 AND state IN ('SYNCING','PENDING_SYNC')",
            params![id, farm, code],
        )?;
        if changed != 1 { return Err("Operation is not awaiting a server result".into()); }
        Ok(())
    }

    pub fn restore_local_pending(&mut self, id: &str, farm: &str) -> Result<()> {
        let changed = self.db.execute(
            "UPDATE local_operations SET state='PENDING_SYNC' WHERE operation_id=?1 AND farm_id=?2 AND state='SYNCING'",
            params![id, farm],
        )?;
        if changed != 1 { return Err("Operation is not currently syncing".into()); }
        Ok(())
    }

    pub fn discard_local_draft(&mut self, id: &str, farm: &str) -> Result<()> {
        let changed = self.db.execute("DELETE FROM local_operations WHERE operation_id=?1 AND farm_id=?2 AND state='DRAFT'", params![id,farm])?;
        if changed != 1 { return Err("Only drafts can be discarded".into()); }
        Ok(())
    }

    pub fn save_farm_snapshot(&mut self, farm: &str, name: &str) -> Result<()> {
        self.db.execute(
            "INSERT OR REPLACE INTO farm_snapshot(farm_id,farm_name) VALUES (?1,?2)",
            params![farm, name],
        )?;
        Ok(())
    }

    pub fn read_farm_snapshot(&self, farm: &str) -> Result<Option<String>> {
        let mut query = self
            .db
            .prepare("SELECT farm_name FROM farm_snapshot WHERE farm_id=?1")?;
        let mut rows = query.query([farm])?;
        Ok(rows.next()?.map(|r| r.get(0)).transpose()?)
    }

    pub fn save_draft(&mut self, id: &str, farm: &str, payload: &str) -> Result<()> {
        self.db.execute(
            "INSERT INTO journal(operation_id,farm_id,payload,state) VALUES (?1,?2,?3,'DRAFT')",
            params![id, farm, payload],
        )?;
        Ok(())
    }

    pub fn queue(&mut self, id: &str) -> Result<()> {
        let tx = self.db.transaction()?;
        let changed = tx.execute(
            "UPDATE journal SET state='PENDING_SYNC' WHERE operation_id=?1 AND state='DRAFT'",
            [id],
        )?;
        if changed != 1 {
            return Err("Draft not queueable".into());
        }
        tx.commit()?;
        Ok(())
    }

    pub fn mark_syncing(&mut self, id: &str) -> Result<()> {
        let changed = self.db.execute(
            "UPDATE journal SET state='SYNCING' WHERE operation_id=?1 AND state='PENDING_SYNC'",
            [id],
        )?;
        if changed != 1 {
            return Err("Operation not pending".into());
        }
        Ok(())
    }

    pub fn save_receipt(&mut self, id: &str, receipt: &str) -> Result<()> {
        let tx = self.db.transaction()?;
        let changed = tx.execute("UPDATE journal SET state='SYNCED',receipt=?2 WHERE operation_id=?1 AND state IN ('SYNCING','PENDING_SYNC')", params![id, receipt])?;
        if changed != 1 {
            return Err("Operation not awaiting receipt".into());
        }
        tx.commit()?;
        Ok(())
    }

    pub fn mark_needs_attention(&mut self, id: &str, code: &str) -> Result<()> {
        let tx = self.db.transaction()?;
        let changed = tx.execute(
            "UPDATE journal SET state='NEEDS_ATTENTION',error_code=?2 WHERE operation_id=?1 AND state IN ('SYNCING','PENDING_SYNC')",
            params![id, code],
        )?;
        if changed != 1 {
            return Err("Operation not awaiting server result".into());
        }
        tx.commit()?;
        Ok(())
    }

    pub fn error_code(&self, id: &str) -> Result<Option<String>> {
        Ok(self.db.query_row(
            "SELECT error_code FROM journal WHERE operation_id=?1",
            [id],
            |r| r.get(0),
        )?)
    }

    pub fn operation(&self, id: &str) -> Result<(String, String, Option<String>)> {
        Ok(self.db.query_row(
            "SELECT state,payload,receipt FROM journal WHERE operation_id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?)
    }
}

fn validate_local_operation(op: &serde_json::Value) -> Result<()> {
    let text = |key: &str| op.get(key).and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty());
    for key in ["operationId", "farmId", "flockId", "createdAtLocal", "queuedAtLocal"] {
        if text(key).is_none() { return Err(format!("Missing operation field: {key}").into()); }
    }
    if op["schemaVersion"].as_i64() != Some(1) { return Err("Unsupported local operation version".into()); }
    let event_date = text("eventDate").ok_or("Missing event date")?;
    chrono::NaiveDate::parse_from_str(event_date, "%Y-%m-%d").map_err(|_| "Invalid calendar event date")?;
    let payload = op.get("payload").ok_or("Missing operation payload")?;
    let quantity = |key: &str| -> Result<i64> {
        let n = payload.get(key).and_then(|v| v.as_i64()).ok_or(format!("{key} must be a whole number"))?;
        if n < 0 || n > 2_000_000 { return Err(format!("{key} is outside the supported range").into()); }
        Ok(n)
    };
    match text("operationType") {
        Some("MORTALITY_V1") => {
            let n = quantity("quantity")?;
            if n == 0 { return Err("Mortality must be at least one bird".into()); }
            if payload.get("notes").and_then(|v| v.as_str()).unwrap_or("").len() > 2000 { return Err("Mortality notes are too long".into()); }
        }
        Some("DAILY_PRODUCTION_V1") => {
            let eggs = quantity("eggsCollected")?;
            let cracked = quantity("crackedEggs")?;
            quantity("deaths")?; quantity("culls")?;
            if cracked > eggs { return Err("Cracked eggs cannot exceed eggs collected".into()); }
            let feed = payload.get("feedConsumedKg").and_then(|v| v.as_f64()).ok_or("Invalid feed quantity")?;
            let transport = payload.get("transportCost").and_then(|v| v.as_f64()).ok_or("Invalid transport cost")?;
            let other = payload.get("otherCost").and_then(|v| v.as_f64()).ok_or("Invalid other cost")?;
            if !feed.is_finite() || !(0.0..=1_000_000.0).contains(&feed) || !transport.is_finite() || !(0.0..=1_000_000_000.0).contains(&transport) || !other.is_finite() || !(0.0..=1_000_000_000.0).contains(&other) { return Err("Production quantity or cost is outside the supported range".into()); }
            if feed > 0.0 && payload["feedTypeId"].as_str().is_none() { return Err("Feed type is required when feed is recorded".into()); }
            let allocations = payload["gradeAllocations"].as_array().ok_or("Invalid egg grade allocations")?;
            let mut total = 0_i64;
            for allocation in allocations {
                let n = allocation.get("quantityEggs").and_then(|v| v.as_i64()).ok_or("Egg grade quantities must be whole numbers")?;
                if n < 0 || n > 2_000_000 { return Err("Egg grade quantity is outside the supported range".into()); }
                total += n;
            }
            if !allocations.is_empty() && total != eggs - cracked { return Err("Egg grade quantities must equal good eggs".into()); }
            if payload.get("notes").and_then(|v| v.as_str()).unwrap_or("").len() > 2000 { return Err("Production notes are too long".into()); }
        }
        _ => return Err("Unsupported local operation type".into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use openssl::sign::Signer;

    #[test]
    fn encrypted_restart_wrong_user_and_retry_journal() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let root = dir.path();
        let mut a = Workspace::open(root, "device-1", "user-a", "farm-a", "unique-pin-a")?;
        a.save_farm_snapshot("farm-a", "Synthetic Secret Farm A")?;
        a.save_draft("operation-x", "farm-a", "mortality=5")?;
        a.queue("operation-x")?;
        a.mark_syncing("operation-x")?;
        let path = a.database_path.clone();
        drop(a);
        let raw = fs::read(&path)?;
        assert!(!raw.starts_with(b"SQLite format 3"));
        assert!(!raw
            .windows(b"Synthetic Secret Farm A".len())
            .any(|w| w == b"Synthetic Secret Farm A"));
        assert!(Connection::open(&path)?
            .query_row("SELECT count(*) FROM farm_snapshot", [], |r| r
                .get::<_, i64>(0))
            .is_err());
        assert!(Workspace::open(root, "device-1", "user-a", "farm-a", "unique-pin-b").is_err());
        let mut b = Workspace::open(root, "device-1", "user-b", "farm-b", "unique-pin-b")?;
        assert_eq!(b.read_farm_snapshot("farm-a")?, None);
        b.save_farm_snapshot("farm-b", "Synthetic Farm B")?;
        drop(b);
        let mut same_user_other_farm =
            Workspace::open(root, "device-1", "user-a", "farm-b", "unique-pin-a")?;
        assert_eq!(same_user_other_farm.read_farm_snapshot("farm-a")?, None);
        same_user_other_farm.save_farm_snapshot("farm-b", "A's Other Farm")?;
        drop(same_user_other_farm);
        let mut a = Workspace::open(root, "device-1", "user-a", "farm-a", "unique-pin-a")?;
        assert_eq!(
            a.read_farm_snapshot("farm-a")?,
            Some("Synthetic Secret Farm A".into())
        );
        assert_eq!(a.operation("operation-x")?.0, "PENDING_SYNC");
        a.mark_syncing("operation-x")?;
        a.save_receipt("operation-x", "movement-id-1")?;
        assert_eq!(a.operation("operation-x")?.2, Some("movement-id-1".into()));
        Ok(())
    }

    #[test]
    fn failed_queue_or_receipt_keeps_original_state() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let mut db = Workspace::open(dir.path(), "device-2", "user-a", "farm-a", "unique-pin-a")?;
        db.save_draft("operation-y", "farm-a", "mortality=4")?;
        assert!(db.queue("unknown").is_err());
        assert_eq!(db.operation("operation-y")?.0, "DRAFT");
        db.queue("operation-y")?;
        assert!(db.queue("operation-y").is_err());
        assert_eq!(db.operation("operation-y")?.1, "mortality=4");
        assert!(db.save_receipt("unknown", "fake-receipt").is_err());
        assert_eq!(db.operation("operation-y")?.0, "PENDING_SYNC");
        db.save_receipt("operation-y", "real-receipt")?;
        assert!(db.save_receipt("operation-y", "replacement").is_err());
        assert_eq!(db.operation("operation-y")?.2, Some("real-receipt".into()));
        db.save_draft("operation-z", "farm-a", "mortality=9")?;
        db.queue("operation-z")?;
        db.mark_needs_attention("operation-z", "AUTHORIZATION_FAILED")?;
        assert_eq!(db.operation("operation-z")?.0, "NEEDS_ATTENTION");
        assert_eq!(db.operation("operation-z")?.1, "mortality=9");
        assert_eq!(
            db.error_code("operation-z")?,
            Some("AUTHORIZATION_FAILED".into())
        );
        Ok(())
    }

    #[test]
    fn signed_lease_rejects_tamper_time_and_wrong_workspace() -> Result<()> {
        let key = PKey::generate_ed25519()?;
        let public_der = key.public_key_to_der()?;
        let snapshot = r#"{"userId":"user-a","farmId":"farm-a","schemaVersion":2,"farm":{"name":"Synthetic Farm"}}"#;
        let base = LeaseClaims {
            version: 1,
            key_id: "development-2026-10".into(),
            user_id: "user-a".into(),
            farm_id: "farm-a".into(),
            installation_id: "device-a".into(),
            issued_at: Utc::now().to_rfc3339(),
            expires_at: (Utc::now() + chrono::Duration::days(7) - chrono::Duration::seconds(10))
                .to_rfc3339(),
            local_schema_min: 2,
            local_schema_max: 2,
            capabilities: vec!["snapshot_read".into()],
            snapshot_sha256: hex::encode(Sha256::digest(snapshot.as_bytes())),
        };
        let sign = |claims: &LeaseClaims| -> Result<(String, String)> {
            let json = serde_json::to_string(claims)?;
            let mut signer = Signer::new_without_digest(&key)?;
            let signature = STANDARD.encode(signer.sign_oneshot_to_vec(json.as_bytes())?);
            Ok((json, signature))
        };
        let (claims, signature) = sign(&base)?;
        assert!(verify_lease_with_key(
            &public_der,
            &claims,
            &signature,
            "device-a",
            "user-a",
            "farm-a",
            snapshot
        )
        .is_ok());
        assert!(verify_lease_with_key(
            &public_der,
            &claims.replace("farm-a", "farm-b"),
            &signature,
            "device-a",
            "user-a",
            "farm-b",
            snapshot
        )
        .is_err());
        assert!(verify_lease_with_key(
            &public_der,
            &claims,
            &signature,
            "device-b",
            "user-a",
            "farm-a",
            snapshot
        )
        .is_err());
        assert!(verify_lease_with_key(
            &public_der,
            &claims,
            &signature,
            "device-a",
            "user-b",
            "farm-a",
            snapshot
        )
        .is_err());
        assert!(verify_lease_with_key(
            &public_der,
            &claims,
            &signature,
            "device-a",
            "user-a",
            "farm-b",
            snapshot
        )
        .is_err());
        assert!(verify_lease_with_key(
            &public_der,
            &claims,
            &signature,
            "device-a",
            "user-a",
            "farm-a",
            "changed"
        )
        .is_err());
        let mut future = base;
        future.issued_at = (Utc::now() + chrono::Duration::days(1)).to_rfc3339();
        future.expires_at = (Utc::now() + chrono::Duration::days(2)).to_rfc3339();
        let (claims, signature) = sign(&future)?;
        assert!(verify_lease_with_key(
            &public_der,
            &claims,
            &signature,
            "device-a",
            "user-a",
            "farm-a",
            snapshot
        )
        .is_err());
        future.issued_at = (Utc::now() - chrono::Duration::days(8)).to_rfc3339();
        future.expires_at = (Utc::now() - chrono::Duration::days(2)).to_rfc3339();
        let (claims, signature) = sign(&future)?;
        let expired = verify_lease_with_key(
            &public_der,
            &claims,
            &signature,
            "device-a",
            "user-a",
            "farm-a",
            snapshot,
        )?;
        assert!(
            DateTime::parse_from_rfc3339(&expired.expires_at)?.with_timezone(&Utc) < Utc::now()
        );
        Ok(())
    }

    #[test]
    fn phase1_schema_two_migrates_to_four_without_losing_prepared_data() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let root = dir.path();
        let farm = LocalFarm {
            user_id: "user-a".into(),
            farm_id: "farm-a".into(),
            farm_name: "Sensitive Farm A".into(),
        };
        record_local_farm(
            root,
            "device-a",
            "A@EXAMPLE.TEST",
            "unique-pin-a",
            farm.clone(),
        )?;
        assert_eq!(
            read_local_farms(root, "device-a", "a@example.test", "unique-pin-a")?,
            vec![farm]
        );
        record_local_farm(
            root,
            "device-a",
            "a@example.test",
            "unique-pin-a",
            LocalFarm {
                user_id: "user-a".into(),
                farm_id: "farm-b".into(),
                farm_name: "Sensitive Farm B".into(),
            },
        )?;
        assert_eq!(
            read_local_farms(root, "device-a", "a@example.test", "unique-pin-a")?.len(),
            2
        );
        assert!(read_local_farms(root, "device-a", "a@example.test", "wrong-pin-a").is_err());
        assert!(read_local_farms(root, "device-a", "b@example.test", "unique-pin-a").is_err());
        let index_file = fs::read_dir(root)?
            .find_map(|entry| {
                let p = entry.ok()?.path();
                if p.extension()?.to_str()? == "index" {
                    Some(p)
                } else {
                    None
                }
            })
            .ok_or("Index missing")?;
        assert!(!fs::read(index_file)?
            .windows(b"Sensitive Farm A".len())
            .any(|w| w == b"Sensitive Farm A"));
        let mut db = Workspace::open(root, "device-a", "user-a", "farm-a", "unique-pin-a")?;
        db.save_farm_snapshot("farm-a", "Sensitive Farm A")?;
        db.save_farm_snapshot("farm-b", "Sensitive Farm B")?;
        db.save_draft("pending-1", "farm-a", "mortality=5")?;
        db.queue("pending-1")?;
        db.db
            .execute_batch("INSERT INTO prepared_snapshot(id,snapshot_json,claims_json,signature_b64,synchronized_at,last_seen_at) VALUES(1,'{\"farm\":\"Sensitive Farm A\"}','old-claims','old-signature','2026-10-20T08:42:00Z','2026-10-20T08:42:00Z'); DROP TABLE local_operations; PRAGMA user_version=2;")?;
        drop(db);
        let reopened =
            Workspace::open_existing(root, "device-a", "user-a", "farm-a", "unique-pin-a")?;
        assert_eq!(reopened.operation("pending-1")?.0, "PENDING_SYNC");
        assert_eq!(reopened.read_farm_snapshot("farm-a")?, Some("Sensitive Farm A".into()));
        assert_eq!(reopened.read_farm_snapshot("farm-b")?, Some("Sensitive Farm B".into()));
        let synced: String = reopened.db.query_row("SELECT synchronized_at FROM prepared_snapshot WHERE id=1", [], |r| r.get(0))?;
        assert_eq!(synced, "2026-10-20T08:42:00Z");
        let schema: i64 = reopened
            .db
            .query_row("PRAGMA user_version", [], |r| r.get(0))?;
        assert_eq!(schema, 4);
        Ok(())
    }

    #[test]
    fn offline_operations_validate_freeze_encrypt_and_survive_restart() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let root = dir.path();
        let mut db = Workspace::open(root, "device-a", "user-a", "farm-a", "unique-pin-a")?;
        let operation = serde_json::json!({
            "operationId":"00000000-0000-4000-8000-000000000001", "farmId":"farm-a",
            "flockId":"00000000-0000-4000-8000-000000000003", "schemaVersion":1,
            "operationType":"MORTALITY_V1", "eventDate":"2026-10-20",
            "createdAtLocal":"2026-10-21T00:01:00+00:00", "queuedAtLocal":"2026-10-21T00:01:00+00:00",
            "dependencies":[], "payload":{"quantity":3,"notes":"Synthetic private note"}
        });
        let json = serde_json::to_string(&operation)?;
        db.save_local_draft("farm-a", "device-a:user-a:farm-a", "0.2.0", &json)?;
        let no_capability: Vec<String> = vec![];
        assert!(db.confirm_local_operation(operation["operationId"].as_str().unwrap(), "farm-a", &no_capability, false).is_err());
        assert!(db.confirm_local_operation(operation["operationId"].as_str().unwrap(), "farm-a", &["queue_mortality_v1".into()], true).is_err());
        assert_eq!(db.list_local_operations("farm-a")?[0].state, "DRAFT");
        db.confirm_local_operation(operation["operationId"].as_str().unwrap(), "farm-a", &["queue_mortality_v1".into()], false)?;
        assert!(db.save_local_draft("farm-a", "device-a:user-a:farm-a", "0.2.0", &json).is_err());
        assert!(db.discard_local_draft(operation["operationId"].as_str().unwrap(), "farm-a").is_err());
        let path = db.database_path.clone(); drop(db);
        let raw = fs::read(&path)?;
        for secret in [b"Synthetic private note".as_slice(), b"farm-a".as_slice(), b"2026-10-20".as_slice()] {
            assert!(!raw.windows(secret.len()).any(|w| w == secret));
        }
        let mut reopened = Workspace::open_existing(root, "device-a", "user-a", "farm-a", "unique-pin-a")?;
        let row = reopened.list_local_operations("farm-a")?.remove(0);
        assert_eq!(row.state, "PENDING_SYNC");
        let saved: serde_json::Value = serde_json::from_str(&row.operation_json)?;
        assert_eq!(saved["eventDate"], "2026-10-20");
        assert_eq!(saved["payload"]["quantity"], 3);
        assert_ne!(saved["queuedAtLocal"], operation["queuedAtLocal"]);
        assert!(reopened.list_local_operations("farm-b")?.is_empty());
        reopened.mark_local_operation_syncing("00000000-0000-4000-8000-000000000001", "farm-a")?;
        drop(reopened);
        let mut after_interrupted_request = Workspace::open_existing(root, "device-a", "user-a", "farm-a", "unique-pin-a")?;
        assert_eq!(after_interrupted_request.list_local_operations("farm-a")?[0].state, "PENDING_SYNC");
        after_interrupted_request.mark_local_operation_syncing("00000000-0000-4000-8000-000000000001", "farm-a")?;
        let receipt = serde_json::json!({"operationId":"00000000-0000-4000-8000-000000000001","farmId":"farm-a","operationType":"MORTALITY_V1","schemaVersion":1,"payloadFingerprint":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","movementId":"server-movement-1","committedAt":"2026-10-21T00:00:00Z"});
        after_interrupted_request.save_local_sync_receipt("00000000-0000-4000-8000-000000000001", "farm-a", &serde_json::to_string(&receipt)?)?;
        drop(after_interrupted_request);
        let after_ack_restart = Workspace::open_existing(root, "device-a", "user-a", "farm-a", "unique-pin-a")?;
        let synced = after_ack_restart.list_local_operations("farm-a")?.remove(0);
        assert_eq!(synced.state, "SYNCED");
        assert!(synced.server_receipt_json.is_some());
        assert!(synced.synced_at.is_some());
        Ok(())
    }

    #[test]
    fn local_operation_validation_rejects_bad_quantity_and_calendar_date() -> Result<()> {
        let valid = serde_json::json!({ "operationId":"op", "farmId":"farm-a", "flockId":"flock-a", "schemaVersion":1,
            "operationType":"MORTALITY_V1", "eventDate":"2026-10-20", "createdAtLocal":"2026-10-21T00:01:00Z",
            "queuedAtLocal":"2026-10-21T00:01:00Z", "payload":{"quantity":1,"notes":""} });
        assert!(validate_local_operation(&valid).is_ok());
        for (quantity, date) in [(0, "2026-10-20"), (-1, "2026-10-20"), (1, "2026-02-30")] {
            let mut invalid = valid.clone(); invalid["payload"]["quantity"] = serde_json::json!(quantity); invalid["eventDate"] = serde_json::json!(date);
            assert!(validate_local_operation(&invalid).is_err());
        }
        let mut production = valid.clone();
        production["operationType"] = serde_json::json!("DAILY_PRODUCTION_V1");
        production["payload"] = serde_json::json!({ "eggsCollected":4,"crackedEggs":0,"deaths":0,"culls":0,
          "feedConsumedKg":0,"feedTypeId":null,"transportCost":0,"otherCost":0,"notes":"",
          "gradeAllocations":[{"eggGradeId":"grade-a","quantityEggs":3}] });
        assert!(validate_local_operation(&production).is_err());
        Ok(())
    }

    #[test]
    fn local_write_failure_and_corrupt_payload_are_reported() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let mut db = Workspace::open(dir.path(), "device-a", "user-a", "farm-a", "unique-pin-a")?;
        let operation = serde_json::json!({ "operationId":"00000000-0000-4000-8000-000000000001", "farmId":"farm-a",
            "flockId":"00000000-0000-4000-8000-000000000003", "schemaVersion":1, "operationType":"MORTALITY_V1",
            "eventDate":"2026-10-21", "createdAtLocal":"2026-10-21T08:00:00Z", "queuedAtLocal":"2026-10-21T08:00:00Z",
            "dependencies":[], "payload":{"quantity":1,"notes":""} });
        let json = serde_json::to_string(&operation)?;
        db.db.execute_batch("CREATE TRIGGER reject_local_operation BEFORE INSERT ON local_operations BEGIN SELECT RAISE(ABORT,'injected local storage failure'); END;")?;
        assert!(db.save_local_draft("farm-a", "workspace", "0.1.0", &json).is_err());
        assert!(db.list_local_operations("farm-a")?.is_empty());
        db.db.execute_batch("DROP TRIGGER reject_local_operation;")?;
        db.save_local_draft("farm-a", "workspace", "0.1.0", &json)?;
        db.db.execute("UPDATE local_operations SET operation_json='not-json' WHERE operation_id=?1", [operation["operationId"].as_str().unwrap()])?;
        assert!(db.list_local_operations("farm-a").is_err());
        Ok(())
    }
}
