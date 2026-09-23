use super::output::{OutputFormatError, ToolOutputFormat};
use crate::config::AppConfig;
use serde_json::{json, Map, Value};

#[test]
fn missing_output_format_preserves_pretty_json_default() {
    let value = json!({"rows": [[1, "Ada"], [2, "Linus"]]});
    let format = ToolOutputFormat::from_arguments(None, ToolOutputFormat::Json).unwrap();

    assert_eq!(format, ToolOutputFormat::Json);
    assert_eq!(
        format.encode(&value).unwrap(),
        serde_json::to_string_pretty(&value).unwrap()
    );
}

#[test]
fn explicit_json_preserves_pretty_json_output() {
    let arguments = arguments_with_output_format(json!("json"));
    let value = json!(["users", "orders"]);
    let format =
        ToolOutputFormat::from_arguments(Some(&arguments), ToolOutputFormat::Toon).unwrap();

    assert_eq!(format, ToolOutputFormat::Json);
    assert_eq!(
        format.encode(&value).unwrap(),
        "[\n  \"users\",\n  \"orders\"\n]"
    );
}

#[test]
fn toon_encodes_repeated_objects_as_tabular_data() {
    let arguments = arguments_with_output_format(json!("toon"));
    let value = json!({
        "rows": [
            {"id": 1, "name": "Ada"},
            {"id": 2, "name": "Linus"}
        ]
    });
    let format =
        ToolOutputFormat::from_arguments(Some(&arguments), ToolOutputFormat::Json).unwrap();

    assert_eq!(format, ToolOutputFormat::Toon);
    let encoded = format.encode(&value).unwrap();
    assert_eq!(encoded, "rows[2]{id,name}:\n  1,Ada\n  2,Linus");
    assert_eq!(
        toon_format::decode_default::<Value>(&encoded).unwrap(),
        value
    );
    assert!(encoded.len() < serde_json::to_string_pretty(&value).unwrap().len());
}

#[test]
fn unsupported_or_non_string_output_formats_are_rejected() {
    for value in [json!("yaml"), json!("TOON"), json!(true), Value::Null] {
        let arguments = arguments_with_output_format(value);
        assert_eq!(
            ToolOutputFormat::from_arguments(Some(&arguments), ToolOutputFormat::Json),
            Err(OutputFormatError::InvalidArgument)
        );
    }
}

#[test]
fn app_preference_is_used_when_argument_is_missing() {
    let config = AppConfig {
        mcp_output_format: Some("toon".to_string()),
        ..AppConfig::default()
    };

    assert_eq!(
        ToolOutputFormat::from_config(&config),
        ToolOutputFormat::Toon
    );
    assert_eq!(
        ToolOutputFormat::from_arguments(None, ToolOutputFormat::from_config(&config)).unwrap(),
        ToolOutputFormat::Toon
    );
}

#[test]
fn invalid_app_preference_safely_falls_back_to_json() {
    let config = AppConfig {
        mcp_output_format: Some("yaml".to_string()),
        ..AppConfig::default()
    };

    assert_eq!(
        ToolOutputFormat::from_config(&config),
        ToolOutputFormat::Json
    );
}

fn arguments_with_output_format(value: Value) -> Map<String, Value> {
    let mut arguments = Map::new();
    arguments.insert("output_format".to_string(), value);
    arguments
}
