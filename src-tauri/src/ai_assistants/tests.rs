use super::*;
use serde_json::{json, Value};
use std::io::Write;

pub(super) fn package(id: &str) -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../plugins/ai-assistants/packages")
        .join(id)
        .join(".tabularium");
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

fn archive(manifest: &Value, extra: Option<&str>) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default();
    writer.start_file(".tabularium", options).unwrap();
    writer.write_all(manifest.to_string().as_bytes()).unwrap();
    if let Some(path) = extra {
        writer.start_file(path, options).unwrap();
        writer.write_all(b"bad").unwrap();
    }
    writer.finish().unwrap().into_inner()
}

#[test]
fn validates_every_provider_as_data_and_rejects_executable_extensions() {
    for id in [
        "openai",
        "anthropic",
        "ollama",
        "openrouter",
        "requesty",
        "minimax",
        "custom-openai",
        "opper",
        "runcrate",
    ] {
        let input = package(id);
        assert!(parse_manifest(input.to_string().as_bytes()).is_ok(), "{id}");
        for key in [
            "executable",
            "interpreter",
            "ui_extensions",
            "explain_parsers",
        ] {
            let mut invalid = input.clone();
            invalid[key] = json!("anything");
            assert!(parse_manifest(invalid.to_string().as_bytes()).is_err());
        }
    }
    for (key, value) in [
        ("kind", json!("driver")),
        ("id", json!("../outside")),
        ("id", json!("chatgpt")),
    ] {
        let mut input = package("openai");
        input[key] = value;
        assert!(parse_manifest(input.to_string().as_bytes()).is_err());
    }
    let mut input = package("openai");
    input["ai_assistant"]["api_version"] = json!(2);
    assert!(parse_manifest(input.to_string().as_bytes()).is_err());
}

#[test]
fn failed_update_preserves_installed_provider_and_never_enters_driver_discovery() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("plugins");
    let dest = destination(&root, "openai").unwrap();
    let guard = crate::plugins::install_cancellation::begin("archive-test-openai").unwrap();
    let good = archive(&package("openai"), None);
    install::install_archive(&dest, "openai", "1.0.0", &good, guard.cancellation()).unwrap();
    for bad in [
        archive(&package("anthropic"), None),
        archive(&package("openai"), Some("../escape")),
        archive(&package("openai"), Some("code.js")),
    ] {
        assert!(
            install::install_archive(&dest, "openai", "1.0.0", &bad, guard.cancellation()).is_err()
        );
        assert_eq!(read_manifest(&root, "openai").unwrap().version, "1.0.0");
    }
    assert_eq!(list_installed(&root).len(), 1);
    assert!(crate::plugins::installer::list_installed_from(&root).is_empty());
}

#[test]
fn json_templates_preserve_types_and_cannot_interpolate_credentials() {
    let variables = json!({"model":"x","prompt":"\"\n{{api_key}}","system_prompt":"s","settings":{"port":11434,"base_url":"http://localhost:11434/v1/"}});
    assert_eq!(
        recipe::render(
            &json!({"prompt":"{{prompt}}","port":"{{settings.port}}"}),
            &variables
        )
        .unwrap(),
        json!({"prompt":"\"\n{{api_key}}","port":11434})
    );
    assert!(recipe::render(&json!("{{api_key}}"), &variables).is_err());
    assert!(recipe::request_url("https://example.invalid/{{prompt}}", "", &variables).is_err());
    assert_eq!(
        recipe::request_url("{{settings.base_url}}", "/chat/completions", &variables)
            .unwrap()
            .as_str(),
        "http://localhost:11434/v1/chat/completions"
    );
}

#[test]
fn response_selectors_skip_anthropic_thinking_blocks() {
    let manifest = parse_manifest(package("anthropic").to_string().as_bytes()).unwrap();
    let response = &manifest.ai_assistant.generate.response;
    assert_eq!(recipe::response_text(&json!({"content":[{"type":"thinking","thinking":"private"},{"type":"text","text":"```sql\nSELECT 1;\n```"}]}),response).unwrap(),"SELECT 1;");
    assert!(recipe::response_text(
        &json!({"content":[{"type":"thinking","thinking":"private"}]}),
        response
    )
    .is_err());
}

#[test]
fn migration_only_installs_previously_configured_legacy_providers() {
    let config = crate::config::AppConfig {
        ai_provider: Some("ollama".into()),
        ai_custom_models: Some(std::collections::HashMap::from([
            ("anthropic".into(), vec!["custom".into()]),
            ("unknown".into(), vec![]),
        ])),
        ai_custom_openai_url: Some("https://example.invalid/v1".into()),
        ..Default::default()
    };
    assert_eq!(
        migration::candidates(&config, &["openrouter".into()]),
        ["anthropic", "custom-openai", "ollama", "openrouter"]
            .map(str::to_owned)
            .into_iter()
            .collect()
    );
    let config = crate::config::AppConfig {
        ai_provider: Some("chatgpt".into()),
        ..Default::default()
    };
    assert!(migration::candidates(&config, &[]).is_empty());
}

