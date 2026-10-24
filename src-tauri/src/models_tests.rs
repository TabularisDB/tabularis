#[cfg(test)]
mod tests {
    use crate::models::{
        single_db_before_multi_transition, ConnectionParams, ConnectionsFile, CredentialProfile,
        DatabaseSelection, ExportPayload, SavedConnection, TableColumn, TableInfo,
    };

    #[test]
    fn single_to_multi_returns_previous_name() {
        let previous = DatabaseSelection::Single("app".into());
        let new = DatabaseSelection::Multiple(vec!["app".into(), "logs".into()]);
        assert_eq!(
            single_db_before_multi_transition(&previous, &new),
            Some("app".into())
        );
    }

    #[test]
    fn multiple_with_one_element_treated_as_single() {
        let previous = DatabaseSelection::Multiple(vec!["app".into()]);
        let new = DatabaseSelection::Multiple(vec!["app".into(), "logs".into()]);
        assert_eq!(
            single_db_before_multi_transition(&previous, &new),
            Some("app".into())
        );
    }

    #[test]
    fn multi_to_multi_returns_none() {
        let previous = DatabaseSelection::Multiple(vec!["a".into(), "b".into()]);
        let new = DatabaseSelection::Multiple(vec!["a".into(), "b".into(), "c".into()]);
        assert_eq!(single_db_before_multi_transition(&previous, &new), None);
    }

    #[test]
    fn single_to_single_returns_none() {
        let previous = DatabaseSelection::Single("a".into());
        let new = DatabaseSelection::Single("b".into());
        assert_eq!(single_db_before_multi_transition(&previous, &new), None);
    }

    #[test]
    fn single_to_multiple_with_one_item_returns_none() {
        let previous = DatabaseSelection::Single("app".into());
        let new = DatabaseSelection::Multiple(vec!["app".into()]);
        assert_eq!(single_db_before_multi_transition(&previous, &new), None);
    }

    #[test]
    fn empty_previous_name_returns_none() {
        let previous = DatabaseSelection::Single("".into());
        let new = DatabaseSelection::Multiple(vec!["a".into(), "b".into()]);
        assert_eq!(single_db_before_multi_transition(&previous, &new), None);
    }

    #[test]
    fn whitespace_previous_name_is_ignored() {
        let previous = DatabaseSelection::Single("   ".into());
        let new = DatabaseSelection::Multiple(vec!["a".into(), "b".into()]);
        assert_eq!(single_db_before_multi_transition(&previous, &new), None);
    }
    /// Connections saved before `connection_uri` existed must keep deserializing,
    /// and must not gain the field when written back out.
    #[test]
    fn connection_params_without_a_uri_round_trip_unchanged() {
        let stored = r#"{
            "driver": "postgres",
            "host": "localhost",
            "port": 5432,
            "username": "postgres",
            "password": null,
            "database": "app",
            "ssl_mode": null,
            "ssl_ca": null,
            "ssl_cert": null,
            "ssl_key": null,
            "ssh_enabled": false,
            "ssh_connection_id": null,
            "save_in_keychain": true
        }"#;

        let params: ConnectionParams =
            serde_json::from_str(stored).expect("legacy params deserialize");

        assert_eq!(params.connection_uri, None);
        assert_eq!(params.connection_uri_in_keychain, None);
        assert_eq!(params.host.as_deref(), Some("localhost"));

