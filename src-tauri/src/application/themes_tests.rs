use super::*;
use crate::runtime::events::RuntimeEvents;
use crate::runtime::paths::FixedRuntimePaths;
use crate::runtime::secrets::RuntimeSecrets;
use bytes::Bytes;
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct RecordingEvents {
    values: Mutex<Vec<String>>,
}

impl RuntimeEvents for RecordingEvents {
    fn emit(&self, event: &str, _payload: Value) -> Result<(), String> {
        self.values
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push(event.to_string());
        Ok(())
    }
}

struct NoSecrets;

impl RuntimeSecrets for NoSecrets {
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

fn runtime(temp: &tempfile::TempDir) -> (RuntimeContext, Arc<RecordingEvents>) {
    let events = Arc::new(RecordingEvents::default());
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().join("config"),
            temp.path().join("data"),
        )),
        events.clone(),
        Arc::new(NoSecrets),
    );
    (runtime, events)
}

#[tokio::test]
async fn reads_the_catalog_from_the_runtime_config_folder() {
    let temp = tempfile::tempdir().unwrap();
    let (runtime, events) = runtime(&temp);
    let catalog = execute(&runtime, ThemeCommand::GetCatalog).await.unwrap();
    assert!(!catalog["themes"].as_array().unwrap().is_empty());
    assert!(events.values.lock().unwrap().is_empty());
}

#[tokio::test]
async fn announces_committed_personal_theme_changes() {
    let temp = tempfile::tempdir().unwrap();
    let (runtime, events) = runtime(&temp);
    let catalog = catalog(&runtime);
    let builtin = catalog
        .themes
        .iter()
        .find(|entry| entry.format == "legacy" && entry.editor.is_none())
        .expect("a builtin legacy theme");

    let imported = execute(
        &runtime,
        ThemeCommand::ImportTheme {
            theme_json: builtin.source.clone(),
            name: Some("Imported copy".into()),
        },
    )
    .await
    .unwrap();
    assert!(imported.is_object());
    assert_eq!(
        events.values.lock().unwrap().as_slice(),
        ["theme-catalog-changed"]
    );
    assert!(catalog_contains(&runtime, "Imported copy"));

    // A rejected document changes nothing and is not announced.
    assert!(execute(
        &runtime,
        ThemeCommand::ImportTheme {
            theme_json: "{".into(),
            name: None,
        },
    )
    .await
    .is_err());
    assert_eq!(events.values.lock().unwrap().len(), 1);
}

fn catalog_contains(runtime: &RuntimeContext, name: &str) -> bool {
    catalog(runtime).themes.iter().any(|entry| entry.name == name)
}

#[tokio::test]
async fn reads_uploaded_archives_without_consuming_the_token() {
    let temp = tempfile::tempdir().unwrap();
    let (runtime, _events) = runtime(&temp);
    let owner = Uuid::new_v4();
    let store = FileTransferStore::new(runtime.paths.data_dir());
    let metadata = store
        .store_upload(
            owner,
            THEME_PACKAGE_UPLOAD_PURPOSE,
            "nord.zip",
            Some("application/zip"),
            futures::stream::iter([Ok::<_, std::io::Error>(Bytes::from_static(b"PK-bytes"))]),
        )
        .await
        .unwrap();

    for _ in 0..2 {
        let bytes = read_uploaded_archive(&runtime, owner, &metadata.token)
            .await
            .unwrap();
        assert_eq!(bytes, b"PK-bytes");
    }
    // Another session, or another purpose, cannot use the token.
    assert!(read_uploaded_archive(&runtime, Uuid::new_v4(), &metadata.token)
        .await
        .is_err());
    // Invalid archives surface the package validator's error.
    assert!(execute(
        &runtime,
        ThemeCommand::PreviewLocalPackage {
            archive: LocalThemeArchive::Upload {
                owner,
                token: metadata.token.clone(),
            },
        },
    )
    .await
    .is_err());
}
