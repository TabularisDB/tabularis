#[cfg(test)]
mod tests {
    use crate::persistence::{load_connections_file, save_connections_file};

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
}
