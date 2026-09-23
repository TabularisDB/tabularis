use super::super::{read_theme_catalog, registry_key, transport::install_registry_package};
use super::{archive, http_fixture::RegistryServer};
use crate::plugins::{install_cancellation, tabularium};
use serde_json::json;
use std::time::Duration;

fn archive_version(version: &str) -> Vec<u8> {
    let mut manifest = archive::manifest();
    manifest["version"] = json!(version);
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
async fn discovery_and_detail_classify_registered_tags_without_downloads() {
    let server = RegistryServer::new(archive_version("1.0.0"));
    let themes = tabularium::fetch_theme_list(&server.base).await.unwrap();
    assert_eq!(themes.len(), 1);
    assert_eq!(themes[0].kind.as_deref(), Some("theme"));
    assert_eq!(themes[0].downloads, Some(0));
    assert!(server
        .requests
        .lock()
        .unwrap()
        .iter()
        .any(|path| path.contains("kind=theme")));
    let detail = tabularium::fetch_plugin_detail(&server.base, "fixture-theme")
        .await
        .unwrap();
    assert_eq!(detail.kind.as_deref(), Some("theme"));
    assert!(server.tracked().is_empty());
    server.state.lock().unwrap().tags = vec!["sql".into(), "driver".into()];
    let drivers = tabularium::fetch_plugin_list(&server.base).await.unwrap();
    assert_eq!(drivers[0].kind.as_deref(), Some("driver"));
    assert!(tabularium::fetch_theme_list(&server.base)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn latest_and_explicit_updates_follow_one_tracked_redirect_and_preserve_preferences() {
    let server = RegistryServer::new(archive_version("1.0.0"));
    let root = tempfile::tempdir().unwrap();
    let preferences = br#"{"theme":"missing-installed-choice","editorTheme":"nord"}"#;
    std::fs::write(root.path().join("config.json"), preferences).unwrap();
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
    assert_eq!(
        server.tracked(),
        vec!["/api/plugins/fixture-theme/latest?os=universal&arch=&redirect=1"]
    );
    let first = read_theme_catalog(root.path(), root.path(), "0.24.0")
        .themes
        .into_iter()
        .find(|entry| entry.origin["kind"] == "installed")
        .unwrap();
    {
        let mut state = server.state.lock().unwrap();
        state.version = "2.0.0".into();
        state.bytes = archive_version("2.0.0");
    }
    install_registry_package(
        root.path(),
        &server.base,
        &key,
        "fixture-theme",
        Some("2.0.0"),
        "0.24.0",
    )
    .await
    .unwrap();
    let updated = read_theme_catalog(root.path(), root.path(), "0.24.0")
        .themes
        .into_iter()
        .find(|entry| entry.origin["kind"] == "installed")
        .unwrap();
    assert_eq!(first.id, updated.id);
    assert_eq!(updated.origin["packageVersion"], "2.0.0");
    assert_eq!(server.tracked().len(), 2);
    assert_eq!(
        server.tracked()[1],
        "/api/plugins/fixture-theme/releases/2.0.0?os=universal&arch=&redirect=1"
    );
    assert_eq!(
        std::fs::read(root.path().join("config.json")).unwrap(),
        preferences
    );
}

#[tokio::test]
async fn registry_change_wrong_kind_and_multiple_assets_fail_before_tracked_downloads() {
    let server = RegistryServer::new(archive_version("1.0.0"));
    let root = tempfile::tempdir().unwrap();
    let key = registry_key(&server.base).unwrap();
    assert!(install_registry_package(
        root.path(),
        &server.base,
        &"a".repeat(64),
        "fixture-theme",
        None,
        "0.24.0"
    )
    .await
    .is_err());
    assert!(server.requests.lock().unwrap().is_empty());
    server.state.lock().unwrap().tags = vec!["driver".into()];
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
    {
        let mut state = server.state.lock().unwrap();
        state.tags = vec!["theme".into()];
        state.assets = Some(json!({"universal":{"url":"x"},"linux-x64":{"url":"y"}}));
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
    .contains("universal"));
    assert!(server.tracked().is_empty());
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn integrity_and_download_limits_leave_the_previous_installation_unchanged() {
    let server = RegistryServer::new(archive_version("1.0.0"));
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
    for failure in ["hash", "signature", "oversize"] {
        {
            let mut state = server.state.lock().unwrap();
            state.hash = (failure == "hash").then(|| "0".repeat(64));
            state.invalid_signature = failure == "signature";
            state.oversize = failure == "oversize";
        }
        let previous = server.tracked().len();
        assert!(
            install_registry_package(
                root.path(),
                &server.base,
                &key,
                "fixture-theme",
                None,
                "0.24.0"
            )
            .await
            .is_err(),
            "{failure}"
        );
        if failure == "signature" {
            assert_eq!(server.tracked().len(), previous);
        }
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert!(!root.path().join("config.json").exists());
    }
}

#[tokio::test]
async fn cancellation_during_redirected_download_has_no_commit_or_profile_write() {
    let server = RegistryServer::new(archive_version("1.0.0"));
    server.state.lock().unwrap().delay_download = true;
    let root = tempfile::tempdir().unwrap();
    let key = registry_key(&server.base).unwrap();
    let operation = install_registry_package(
        root.path(),
        &server.base,
        &key,
        "fixture-theme",
        None,
        "0.24.0",
    );
    let cancel = async {
        for _ in 0..200 {
            if server
                .requests
                .lock()
                .unwrap()
                .iter()
                .any(|path| path.starts_with("/asset/"))
            {
                assert!(install_cancellation::cancel(&format!(
                    "theme:{key}:fixture-theme"
                )));
                return;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        panic!("Fixture download never started");
    };
    let (result, ()) = tokio::join!(operation, cancel);
    assert_eq!(
        result.unwrap_err(),
        install_cancellation::INSTALL_CANCELLED_ERROR
    );
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn driver_platform_precedence_and_tracked_route_shapes_are_unchanged() {
    let server = RegistryServer::new(archive_version("1.0.0"));
    {
        let mut state = server.state.lock().unwrap();
        state.tags = vec!["driver".into()];
        state.assets = Some(
            json!({"universal":{"url":format!("{}/universal.zip",server.base),"sha256":"1".repeat(64)},"linux-x64":{"url":format!("{}/linux.zip",server.base),"sha256":"2".repeat(64)}}),
        );
    }
    let asset = tabularium::resolve_asset(&server.base, "fixture-theme", "1.0.0", "linux-x64")
        .await
        .unwrap();
    assert!(asset.download_url.ends_with("/linux.zip"));
    assert_eq!(asset.expected_sha256.unwrap(), "2".repeat(64));
    assert!(
        tabularium::tracked_download_url(&server.base, "fixture-theme", "1.0.0", "linux-x64")
            .ends_with("?os=linux&arch=x64&redirect=1")
    );
    assert!(
        tabularium::tracked_latest_download_url(&server.base, "fixture-theme", "linux-x64")
            .ends_with("/latest?os=linux&arch=x64&redirect=1")
    );
    assert!(server.tracked().is_empty());
}
