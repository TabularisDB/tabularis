//! CRUD for shared credential profiles: login metadata in `connections.json`
//! and passwords in the OS keychain under `{id}:profile:db`.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::{ConnectionsFile, CredentialProfile};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CredentialProfileDependentConnection {
    pub id: String,
    pub name: String,
}

pub const CREDENTIAL_PROFILE_DELETE_BLOCKED_CODE: &str = "credential_profile_delete_blocked";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialProfileDeleteBlockedError {
    pub code: String,
    pub message: String,
    pub connections: Vec<CredentialProfileDependentConnection>,
}

pub const MAX_PROFILE_NAME_CHARS: usize = 64;

fn validate_profile_fields(name: &str, username: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Credential profile name cannot be empty".to_string());
    }
    if name.trim().chars().count() > MAX_PROFILE_NAME_CHARS {
        return Err(format!(
            "Credential profile name cannot exceed {MAX_PROFILE_NAME_CHARS} characters"
        ));
    }
    if username.trim().is_empty() {
        return Err("Credential profile username cannot be empty".to_string());
    }
    Ok(())
}

/// Rejects a profile id that matches an existing connection id so metadata and
/// keychain lookups stay unambiguous even though profile secrets use a dedicated
/// `:profile:db` suffix.
pub fn validate_profile_id_not_connection_id(
    file: &ConnectionsFile,
    profile_id: &str,
) -> Result<(), String> {
    if file.connections.iter().any(|connection| connection.id == profile_id) {
        return Err(
            "Credential profile id cannot match an existing connection id".to_string(),
        );
    }
    Ok(())
}

/// A connection's `{connection_id}:db` account equals `{profile_id}:profile:db` when
/// `connection_id` is `{profile_id}:profile` (imported or crafted ids).
pub fn connection_db_collides_with_profile_db(connection_id: &str, profile_id: &str) -> bool {
    format!("{connection_id}:db") == format!("{profile_id}:profile:db")
}

pub fn connection_id_conflicting_with_profile_keychain(profile_id: &str) -> String {
    format!("{profile_id}:profile")
}

/// Rejects a profile whose keychain account would alias an existing connection's `:db` entry.
pub fn validate_profile_keychain_namespace(
    file: &ConnectionsFile,
    profile_id: &str,
) -> Result<(), String> {
    validate_profile_id_not_connection_id(file, profile_id)?;
    let conflicting = connection_id_conflicting_with_profile_keychain(profile_id);
    if file.connections.iter().any(|connection| connection.id == conflicting) {
        return Err(format!(
            "Credential profile id '{profile_id}' cannot be used while connection '{conflicting}' exists"
        ));
    }
    Ok(())
}

pub fn validate_connection_profile_link(
    connection_id: &str,
    profile_id: &str,
) -> Result<(), String> {
    if connection_db_collides_with_profile_db(connection_id, profile_id) {
        let conflicting = connection_id_conflicting_with_profile_keychain(profile_id);
        return Err(format!(
            "Connection '{connection_id}' cannot use credential profile '{profile_id}' because both share the keychain account '{conflicting}:db'"
        ));
    }
    Ok(())
}

pub fn create_profile_impl(
    file: &mut ConnectionsFile,
    name: &str,
    username: &str,
) -> Result<CredentialProfile, String> {
    validate_profile_fields(name, username)?;
    let id = Uuid::new_v4().to_string();
    validate_profile_keychain_namespace(file, &id)?;
    let profile = CredentialProfile {
        id,
        name: name.trim().to_string(),
        username: username.trim().to_string(),
    };
    file.credential_profiles.push(profile.clone());
    Ok(profile)
}

pub fn update_profile_impl(
    file: &mut ConnectionsFile,
    id: &str,
    name: &str,
    username: &str,
) -> Result<(), String> {
    validate_profile_fields(name, username)?;
    let profile = file
        .credential_profiles
        .iter_mut()
        .find(|profile| profile.id == id)
        .ok_or_else(|| "Credential profile not found".to_string())?;
    profile.name = name.trim().to_string();
    profile.username = username.trim().to_string();
    Ok(())
}

pub fn connection_ids_for_profile(file: &ConnectionsFile, profile_id: &str) -> Vec<String> {
    dependent_connections_for_profile(file, profile_id)
        .into_iter()
        .map(|connection| connection.id)
        .collect()
}

pub fn dependent_connections_for_profile(
    file: &ConnectionsFile,
    profile_id: &str,
) -> Vec<CredentialProfileDependentConnection> {
    file.connections
        .iter()
        .filter(|connection| {
            connection
                .params
                .credential_profile_id
                .as_deref()
                == Some(profile_id)
        })
        .map(|connection| CredentialProfileDependentConnection {
            id: connection.id.clone(),
            name: connection.name.clone(),
        })
        .collect()
}

pub fn credential_profile_delete_blocked_error(
    profile_id: &str,
    connections: Vec<CredentialProfileDependentConnection>,
) -> String {
    let count = connections.len();
    let fallback = format!(
        "Credential profile '{profile_id}' is still used by {count} connection(s)"
    );
    serde_json::to_string(&CredentialProfileDeleteBlockedError {
        code: CREDENTIAL_PROFILE_DELETE_BLOCKED_CODE.to_string(),
        message: fallback.clone(),
        connections,
    })
    .unwrap_or(fallback)
}

pub fn delete_profile_impl(
    file: &mut ConnectionsFile,
    id: &str,
) -> Result<CredentialProfile, String> {
    let index = file
        .credential_profiles
        .iter()
        .position(|profile| profile.id == id)
        .ok_or_else(|| "Credential profile not found".to_string())?;
    Ok(file.credential_profiles.remove(index))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ConnectionParams, SavedConnection};

    fn connection(id: &str) -> SavedConnection {
        SavedConnection {
            id: id.to_string(),
            name: id.to_string(),
            params: ConnectionParams::default(),
            plugin_secret_keys: Vec::new(),
            group_id: None,
            sort_order: None,
            detect_json_in_text_columns: None,
            appearance: None,
            tag_ids: None,
            environment: None,
        }
    }

    #[test]
    fn profile_id_cannot_match_existing_connection_id() {
        let file = ConnectionsFile {
            connections: vec![connection("shared-id")],
            ..Default::default()
        };
        assert!(validate_profile_id_not_connection_id(&file, "shared-id").is_err());
        assert!(validate_profile_id_not_connection_id(&file, "profile-only").is_ok());
    }

    #[test]
    fn delete_blocked_error_json_carries_stable_code() {
        let json = credential_profile_delete_blocked_error(
            "profile-1",
            vec![CredentialProfileDependentConnection {
                id: "conn-1".to_string(),
                name: "Linked".to_string(),
            }],
        );
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(
            value["code"].as_str(),
            Some(CREDENTIAL_PROFILE_DELETE_BLOCKED_CODE)
        );
        assert_eq!(value["connections"][0]["id"], "conn-1");
    }

    #[test]
    fn profile_abc_collides_with_connection_abc_profile_keychain_accounts() {
        assert!(connection_db_collides_with_profile_db("abc:profile", "abc"));
        assert!(!connection_db_collides_with_profile_db("abc:profile:extra", "abc"));
        assert!(validate_connection_profile_link("abc:profile", "abc").is_err());
    }
}
