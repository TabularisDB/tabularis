//! Machine-only connection lifecycle. No browser RPC command exposes this service.
use crate::models::ConnectionParams;
use crate::plugin_secrets::PluginSecretChanges;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProvisionConnection {
    pub name: String,
    pub params: ConnectionParams,
    #[serde(default)]
    pub plugin_secret_changes: PluginSecretChanges,
}

pub enum ProvisionCommand {
    List,
    Get(String),
    Put(String, ProvisionConnection),
    Delete(String),
}

#[derive(Serialize)]
pub struct ProvisionedConnection {
    pub id: String,
    pub external_ref: String,
    pub name: String,
    pub driver: String,
    pub managed: bool,
}

pub fn connection_id(reference: &str) -> Result<String, String> {
    if reference.is_empty()
        || reference.len() > 128
        || !reference
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
    {
        return Err("invalid_external_ref".into());
    }
    // Disjoint from interactive UUIDs; the reference is stored atomically with
    // the connection, with no sidecar mapping that can be lost on a retry.
    Ok(format!("provisioned-{reference}"))
}
