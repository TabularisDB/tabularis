#[cfg(test)]
mod tests {
    use crate::models::{
        single_db_before_multi_transition, ConnectionParams, DatabaseSelection,
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
}
