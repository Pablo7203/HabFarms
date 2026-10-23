#![cfg(windows)]

use argon2::Argon2;
use rand::RngCore;
use rusqlite::{params, Connection};
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
        if local_schema > 1 {
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
        db.execute_batch("UPDATE journal SET state='PENDING_SYNC' WHERE state='SYNCING';")?;
        Ok(Self { db, database_path })
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
