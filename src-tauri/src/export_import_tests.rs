#[cfg(test)]
mod tests {
    use crate::models::{ExportPayload, ConnectionGroup, SavedConnection, SshConnection, ConnectionParams, DatabaseSelection};

    #[test]
    fn test_export_payload_serialization() {
        let payload = ExportPayload {
            version: 1,
            groups: vec![ConnectionGroup {
                id: "group1".to_string(),
                name: "Test Group".to_string(),
                collapsed: false,
                sort_order: 0,
            }],
            connections: vec![SavedConnection {
                id: "conn1".to_string(),
                name: "Test Conn".to_string(),
                params: ConnectionParams {
                    driver: "mysql".to_string(),
                    host: Some("localhost".to_string()),
                    port: Some(3306),
                    username: Some("root".to_string()),
                    password: Some("password".to_string()),
                    database: DatabaseSelection::Single("test".to_string()),
                    ssl_mode: None,
                    ssl_ca: None,
                    ssl_cert: None,
                    ssl_key: None,
                    ssh_enabled: Some(false),
                    ssh_connection_id: None,
                    ssh_host: None,
                    ssh_port: None,
                    ssh_user: None,
                    ssh_password: None,
                    ssh_key_file: None,
                    ssh_key_passphrase: None,
                    save_in_keychain: Some(true),
                    connection_id: None,
                },
                group_id: Some("group1".to_string()),
                sort_order: Some(0),
                detect_json_in_text_columns: None,
            }],
            ssh_connections: vec![SshConnection {
                id: "ssh1".to_string(),
                name: "Test SSH".to_string(),
                host: "remote".to_string(),
                port: 22,
                user: "user".to_string(),
                auth_type: Some("password".to_string()),
                password: Some("ssh_password".to_string()),
                key_file: None,
                key_passphrase: None,
                save_in_keychain: Some(true),
            }],
        };

        let json = serde_json::to_string(&payload).unwrap();
        let deserialized: ExportPayload = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.version, 1);
        assert_eq!(deserialized.groups.len(), 1);
        assert_eq!(deserialized.connections.len(), 1);
        assert_eq!(deserialized.ssh_connections.len(), 1);
        assert_eq!(deserialized.connections[0].params.password, Some("password".to_string()));
        assert_eq!(deserialized.ssh_connections[0].password, Some("ssh_password".to_string()));
    }
}