        let json = serde_json::to_string(&params).expect("serialize params");
        assert!(!json.contains("connection_uri"));
    }

    #[test]
    fn connection_params_preserve_a_uri_across_a_round_trip() {
        let uri = "mongodb+srv://user:pass@cluster0.example.invalid/?tls=true&w=majority";
        let params = ConnectionParams {
            driver: "mongodb".to_string(),
            connection_uri: Some(uri.to_string()),
            connection_uri_in_keychain: Some(true),
            database: DatabaseSelection::Single(String::new()),
            ..Default::default()
        };

        let json = serde_json::to_string(&params).expect("serialize params");
        let restored: ConnectionParams =
            serde_json::from_str(&json).expect("deserialize params");

        assert_eq!(restored.connection_uri.as_deref(), Some(uri));
        assert_eq!(restored.connection_uri_in_keychain, Some(true));
    }

    /// Plugins may send the camelCase spelling, matching the alias convention
    /// already used for `connectionString`.
    #[test]
    fn connection_params_accept_the_camel_case_uri_alias() {
        let stored = r#"{
            "driver": "mongodb",
            "host": null,
            "port": null,
            "username": null,
            "password": null,
            "connectionUri": "mongodb+srv://user:pass@cluster0.example.invalid/",
            "connectionUriInKeychain": true,
            "database": "",
            "ssl_mode": null,
            "ssl_ca": null,
            "ssl_cert": null,
            "ssl_key": null,
            "ssh_enabled": null,
            "ssh_connection_id": null,
            "save_in_keychain": true
        }"#;

        let params: ConnectionParams =
            serde_json::from_str(stored).expect("camelCase params deserialize");

        assert_eq!(
            params.connection_uri.as_deref(),
            Some("mongodb+srv://user:pass@cluster0.example.invalid/")
        );
        assert_eq!(params.connection_uri_in_keychain, Some(true));
    }

    /// `extra` is optional on the wire: connections persisted before the
    /// field existed must deserialize with an empty map, not an error.
    #[test]
    fn connection_params_default_extra_when_absent() {
        let stored = r#"{
            "driver": "mysql",
            "host": "localhost",
            "database": "app"
        }"#;

        let params: ConnectionParams =
            serde_json::from_str(stored).expect("legacy params without extra");
        assert!(params.extra.is_empty());
    }

    /// `extra` entries survive a persist round-trip untouched — the host must
    /// not interpret or rewrite plugin-specific values.
    #[test]
    fn connection_params_round_trip_extra_fields() {
        let params = ConnectionParams {
            driver: "dynamodb".to_string(),
            database: DatabaseSelection::Single(String::new()),
            extra: [
                ("region".to_string(), "eu-west-1".to_string()),
                ("endpoint".to_string(), "http://localhost:8000".to_string()),
            ]
            .into_iter()
            .collect(),
            ..Default::default()
        };

        let json = serde_json::to_string(&params).expect("serialize params");
        assert!(json.contains("\"extra\""));

        let restored: ConnectionParams =
            serde_json::from_str(&json).expect("deserialize params");
        assert_eq!(restored.extra.get("region").map(String::as_str), Some("eu-west-1"));
        assert_eq!(
            restored.extra.get("endpoint").map(String::as_str),
            Some("http://localhost:8000")
        );
    }

    #[test]
    fn table_metadata_comments_are_backwards_compatible() {
        let legacy_table: TableInfo =
            serde_json::from_str(r#"{"name":"users"}"#).expect("legacy table metadata");
        assert!(legacy_table.comment.is_none());

        let table: TableInfo = serde_json::from_str(
            r#"{"name":"users","comment":"Application users"}"#,
        )
        .expect("commented table metadata");
        assert_eq!(table.comment.as_deref(), Some("Application users"));

        let legacy_column: TableColumn = serde_json::from_str(
            r#"{"name":"id","data_type":"integer","is_pk":true,"is_nullable":false,"is_auto_increment":true}"#,
        )
        .expect("legacy column metadata");
        assert!(legacy_column.comment.is_none());

        let column: TableColumn = serde_json::from_str(
            r#"{"name":"status","data_type":"text","is_pk":false,"is_nullable":false,"is_auto_increment":false,"comment":"Current status"}"#,
        )
        .expect("commented column metadata");
        assert_eq!(column.comment.as_deref(), Some("Current status"));
    }

    /// An empty `extra` map is omitted from the persisted JSON so legacy
    /// connections.json files stay byte-identical.
    #[test]
    fn connection_params_omit_empty_extra() {
        let params = ConnectionParams {
            driver: "mysql".to_string(),
            database: DatabaseSelection::Single("app".to_string()),
            ..Default::default()
        };

        let json = serde_json::to_string(&params).expect("serialize params");
        assert!(!json.contains("extra"));
    }

    #[test]
    fn saved_connection_defaults_plugin_secret_markers_for_legacy_json() {
        let stored = r#"{
            "id": "legacy",
            "name": "Legacy",
            "params": { "driver": "mysql", "database": "app" }
        }"#;
        let connection: crate::models::SavedConnection =
            serde_json::from_str(stored).expect("legacy connection deserializes");
        assert!(connection.plugin_secret_keys.is_empty());

        let json = serde_json::to_string(&connection).expect("serialize connection");
        assert!(!json.contains("plugin_secret_keys"));
    }

    /// Files saved before credential profiles existed must keep deserializing,
    /// and must not gain an empty `credential_profiles` key when written back.
    #[test]
    fn connections_file_without_credential_profiles_round_trips_unchanged() {
        let stored = r#"{
            "groups": [],
            "connections": [
                {
                    "id": "legacy",
                    "name": "Legacy",
                    "params": { "driver": "mysql", "database": "app" }
                }
            ],
            "tags": []
        }"#;

        let file: ConnectionsFile =
            serde_json::from_str(stored).expect("legacy connections file deserializes");
        assert!(file.credential_profiles.is_empty());

        let json = serde_json::to_string(&file).expect("serialize connections file");
        assert!(!json.contains("credential_profiles"));
    }

    /// Connections saved before `credential_profile_id` existed must keep
    /// deserializing, and must not gain the field when written back out.
    #[test]
    fn connection_params_without_credential_profile_id_round_trip_unchanged() {
        let stored = r#"{
            "driver": "postgres",
            "host": "localhost",
            "port": 5432,
            "username": "postgres",
            "password": null,
            "database": "app",
            "ssl_mode": null,
            "ssl_ca": null,
            "ssl_cert": null,
            "ssl_key": null,
            "ssh_enabled": false,
            "ssh_connection_id": null,
            "save_in_keychain": true
        }"#;

        let params: ConnectionParams =
            serde_json::from_str(stored).expect("legacy params deserialize");
        assert_eq!(params.credential_profile_id, None);

        let json = serde_json::to_string(&params).expect("serialize params");
        assert!(!json.contains("credential_profile_id"));
    }

    #[test]
    fn credential_profile_serializes_metadata_only() {
        let profile = CredentialProfile {
            id: "cred-shared".to_string(),
            name: "Team read-only".to_string(),
            username: "readonly".to_string(),
        };

        let value = serde_json::to_value(&profile).expect("serialize profile");
        let object = value.as_object().expect("profile serializes as an object");
        let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["id", "name", "username"]);
        assert_eq!(
            object.get("id").and_then(|v| v.as_str()),
            Some("cred-shared")
        );
        assert_eq!(
            object.get("name").and_then(|v| v.as_str()),
            Some("Team read-only")
        );
        assert_eq!(
            object.get("username").and_then(|v| v.as_str()),
            Some("readonly")
        );
        assert!(!object.contains_key("password"));
    }

    #[test]
    fn multiple_connections_may_reference_the_same_credential_profile_id() {
        let profile_id = "cred-shared";
        let conn_params = || ConnectionParams {
            driver: "postgres".to_string(),
            host: Some("db.example.com".to_string()),
            database: DatabaseSelection::Single("app".to_string()),
            username: Some("stale-inline".to_string()),
            credential_profile_id: Some(profile_id.to_string()),
            save_in_keychain: Some(true),
            ..Default::default()
        };

        let file = ConnectionsFile {
            credential_profiles: vec![CredentialProfile {
                id: profile_id.to_string(),
                name: "Shared".to_string(),
                username: "readonly".to_string(),
            }],
            connections: vec![
                SavedConnection {
                    id: "conn-a".to_string(),
                    name: "A".to_string(),
                    params: conn_params(),
                    plugin_secret_keys: vec![],
                    group_id: None,
                    sort_order: None,
                    detect_json_in_text_columns: None,
                    appearance: None,
                    tag_ids: None,
                    environment: None,
                },
                SavedConnection {
                    id: "conn-b".to_string(),
                    name: "B".to_string(),
                    params: conn_params(),
                    plugin_secret_keys: vec![],
                    group_id: None,
                    sort_order: None,
                    detect_json_in_text_columns: None,
                    appearance: None,
                    tag_ids: None,
                    environment: None,
                },
            ],
            ..Default::default()
        };

        let json = serde_json::to_string(&file).expect("serialize file");
        let restored: ConnectionsFile = serde_json::from_str(&json).expect("deserialize file");
        assert_eq!(restored.credential_profiles.len(), 1);
        assert_eq!(
            restored
                .connections
                .iter()
                .filter(|c| c.params.credential_profile_id.as_deref() == Some(profile_id))
                .count(),
            2
        );
    }

    /// Metadata-only export payloads must round-trip profile records without
    /// ever carrying a password field on the profile itself.
    #[test]
    fn export_payload_secrets_free_round_trips_credential_profiles() {
        let profile = CredentialProfile {
            id: "cred-1".to_string(),
            name: "Shared".to_string(),
            username: "app_user".to_string(),
        };
        let payload = ExportPayload {
            version: 1,
            groups: vec![],
            connections: vec![SavedConnection {
                id: "conn-1".to_string(),
                name: "Uses profile".to_string(),
                params: ConnectionParams {
                    driver: "mysql".to_string(),
                    host: Some("localhost".to_string()),
                    username: Some("ignored-inline".to_string()),
                    password: None,
                    database: DatabaseSelection::Single("app".to_string()),
                    credential_profile_id: Some("cred-1".to_string()),
                    save_in_keychain: Some(true),
                    ..Default::default()
                },
                plugin_secret_keys: vec![],
                group_id: None,
                sort_order: None,
                detect_json_in_text_columns: None,
                appearance: None,
                tag_ids: None,
                environment: None,
            }],
            ssh_connections: vec![],
            k8s_connections: vec![],
            tags: vec![],
            credential_profiles: vec![profile.clone()],
            credential_profile_secrets: std::collections::HashMap::new(),
            plugin_secrets: std::collections::HashMap::new(),
        };

        let json = serde_json::to_string(&payload).expect("serialize export payload");
        assert!(!json.contains("\"password\":\""));
        let value: serde_json::Value =
            serde_json::from_str(&json).expect("export payload is valid JSON");
        let profiles = value
            .get("credential_profiles")
            .and_then(serde_json::Value::as_array)
            .expect("export payload has a credential_profiles array");
        assert_eq!(profiles.len(), 1);
        let profile_object = profiles[0]
            .as_object()
            .expect("credential profile serializes as an object");
        let mut keys: Vec<&str> = profile_object.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["id", "name", "username"]);
        assert!(!profile_object.contains_key("password"));
        let restored: ExportPayload =
            serde_json::from_str(&json).expect("deserialize export payload");
        assert_eq!(restored.credential_profiles, vec![profile]);
        assert_eq!(
            restored.connections[0]
                .params
                .credential_profile_id
                .as_deref(),
            Some("cred-1")
        );
        assert_eq!(restored.connections[0].params.password, None);
    }

    #[test]
    fn export_payload_legacy_json_without_credential_profiles_deserializes() {
        let stored = r#"{
            "version": 1,
            "groups": [],
            "connections": [],
            "ssh_connections": [],
            "k8s_connections": [],
            "tags": []
        }"#;
        let payload: ExportPayload =
            serde_json::from_str(stored).expect("legacy export payload deserializes");
        assert!(payload.credential_profiles.is_empty());
    }
}
