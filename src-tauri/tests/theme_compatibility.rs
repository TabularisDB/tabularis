use serde_json::Value;
use tabularis_lib::theme_models::Theme;

const LEGACY_NATIVE: &str = include_str!("../../tests/fixtures/themes/legacy-native.json");
const LEGACY_NULLABLE: &str =
    include_str!("../../tests/fixtures/themes/legacy-native-nullable.json");

#[test]
fn historical_native_theme_preserves_all_serialized_fields() {
    let original: Value = serde_json::from_str(LEGACY_NATIVE).unwrap();
    let theme: Theme = serde_json::from_str(LEGACY_NATIVE).unwrap();

    assert_eq!(theme.id, "custom-1700000000000");
    assert!(!theme.is_preset);
    assert!(!theme.is_read_only);
    assert_eq!(theme.author.as_deref(), Some("Fixture author"));
    assert_eq!(
        theme.monaco_theme.rules.as_ref().unwrap()[0]
            .font_style
            .as_deref(),
        Some("bold italic")
    );
    assert_eq!(serde_json::to_value(theme).unwrap(), original);
}

#[test]
fn historical_null_metadata_and_editor_options_remain_readable() {
    let theme: Theme = serde_json::from_str(LEGACY_NULLABLE).unwrap();
    assert!(theme.author.is_none());
    assert!(theme.version.is_none());
    assert!(theme.created_at.is_none());
    assert!(theme.updated_at.is_none());
    assert!(theme.taskbar_icon.is_none());
    assert!(theme.monaco_theme.rules.is_none());
    assert!(theme.monaco_theme.colors.is_none());
    assert!(theme.monaco_theme.theme_name.is_none());

    let serialized = serde_json::to_value(&theme).unwrap();
    let reloaded: Theme = serde_json::from_value(serialized.clone()).unwrap();
    assert_eq!(serde_json::to_value(reloaded).unwrap(), serialized);
    assert_eq!(
        serialized["colors"],
        serde_json::from_str::<Value>(LEGACY_NULLABLE).unwrap()["colors"]
    );
}

#[test]
fn historical_optional_fields_can_also_be_absent() {
    let mut original: Value = serde_json::from_str(LEGACY_NULLABLE).unwrap();
    let object = original.as_object_mut().unwrap();
    for field in ["author", "version", "createdAt", "updatedAt", "taskbarIcon"] {
        object.remove(field);
    }
    let editor = original["monacoTheme"].as_object_mut().unwrap();
    for field in ["rules", "colors", "themeName"] {
        editor.remove(field);
    }
    let omitted: Theme = serde_json::from_value(original).unwrap();
    let nullable: Theme = serde_json::from_str(LEGACY_NULLABLE).unwrap();
    assert_eq!(
        serde_json::to_value(omitted).unwrap(),
        serde_json::to_value(nullable).unwrap()
    );
}

#[test]
fn historical_selection_shapes_preserve_supplied_config_values() {
    let cases: Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/themes/selection-shapes.json"
    ))
    .unwrap();
    for case in cases.as_array().unwrap() {
        let original = &case["config"];
        let config: tabularis_lib::config::AppConfig =
            serde_json::from_value(original.clone()).unwrap();
        let serialized = serde_json::to_value(config).unwrap();
        for (key, value) in original.as_object().unwrap() {
            assert_eq!(&serialized[key], value, "{}: {key}", case["name"]);
        }
    }
}
