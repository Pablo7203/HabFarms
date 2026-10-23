#![cfg(windows)]
use habfarms_desktop_local::{
    read_local_farms, record_local_farm, verify_lease, LocalFarm, Workspace,
};
use serde_json::Value;
use std::{env, fs, path::Path};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let stage = env::args().nth(1).ok_or("stage missing")?;
    let root_string = env::var("PHASE1_ROOT")?;
    let root = Path::new(&root_string);
    let device = env::var("PHASE1_DEVICE")?;
    let email = env::var("PHASE1_EMAIL")?;
    let pin = env::var("PHASE1_PIN")?;
    if stage == "prepare" {
        let package: Value = serde_json::from_slice(&fs::read(env::var("PHASE1_PACKAGE")?)?)?;
        let snapshot_json = serde_json::to_string(&package["snapshot"])?;
        let claims = package["lease"]["claims"]
            .as_str()
            .ok_or("claims missing")?;
        let signature = package["lease"]["signature"]
            .as_str()
            .ok_or("signature missing")?;
        let user = package["snapshot"]["userId"]
            .as_str()
            .ok_or("user missing")?;
        let farm = package["snapshot"]["farmId"]
            .as_str()
            .ok_or("farm missing")?;
        verify_lease(claims, signature, &device, user, farm, &snapshot_json)?;
        let mut db = Workspace::open(root, &device, user, farm, &pin)?;
        db.store_bootstrap(&device, user, farm, &snapshot_json, claims, signature)?;
        record_local_farm(
            root,
            &device,
            &email,
            &pin,
            LocalFarm {
                user_id: user.into(),
                farm_id: farm.into(),
                farm_name: package["snapshot"]["farm"]["name"]
                    .as_str()
                    .ok_or("name missing")?
                    .into(),
            },
        )?;
        println!("PREPARED {}", farm);
    } else if stage == "offline" {
        let farms = read_local_farms(root, &device, &email, &pin)?;
        let farm = farms.first().ok_or("No prepared farm")?;
        let mut db = Workspace::open_existing(root, &device, &farm.user_id, &farm.farm_id, &pin)?;
        let prepared = db.read_prepared(&device, &farm.user_id, &farm.farm_id)?;
        println!("OFFLINE {} {}", farm.farm_name, prepared.synchronized_at);
    } else {
        return Err("Unknown stage".into());
    }
    Ok(())
}
