use super::super::{registry_key, transport::install_registry_package};
use super::{archive, http_fixture::RegistryServer};
use crate::plugins::tabularium;
use serde_json::json;

fn bytes() -> Vec<u8> {
    let mut manifest = archive::manifest();
    manifest["min_runtime_version"] = json!("0.24.0");
    archive::package(
        vec![
            (".tabularium".into(), serde_json::to_vec(&manifest).unwrap()),
            ("themes/dark.json".into(), archive::definition()),
        ],
        false,
    )
}

#[tokio::test]
async fn malformed_extra_assets_and_ambiguous_kind_tags_cannot_evade_early_checks() {
    let server = RegistryServer::new(bytes());
    let root = tempfile::tempdir().unwrap();
    let key = registry_key(&server.base).unwrap();
    server.state.lock().unwrap().assets =
        Some(json!({"universal":{"url":"https://example.invalid/theme.zip"},"linux-x64":{}}));
    let detail = tabularium::fetch_plugin_detail(&server.base, "fixture-theme")
        .await
        .unwrap();
    assert_eq!(detail.releases[0].assets.len(), 2);
    assert!(install_registry_package(
        root.path(),
        &server.base,
        &key,
        "fixture-theme",
        None,
        "0.24.0"
    )
    .await
    .unwrap_err()
    .contains("universal"));
    {
        let mut state = server.state.lock().unwrap();
        state.assets = None;
        state.tags = vec!["theme".into(), "driver".into()];
    }
    assert!(install_registry_package(
        root.path(),
        &server.base,
        &key,
        "fixture-theme",
        None,
        "0.24.0"
    )
    .await
    .unwrap_err()
    .contains("theme"));
    assert!(server.tracked().is_empty());
}

#[tokio::test]
async fn latest_archive_version_drift_preserves_the_previous_package() {
    let server = RegistryServer::new(bytes());
    let root = tempfile::tempdir().unwrap();
    let key = registry_key(&server.base).unwrap();
    install_registry_package(
        root.path(),
        &server.base,
        &key,
        "fixture-theme",
        None,
        "0.24.0",
    )
    .await
    .unwrap();
    let path = root
        .path()
        .join("plugins/themes")
        .join("fixture-theme/.tabularium");
    let before = std::fs::read(&path).unwrap();
    server.state.lock().unwrap().version = "2.0.0".into();
    assert!(install_registry_package(
        root.path(),
        &server.base,
        &key,
        "fixture-theme",
        None,
        "0.24.0"
    )
    .await
    .is_err());
    assert_eq!(std::fs::read(path).unwrap(), before);
    assert_eq!(server.tracked().len(), 2);
}
