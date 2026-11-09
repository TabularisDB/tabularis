use super::AppConfig;

#[test]
fn interface_scale_preserves_old_profiles_and_round_trips() {
    let old: AppConfig = serde_json::from_str("{}").unwrap();
    assert_eq!(old.interface_scale, None);
    let scaled: AppConfig = serde_json::from_str(r#"{"interfaceScale":125}"#).unwrap();
    assert_eq!(scaled.interface_scale, Some(125));
    let saved = serde_json::to_value(scaled).unwrap();
    assert_eq!(saved["interfaceScale"], 125);
    assert!(saved.get("interface_scale").is_none());
}
