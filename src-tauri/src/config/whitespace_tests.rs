use super::AppConfig;

#[test]
fn missing_whitespace_setting_preserves_legacy_configuration() {
    let config: AppConfig = serde_json::from_str("{}").unwrap();
    assert!(config.editor_render_whitespace.is_none());
    assert!(AppConfig::default().editor_render_whitespace.is_none());
}

#[test]
fn whitespace_modes_round_trip_independently_of_unicode_highlighting() {
    for mode in ["none", "selection", "all"] {
        for highlight in [false, true] {
            let config = AppConfig {
                editor_render_whitespace: Some(mode.to_string()),
                editor_highlight_invisible_characters: Some(highlight),
                ..AppConfig::default()
            };
            let json = serde_json::to_value(&config).unwrap();
            assert_eq!(json["editorRenderWhitespace"], mode);
            assert_eq!(json["editorHighlightInvisibleCharacters"], highlight);
            assert!(json.get("editor_render_whitespace").is_none());
            let restored: AppConfig = serde_json::from_value(json).unwrap();
            assert_eq!(restored.editor_render_whitespace.as_deref(), Some(mode));
            assert_eq!(
                restored.editor_highlight_invisible_characters,
                Some(highlight)
            );
        }
    }
}
