use super::{
    cancel_plugin_install, get_installed_plugins, get_plugin_manifest, install_registry_base_url,
    validate_plugin_id,
};
use crate::config::AppConfig;
use crate::runtime::{
    events::NoopRuntimeEvents, paths::FixedRuntimePaths, secrets::KeyringRuntimeSecrets,
    RuntimeContext,
};
use std::fs;
use std::sync::Arc;
use tempfile::tempdir;

fn runtime(root: &std::path::Path) -> RuntimeContext {
    RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            root.join("config"),
            root.join("data"),
        )),
        Arc::new(NoopRuntimeEvents),
        Arc::new(KeyringRuntimeSecrets),
    )
}

#[test]
fn plugin_identifiers_reject_paths_and_accept_registry_slugs() {
    for valid in ["postgres-driver", "oracle_23.ai", "Driver2"] {
        assert!(validate_plugin_id(valid).is_ok(), "{valid}");
    }
    for invalid in [
        "",
        ".hidden",
        "../outside",
        "nested/plugin",
        "nested\\plugin",
    ] {
        assert!(validate_plugin_id(invalid).is_err(), "{invalid}");
    }
}

#[test]
fn selected_install_registries_are_explicit_and_safe() {
    let config = AppConfig::default();
    assert_eq!(
        install_registry_base_url(&config, None),
        Ok((
            crate::plugins::registry::DEFAULT_TABULARIUM_URL.to_string(),
            false,
        )),
    );
    assert_eq!(
        install_registry_base_url(&config, Some("https://registry.example/api/")),
        Ok(("https://registry.example/api".to_string(), true)),
    );
    assert_eq!(
        install_registry_base_url(&config, Some("http://127.0.0.1:9000/registry")),
        Ok(("http://127.0.0.1:9000/registry".to_string(), true)),
    );

    for invalid in [
        "file:///tmp/plugins",
        "https://user:secret@registry.example",
        "https://registry.example/api?token=secret",
        "https://registry.example/api#release",
    ] {
        assert!(
            install_registry_base_url(&config, Some(invalid)).is_err(),
            "{invalid}",
        );
    }
}

#[test]
fn installed_plugins_and_manifests_use_runtime_scoped_paths() {
    let root = tempdir().expect("temp dir");
    let runtime = runtime(root.path());
    let plugin_dir = runtime.paths.plugins_dir().join("contract-driver");
    fs::create_dir_all(&plugin_dir).expect("plugin dir");
    fs::write(
        plugin_dir.join(".tabularium"),
        r#"{
  "name": "contract-driver",
  "version": "1.2.3",
  "description": "Contract driver",
  "default_port": 5432,
  "capabilities": {
    "schemas": true,
    "views": true,
    "routines": false,
    "file_based": false,
    "folder_based": false,
    "identifier_quote": "\"",
    "alter_primary_key": false
  }
}"#,
    )
    .expect("manifest");

    let installed = get_installed_plugins(&runtime);
    assert_eq!(installed.len(), 1);
    assert_eq!(installed[0].id, "contract-driver");

    let manifest =
        get_plugin_manifest(&runtime, "contract-driver".to_string()).expect("plugin manifest");
    assert_eq!(manifest.id, "contract-driver");
    assert_eq!(manifest.default_port, Some(5432));
}

#[test]
fn lifecycle_inputs_are_validated_before_global_state_or_filesystem_access() {
    assert!(cancel_plugin_install("../outside".to_string()).is_err());

    let root = tempdir().expect("temp dir");
    let runtime = runtime(root.path());
    let error = get_plugin_manifest(&runtime, "../outside".to_string())
        .expect_err("path-like plugin id must fail");
    assert!(error.contains("Invalid plugin identifier"));
}
