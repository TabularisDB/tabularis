use super::*;
use crate::runtime::{
    events::NoopRuntimeEvents, paths::FixedRuntimePaths, secrets::RuntimeSecrets,
};
use std::fs;

#[derive(Default)]
struct NoopSecrets;

impl RuntimeSecrets for NoopSecrets {
    fn get(&self, _account: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    fn set(&self, _account: &str, _secret: &str) -> Result<(), String> {
        Ok(())
    }

    fn delete(&self, _account: &str) -> Result<(), String> {
        Ok(())
    }
}

fn runtime(root: &std::path::Path) -> RuntimeContext {
    RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            root.to_path_buf(),
            root.to_path_buf(),
        )),
        Arc::new(NoopRuntimeEvents),
        Arc::new(NoopSecrets),
    )
}

#[test]
fn persists_and_clears_selected_schemas_without_losing_other_settings() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = runtime(temp.path());
    fs::write(
        temp.path().join("config.json"),
        serde_json::json!({ "theme": "light" }).to_string(),
    )
    .unwrap();

    set_selected_schemas(
        &runtime,
        "connection-1".to_string(),
        vec!["public".to_string(), "analytics".to_string()],
    )
    .unwrap();
    assert_eq!(
        get_selected_schemas(&runtime, "connection-1"),
        vec!["public", "analytics"]
    );

    set_selected_schemas(&runtime, "connection-1".to_string(), Vec::new()).unwrap();
    assert!(get_selected_schemas(&runtime, "connection-1").is_empty());
    assert_eq!(load_config(&runtime).theme.as_deref(), Some("light"));
}

#[test]
fn persists_schema_preferences_per_connection() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = runtime(temp.path());

    set_schema_preference(&runtime, "connection-1".to_string(), "public".to_string()).unwrap();
    set_schema_preference(
        &runtime,
        "connection-2".to_string(),
        "analytics".to_string(),
    )
    .unwrap();

    assert_eq!(
        get_schema_preference(&runtime, "connection-1").as_deref(),
        Some("public")
    );
    assert_eq!(
        get_schema_preference(&runtime, "connection-2").as_deref(),
        Some("analytics")
    );
}
