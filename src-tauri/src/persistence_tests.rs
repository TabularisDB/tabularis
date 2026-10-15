#[cfg(test)]
mod tests {
    use crate::models::{ConnectionParams, ConnectionsFile, SavedConnection};
    use crate::persistence::{
        apply_secret_persistence, load_connections_file, save_connections_file, write_private_file,
    };

    #[test]
    fn save_preserves_unknown_fields_without_resurrecting_known_changes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        std::fs::write(
            &path,
            r#"{"schemaVersion":3,"connections":[{"id":"conn-1","name":"prod","environment":"production","readReplicaLag":42,"params":{"driver":"mysql","host":"old","database":"testdb","awsRegion":"eu-west-1","connectionUri":"mysql://x"}},{"id":"conn-2","name":"delete","params":{"driver":"mysql","database":"testdb","awsRegion":"us-east-1"}}]}"#,
        )
        .unwrap();

        let mut file = load_connections_file(&path).unwrap();
        file.connections
            .retain(|connection| connection.id != "conn-2");
        file.connections[0].environment = None;
        file.connections[0].params.host = Some("new".to_string());
        save_connections_file(&path, &file).unwrap();

        let saved: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let connection = &saved["connections"][0];
        assert_eq!(saved["schemaVersion"], 3);
        assert_eq!(connection["readReplicaLag"], 42);
        assert_eq!(connection["params"]["awsRegion"], "eu-west-1");
        assert_eq!(connection["params"]["host"], "new");
        assert!(connection.get("environment").is_none());
        assert_eq!(saved["connections"].as_array().unwrap().len(), 1);
        assert!(connection["params"].get("connectionUri").is_none());
        assert!(serde_json::from_value::<crate::models::ConnectionsFile>(saved).is_ok());
    }

    fn connection_with_secret(save_in_keychain: bool) -> SavedConnection {
        SavedConnection {
            id: "conn-1".to_string(),
            name: "prod".to_string(),
            params: ConnectionParams {
                driver: "mysql".to_string(),
                password: Some("db-secret".to_string()),
                ssh_password: Some("ssh-secret".to_string()),
                save_in_keychain: Some(save_in_keychain),
                ..ConnectionParams::default()
            },
            group_id: None,
            sort_order: None,
            detect_json_in_text_columns: None,
            appearance: None,
            tag_ids: None,
            environment: None,
        }
    }

    #[test]
    fn save_connections_file_with_keychain_default_writes_no_password() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        let file = ConnectionsFile {
            connections: vec![connection_with_secret(true)],
            ..ConnectionsFile::default()
        };

        save_connections_file(&path, &file).unwrap();

        let saved = std::fs::read_to_string(&path).unwrap();
        assert!(!saved.contains("db-secret"));
        assert!(!saved.contains("ssh-secret"));
        let parsed: serde_json::Value = serde_json::from_str(&saved).unwrap();
        assert_eq!(parsed["connections"][0]["params"]["save_in_keychain"], true);
        assert!(parsed["connections"][0]["params"]["password"].is_null());
    }

    #[test]
    fn save_connections_file_keeps_password_when_keychain_is_off() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        let file = ConnectionsFile {
            connections: vec![connection_with_secret(false)],
            ..ConnectionsFile::default()
        };

        save_connections_file(&path, &file).unwrap();

        let saved = std::fs::read_to_string(&path).unwrap();
        assert!(saved.contains("db-secret"));
        assert!(saved.contains("ssh-secret"));
    }

    #[test]
    fn unavailable_keychain_keeps_the_secret_and_clears_the_flag() {
        let mut params = connection_with_secret(true).params;
        apply_secret_persistence(&mut params, false);
        assert_eq!(params.password.as_deref(), Some("db-secret"));
        assert_eq!(params.ssh_password.as_deref(), Some("ssh-secret"));
        assert_eq!(params.save_in_keychain, Some(false));
    }

    #[test]
    fn stored_keychain_strips_secrets() {
        let mut params = connection_with_secret(true).params;
        apply_secret_persistence(&mut params, true);
        assert!(params.password.is_none());
        assert!(params.ssh_password.is_none());
        assert_eq!(params.save_in_keychain, Some(true));
    }

    #[test]
    fn pooler_mode_round_trips_and_stays_absent_when_none() {
        // "transaction" serializes and deserializes back.
        let with_mode = ConnectionParams {
            driver: "postgresql".to_string(),
            pooler_mode: Some("transaction".to_string()),
            ..ConnectionParams::default()
        };
        let json = serde_json::to_value(&with_mode).unwrap();
        assert_eq!(json["pooler_mode"], "transaction");

        let back: ConnectionParams = serde_json::from_value(json).unwrap();
        assert_eq!(back.pooler_mode.as_deref(), Some("transaction"));

        // None omits the key entirely (skip_serializing_if) — backward-compat:
        // old connections.json entries have no pooler_mode key.
        let without_mode = ConnectionParams {
            driver: "postgresql".to_string(),
            ..ConnectionParams::default()
        };
        let json = serde_json::to_value(&without_mode).unwrap();
        assert!(json.get("pooler_mode").is_none());

        // A legacy JSON object without the key deserializes as None.
        // `database` is the one required field (no #[serde(default)]), so a
        // realistic old connections.json entry carries it; pooler_mode is absent.
        let legacy = serde_json::json!({"driver": "postgresql", "database": "appdb"});
        let parsed: ConnectionParams = serde_json::from_value(legacy).unwrap();
        assert!(parsed.pooler_mode.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn write_private_file_creates_mode_0600_with_the_given_content() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        write_private_file(&path, b"{\"secret\":\"db-secret\"}").unwrap();

        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "{\"secret\":\"db-secret\"}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn write_private_file_tightens_an_existing_0644_file() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ssh_connections.json");
        std::fs::write(&path, b"old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o644
        );

        write_private_file(&path, b"new-secret").unwrap();

        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new-secret");
    }
}