#[derive(Default)]
struct NoSecrets;
impl crate::runtime::secrets::RuntimeSecrets for NoSecrets {
    fn get(&self, _: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
    fn set(&self, _: &str, _: &str) -> Result<(), String> {
        Ok(())
    }
    fn delete(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
}

#[tokio::test]
async fn completed_migration_preserves_settings_and_does_not_undo_uninstall() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = crate::runtime::RuntimeContext::new(
        std::sync::Arc::new(crate::runtime::paths::FixedRuntimePaths::new(
            temp.path().join("config"),
            temp.path().join("data"),
        )),
        std::sync::Arc::new(crate::runtime::events::NoopRuntimeEvents),
        std::sync::Arc::new(NoSecrets),
    );
    std::fs::create_dir_all(runtime.paths.config_dir()).unwrap();
    for id in ["ollama", "custom-openai"] {
        let dir = destination(&runtime.paths.plugins_dir(), id).unwrap();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(".tabularium"), package(id).to_string()).unwrap();
    }
    let config = json!({"aiProvider":"ollama","aiModel":"saved-model","aiOllamaPort":12345,"aiCustomOpenaiUrl":"http://localhost:12346/v1","aiCustomOpenaiModel":"saved-custom-model","language":"it"});
    std::fs::write(
        runtime.paths.config_dir().join("config.json"),
        config.to_string(),
    )
    .unwrap();
    let marker = runtime
        .paths
        .config_dir()
        .join("ai-assistant-migration-v1.json");
    std::fs::write(
        &marker,
        json!({"pending":["ollama","custom-openai"],"completed":[]}).to_string(),
    )
    .unwrap();
    let cache = crate::credential_cache::CredentialCache::default();
    migrate_legacy_providers(&runtime, &cache).await.unwrap();
    let saved = crate::application::persistence::load_config(&runtime);
    assert_eq!(saved.ai_provider.as_deref(), Some("ollama"));
    assert_eq!(saved.ai_model.as_deref(), Some("saved-model"));
    assert_eq!(saved.language.as_deref(), Some("it"));
    let settings = saved.plugins.unwrap();
    assert_eq!(settings["ollama"].settings["port"], 12345);
    assert_eq!(
        settings["custom-openai"].settings["model"],
        "saved-custom-model"
    );
    uninstall(&runtime, "ollama").unwrap();
    migrate_legacy_providers(&runtime, &cache).await.unwrap();
    assert!(!destination(&runtime.paths.plugins_dir(), "ollama")
        .unwrap()
        .exists());
    let state: Value = serde_json::from_slice(&std::fs::read(marker).unwrap()).unwrap();
    assert_eq!(state["pending"], json!([]));
}

#[test]
fn interrupted_update_recovers_the_previous_declarative_package() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("plugins");
    let original = destination(&root, "openai").unwrap();
    std::fs::create_dir_all(&original).unwrap();
    std::fs::write(original.join(".tabularium"), package("openai").to_string()).unwrap();
    let backup = root.join(KIND).join(".backup-openai");
    std::fs::rename(&original, &backup).unwrap();
    recover_installations(&root);
    assert_eq!(read_manifest(&root, "openai").unwrap().version, "1.0.0");
    assert!(!backup.exists());
}

#[tokio::test]
async fn offline_upgrade_keeps_its_pending_snapshot_and_retries_without_resetting_selection() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = crate::runtime::RuntimeContext::new(
        std::sync::Arc::new(crate::runtime::paths::FixedRuntimePaths::new(
            temp.path().join("config"),
            temp.path().join("data"),
        )),
        std::sync::Arc::new(crate::runtime::events::NoopRuntimeEvents),
        std::sync::Arc::new(NoSecrets),
    );
    std::fs::create_dir_all(runtime.paths.config_dir()).unwrap();
    std::fs::write(runtime.paths.config_dir().join("config.json"),json!({"aiProvider":"openai","aiModel":"saved-model","tabulariumRegistryUrl":"http://127.0.0.1:1"}).to_string()).unwrap();
    let marker = runtime
        .paths
        .config_dir()
        .join("ai-assistant-migration-v1.json");
    std::fs::write(
        &marker,
        json!({"pending":["openai"],"completed":[]}).to_string(),
    )
    .unwrap();
    let cache = crate::credential_cache::CredentialCache::default();
    migrate_legacy_providers(&runtime, &cache).await.unwrap();
    let state: Value = serde_json::from_slice(&std::fs::read(&marker).unwrap()).unwrap();
    assert_eq!(state["pending"], json!(["openai"]));
    let directory = destination(&runtime.paths.plugins_dir(), "openai").unwrap();
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join(".tabularium"), package("openai").to_string()).unwrap();
    migrate_legacy_providers(&runtime, &cache).await.unwrap();
    let state: Value = serde_json::from_slice(&std::fs::read(marker).unwrap()).unwrap();
    assert_eq!(state["pending"], json!([]));
    assert_eq!(
        crate::application::persistence::load_config(&runtime)
            .ai_model
            .as_deref(),
        Some("saved-model")
    );
}
