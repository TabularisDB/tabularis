use super::AppConfig;

#[test]
fn old_configs_do_not_suppress_plugin_notifications() {
    let config: AppConfig = serde_json::from_str(r#"{"lastDismissedVersion":"0.25.0"}"#).unwrap();
    assert!(config.notified_plugin_versions.is_none());
    assert_eq!(config.last_dismissed_version.as_deref(), Some("0.25.0"));
}

#[test]
fn notified_plugin_versions_round_trip_independently_of_core_dismissal() {
    let json = serde_json::json!({
        "notifiedPluginVersions": { "postgresql": "2.0.0", "redis": "3.1.0" },
        "lastDismissedVersion": "0.25.0"
    });
    let config: AppConfig = serde_json::from_value(json.clone()).unwrap();
    let serialized = serde_json::to_value(&config).unwrap();
    assert_eq!(serialized["notifiedPluginVersions"], json["notifiedPluginVersions"]);
    assert_eq!(serialized["lastDismissedVersion"], json["lastDismissedVersion"]);
    let restored: AppConfig = serde_json::from_value(serialized).unwrap();
    assert_eq!(restored.notified_plugin_versions, config.notified_plugin_versions);
}
