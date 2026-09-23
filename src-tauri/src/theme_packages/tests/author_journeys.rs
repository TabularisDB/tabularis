use super::super::*;
use super::http_fixture::RegistryServer;
use crate::plugins::tabularium;
use serde_json::json;

const ORIGINAL_V1: &[u8] =
    include_bytes!("../../../../tests/fixtures/themes/author/original-v1.zip");
const ORIGINAL_V2: &[u8] =
    include_bytes!("../../../../tests/fixtures/themes/author/original-v2.zip");
const IMPORTED_V1: &[u8] =
    include_bytes!("../../../../tests/fixtures/themes/author/imported-v1.zip");
const IMPORTED_V2: &[u8] =
    include_bytes!("../../../../tests/fixtures/themes/author/imported-v2.zip");

#[test]
fn author_generated_original_and_imported_archives_complete_local_lifecycle_without_preference_repairs(
) {
    for (first, second, variants) in [(ORIGINAL_V1, ORIGINAL_V2, 2), (IMPORTED_V1, IMPORTED_V2, 1)]
    {
        let root = tempfile::tempdir().unwrap();
        let preview = lifecycle::local_preview(first, "0.24.0").unwrap();
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
        assert!(!preview.variants.is_empty());
        let key = lifecycle::local_registry_key();
        let validated =
            validate_theme_archive(first, "fixture-theme", "1.0.0", "0.24.0", &|| Ok(())).unwrap();
        assert!(
            validate_theme_archive(first, "fixture-theme", "1.0.0", "0.23.0", &|| Ok(())).is_err()
        );
        install_validated_theme(
            &root.path().join("plugins"),
            &key,
            &validated,
            &|| Ok(()),
        )
        .unwrap();
        let installed: Vec<_> = read_theme_catalog(root.path(), root.path(), "0.24.0")
            .themes
            .into_iter()
            .filter(|entry| entry.origin["kind"] == "installed")
            .collect();
        assert_eq!(installed.len(), variants);
        assert!(installed
            .iter()
            .all(|entry| entry.read_only && entry.available));
        let dark = installed.iter().find(|entry| entry.mode == "dark").unwrap();
        let prefs = json!({"theme":dark.id,"editorTheme":dark.id,"themeSettings":{"activeThemeId":dark.id,"darkThemeId":dark.id,"followSystemTheme":true}}).to_string();
        std::fs::write(root.path().join("config.json"), &prefs).unwrap();
        let copy =
            duplicate_personal_theme(root.path(), root.path(), "0.24.0", &dark.id, "Independent", None).unwrap();
        let edited = update_personal_definition(root.path(), &copy.id, "Edited", "{\"schemaVersion\":1,\"mode\":\"dark\",\"colors\":{\"accent\":{\"primary\":\"#ff00aa\"}}}", &copy.revision).unwrap();
        assert_eq!(edited.origin["kind"], "personal");
        let update =
            validate_theme_archive(second, "fixture-theme", "2.0.0", "0.24.0", &|| Ok(())).unwrap();
        install_validated_theme(&root.path().join("plugins"), &key, &update, &|| {
            Ok(())
        })
        .unwrap();
        let catalog = read_theme_catalog(root.path(), root.path(), "0.24.0");
        for entry in &installed {
            assert!(catalog.themes.iter().any(
                |updated| updated.id == entry.id && updated.origin["packageVersion"] == "2.0.0"
            ));
        }
        assert_eq!(
            export_personal_theme(root.path(), &copy.id).unwrap(),
            edited.source
        );
        lifecycle::set_package_enabled(root.path(), &key, "fixture-theme", false).unwrap();
        assert!(read_theme_catalog(root.path(), root.path(), "0.24.0")
            .themes
            .iter()
            .filter(|entry| entry.origin["kind"] == "installed")
            .all(|entry| !entry.available));
        lifecycle::set_package_enabled(root.path(), &key, "fixture-theme", true).unwrap();
        lifecycle::remove_package(root.path(), &key, "fixture-theme").unwrap();
        assert!(read_theme_catalog(root.path(), root.path(), "0.24.0")
            .themes
            .iter()
            .all(|entry| entry.origin["kind"] != "installed"));
        assert_eq!(
            std::fs::read_to_string(root.path().join("config.json")).unwrap(),
            prefs
        );
        // Installers only create the mapped theme directory, never driver bundles.
        assert!(std::fs::read_dir(root.path().join("plugins"))
            .unwrap()
            .flatten()
            .all(|entry| entry.file_name() == "themes"));
    }
}

#[tokio::test]
async fn author_generated_archives_use_read_only_discovery_and_exact_tracked_registry_updates() {
    for (first, second) in [(ORIGINAL_V1, ORIGINAL_V2), (IMPORTED_V1, IMPORTED_V2)] {
        let server = RegistryServer::new(first.to_vec());
        assert_eq!(
            tabularium::fetch_theme_list(&server.base)
                .await
                .unwrap()
                .len(),
            1
        );
        tabularium::fetch_plugin_detail(&server.base, "fixture-theme")
            .await
            .unwrap();
        assert!(server.tracked().is_empty());
        let root = tempfile::tempdir().unwrap();
        let key = registry_key(&server.base).unwrap();
        transport::install_registry_package(
            root.path(),
            &server.base,
            &key,
            "fixture-theme",
            None,
            "0.24.0",
        )
        .await
        .unwrap();
        let ids: Vec<_> = read_theme_catalog(root.path(), root.path(), "0.24.0")
            .themes
            .into_iter()
            .filter(|entry| entry.origin["kind"] == "installed")
            .map(|entry| entry.id)
            .collect();
        {
            let mut state = server.state.lock().unwrap();
            state.bytes = second.to_vec();
            state.version = "2.0.0".into();
        }
        transport::install_registry_package(
            root.path(),
            &server.base,
            &key,
            "fixture-theme",
            Some("2.0.0"),
            "0.24.0",
        )
        .await
        .unwrap();
        let updated = read_theme_catalog(root.path(), root.path(), "0.24.0");
        assert!(ids.iter().all(|id| updated
            .themes
            .iter()
            .any(|entry| &entry.id == id && entry.origin["packageVersion"] == "2.0.0")));
        assert_eq!(
            server.tracked(),
            vec![
                "/api/plugins/fixture-theme/latest?os=universal&arch=&redirect=1",
                "/api/plugins/fixture-theme/releases/2.0.0?os=universal&arch=&redirect=1"
            ]
        );
        assert!(!root.path().join("config.json").exists());
        assert!(std::fs::read_dir(root.path().join("plugins"))
            .unwrap()
            .flatten()
            .all(|entry| entry.file_name() == "themes"));
    }
}

#[test]
fn fixture_counts_tracked_routes_even_without_redirect_but_not_integrity() {
    let server = RegistryServer::new(vec![]);
    server.requests.lock().unwrap().extend(
        [
            "/api/plugins/fixture-theme/latest",
            "/api/plugins/fixture-theme/releases/1.0.0?os=universal",
            "/api/plugins/fixture-theme/releases/1.0.0/integrity",
            "/asset/theme.zip",
        ]
        .map(str::to_string),
    );
    assert_eq!(server.tracked().len(), 2);
}
