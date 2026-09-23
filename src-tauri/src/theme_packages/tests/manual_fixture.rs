use super::super::*;
use crate::plugins::tabularium;
use serde_json::Value;

#[test]
fn staged_invalid_archive_and_corrupt_personal_file_are_rejected_without_repairing_preferences() {
    assert!(lifecycle::local_preview(
        include_bytes!("../../../../tests/fixtures/themes/author/invalid.zip"),
        "0.24.0"
    )
    .is_err());
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("theme-personal-v1");
    std::fs::create_dir(&directory).unwrap();
    let source = include_str!("../../../../tests/fixtures/themes/author/corrupt-personal.json");
    std::fs::write(directory.join("custom-corrupt.json"), source).unwrap();
    let prefs = "{\"theme\":\"custom-corrupt\"}";
    std::fs::write(root.path().join("config.json"), prefs).unwrap();
    let catalog = read_theme_catalog(root.path(), root.path(), "0.24.0");
    assert!(!catalog.issues.is_empty());
    assert!(!catalog
        .themes
        .iter()
        .any(|entry| entry.id == "custom-corrupt"));
    assert_eq!(
        std::fs::read_to_string(directory.join("custom-corrupt.json")).unwrap(),
        source
    );
    assert_eq!(
        std::fs::read_to_string(root.path().join("config.json")).unwrap(),
        prefs
    );
}

async fn fixture_count(base: &str) -> u64 {
    let response = reqwest::get(format!("{base}/__fixture/status"))
        .await
        .unwrap();
    assert_eq!(
        response.headers().get("X-Tabularis-Theme-Fixture").unwrap(),
        "791"
    );
    response.json::<Value>().await.unwrap()["total"]
        .as_u64()
        .unwrap()
}

/// Opt-in because the human-facing Node fixture is a separate process. This is
/// executed explicitly in local verification, never against the public registry.
#[tokio::test]
#[ignore = "start tests/fixtures/themes/manual-registry.mjs and set THEME_TEST_REGISTRY_URL to its loopback URL"]
async fn manual_node_fixture_is_usable_by_the_real_sdk_and_theme_installer() {
    let base = std::env::var("THEME_TEST_REGISTRY_URL").expect("explicit loopback fixture URL");
    let url = reqwest::Url::parse(&base).unwrap();
    assert_eq!(url.scheme(), "http");
    assert_eq!(url.host_str(), Some("127.0.0.1"));
    assert!(url.username().is_empty() && url.password().is_none());
    let before = fixture_count(&base).await;
    assert_eq!(tabularium::fetch_theme_list(&base).await.unwrap().len(), 1);
    let detail = tabularium::fetch_theme_detail(&base, "fixture-theme")
        .await
        .unwrap();
    assert_eq!(detail.plugin.kind.as_deref(), Some("theme"));
    assert!(
        tabularium::fetch_plugin_readme(&base, "fixture-theme", Some("en"))
            .await
            .unwrap()
            .html
            .is_some()
    );
    assert_eq!(fixture_count(&base).await, before);
    let root = tempfile::tempdir().unwrap();
    let key = registry_key(&base).unwrap();
    transport::install_registry_package(root.path(), &base, &key, "fixture-theme", None, "0.24.0")
        .await
        .unwrap();
    let installed: Vec<_> = read_theme_catalog(root.path(), root.path(), "0.24.0")
        .themes
        .into_iter()
        .filter(|entry| entry.origin["kind"] == "installed")
        .collect();
    assert!(!installed.is_empty());
    transport::install_registry_package(
        root.path(),
        &base,
        &key,
        "fixture-theme",
        Some("2.0.0"),
        "0.24.0",
    )
    .await
    .unwrap();
    let updated = read_theme_catalog(root.path(), root.path(), "0.24.0");
    assert!(installed.iter().all(|entry| updated
        .themes
        .iter()
        .any(|current| current.id == entry.id && current.origin["packageVersion"] == "2.0.0")));
    assert_eq!(fixture_count(&base).await, before + 2);
    assert!(!root.path().join("config.json").exists());
    assert!(!root.path().join("plugins").exists());
}
