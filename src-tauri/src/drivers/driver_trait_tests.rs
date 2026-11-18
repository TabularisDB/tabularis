use crate::drivers::driver_trait::{deprecation_for_builtin, DriverCapabilities, PluginManifest};

#[test]
fn manifest_accepts_both_connection_string_example_spellings() {
    for field in ["connection_string_examples", "connectionStringExamples"] {
        let mut capabilities = serde_json::to_value(DriverCapabilities::default()).unwrap();
        capabilities
            .as_object_mut()
            .unwrap()
            .remove("connection_string_examples");
        capabilities[field] = serde_json::json!([{
            "label": "Local",
            "value": "jdbc:h2:mem:test",
            "description": "In-memory database"
        }]);

        let manifest: PluginManifest = serde_json::from_value(serde_json::json!({
            "id": "jdbc",
            "name": "JDBC",
            "version": "1.0.0",
            "description": "JDBC driver",
            "default_port": null,
            "capabilities": capabilities
        }))
        .unwrap();

        assert_eq!(manifest.capabilities.connection_string_examples.len(), 1);
        assert_eq!(
            manifest.capabilities.connection_string_examples[0].label,
            "Local"
        );
        assert_eq!(
            manifest.capabilities.connection_string_examples[0].value,
            "jdbc:h2:mem:test"
        );
    }
}

#[test]
fn drivers_without_a_wired_deprecation_return_none() {
    // mysql/sqlite are expected to follow the same path later, but aren't
    // deprecated yet — and an unknown id must not panic or default to some
    // other driver's entry.
    assert!(deprecation_for_builtin("mysql").is_none());
    assert!(deprecation_for_builtin("sqlite").is_none());
    assert!(deprecation_for_builtin("not-a-real-driver").is_none());
}
