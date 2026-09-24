use super::*;
use crate::runtime::events::NoopRuntimeEvents;
use crate::runtime::paths::FixedRuntimePaths;
use crate::runtime::secrets::RuntimeSecrets;
use std::sync::Arc;

#[derive(Default)]
struct TestSecrets(Mutex<HashMap<String, String>>);

impl RuntimeSecrets for TestSecrets {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap().get(account).cloned())
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        self.0
            .lock()
            .unwrap()
            .insert(account.to_string(), secret.to_string());
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}

fn fixture() -> (tempfile::TempDir, RuntimeContext, Arc<TestSecrets>) {
    let temp = tempfile::tempdir().unwrap();
    let config = temp.path().join("config");
    let data = temp.path().join("data");
    fs::create_dir_all(&config).unwrap();
    fs::create_dir_all(&data).unwrap();
    let secrets = Arc::new(TestSecrets::default());
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(config, data)),
        Arc::new(NoopRuntimeEvents),
        secrets.clone(),
    );
    let mut params = crate::models::ConnectionParams::default();
    params.driver = "sqlite".to_string();
    params.database = crate::models::DatabaseSelection::Single("fixture.db".to_string());
    params.save_in_keychain = Some(true);
    let file = crate::models::ConnectionsFile {
        connections: vec![SavedConnection {
            id: "connection-1".to_string(),
            name: "Fixture".to_string(),
            params,
            group_id: None,
            sort_order: None,
            detect_json_in_text_columns: None,
            appearance: None,
            tag_ids: None,
            environment: None,
        }],
        ..Default::default()
    };
    crate::persistence::save_connections_file(&runtime.paths.connections_file(), &file).unwrap();
    (temp, runtime, secrets)
}

#[tokio::test]
async fn browser_exports_encrypt_before_creating_an_opaque_download() {
    let (_temp, runtime, secrets) = fixture();
    secrets.set("connection-1:db", "database-secret").unwrap();
    let session = Uuid::new_v4();

    let generated = generate_export_file(
        &runtime,
        Some(session),
        ConnectionExportMode::Encrypted,
        Some("export-password".to_string()),
        None,
    )
    .await
    .unwrap();

    let GeneratedFile::Download { token, .. } = generated else {
        panic!("browser exports must return a download token");
    };
    let mut reader = FileTransferStore::new(runtime.paths.data_dir())
        .consume_download(session, &token)
        .await
        .unwrap();
    let mut content = String::new();
    tokio::io::AsyncReadExt::read_to_string(&mut reader, &mut content)
        .await
        .unwrap();
    assert!(content.contains("tabularis-connections-encrypted"));
    assert!(!content.contains("database-secret"));
}

#[tokio::test]
async fn browser_rejects_plaintext_secret_exports() {
    let (_temp, runtime, _secrets) = fixture();
    let error = generate_export_file(
        &runtime,
        Some(Uuid::new_v4()),
        ConnectionExportMode::Plaintext,
        None,
        None,
    )
    .await
    .unwrap_err();
    assert!(error.contains("not available in the browser"));
}

#[tokio::test]
async fn manual_backup_writes_the_server_target_as_an_encrypted_artifact() {
    let (_temp, runtime, secrets) = fixture();
    let backup_dir = runtime.paths.data_dir().join("server-backups");
    fs::write(
        runtime.paths.config_dir().join("config.json"),
        serde_json::json!({
            "backupTarget": "local",
            "backupDirectory": backup_dir,
            "backupRetention": 2
        })
        .to_string(),
    )
    .unwrap();
    secrets
        .set("connections-backup", "backup-password")
        .unwrap();

    let artifact = crate::backup::run_backup_for_runtime(&runtime, "manual")
        .await
        .unwrap();

    assert!(matches!(
        artifact.target_kind,
        crate::backup::BackupTargetKind::ServerDirectory
    ));
    assert!(Path::new(&artifact.location).is_file());
    assert!(artifact.content.contains("tabularis-connections-encrypted"));
    assert!(!artifact.content.contains("backup-password"));
}

#[tokio::test]
async fn uploaded_tabularis_imports_are_session_scoped_and_single_use() {
    let (_temp, runtime, _secrets) = fixture();
    let session = Uuid::new_v4();
    let payload = export_payload(&runtime, false, None).await.unwrap();
    let content = serde_json::to_vec(&payload).unwrap();
    let transfer = FileTransferStore::new(runtime.paths.data_dir())
        .store_upload(
            session,
            CONNECTION_IMPORT_PURPOSE,
            "connections.json",
            Some("application/json"),
            futures::stream::once(async move {
                Ok::<bytes::Bytes, std::convert::Infallible>(bytes::Bytes::from(content))
            }),
        )
        .await
        .unwrap();
    let cache = ImportEnvelopeCache::default();

    let preview = preview_tabularis_import_file(
        &runtime,
        &cache,
        Some(session),
        ConnectionImportFile::Upload {
            token: transfer.token.clone(),
        },
        None,
    )
    .await
    .unwrap();

    let TabularisImportPreviewResult::Preview { preview } = preview else {
        panic!("plaintext imports must return a preview");
    };
    assert_eq!(preview.items.len(), 1);
    assert!(
        FileTransferStore::new(runtime.paths.data_dir())
            .claim_upload(session, &transfer.token, CONNECTION_IMPORT_PURPOSE)
            .is_err(),
        "the uploaded file token must be consumed by preview"
    );
    assert!(cache.tabularis.lock().unwrap().contains_key(&Some(session)));
    cache.clear_session(session);
    assert!(!cache.tabularis.lock().unwrap().contains_key(&Some(session)));
}

#[tokio::test]
async fn foreign_import_files_use_purpose_bound_single_use_uploads() {
    let (_temp, runtime, _secrets) = fixture();
    let session = Uuid::new_v4();
    let store = FileTransferStore::new(runtime.paths.data_dir());
    let upload = store
        .store_upload(
            session,
            CONNECTION_IMPORT_PURPOSE,
            "foreign.json",
            Some("application/json"),
            futures::stream::once(async {
                Ok::<bytes::Bytes, std::convert::Infallible>(bytes::Bytes::from_static(b"fixture"))
            }),
        )
        .await
        .unwrap();

    let resolved = resolve_import_file(
        &runtime,
        Some(session),
        Some(ConnectionImportFile::Upload {
            token: upload.token.clone(),
        }),
    )
    .unwrap()
    .unwrap();
    assert_eq!(fs::read_to_string(resolved.path()).unwrap(), "fixture");
    assert!(store
        .claim_upload(session, &upload.token, CONNECTION_IMPORT_PURPOSE)
        .is_err());
}

#[tokio::test]
async fn encrypted_upload_survives_a_wrong_password_for_retry() {
    let (_temp, runtime, _secrets) = fixture();
    let session = Uuid::new_v4();
    let payload = export_payload(&runtime, false, None).await.unwrap();
    let plaintext = serde_json::to_string(&payload).unwrap();
    let envelope = crate::export_crypto::encrypt(&plaintext, "correct-password").unwrap();
    let content = serde_json::to_vec(&envelope).unwrap();
    let transfer = FileTransferStore::new(runtime.paths.data_dir())
        .store_upload(
            session,
            CONNECTION_IMPORT_PURPOSE,
            "connections.json",
            Some("application/json"),
            futures::stream::once(async move {
                Ok::<bytes::Bytes, std::convert::Infallible>(bytes::Bytes::from(content))
            }),
        )
        .await
        .unwrap();
    let cache = ImportEnvelopeCache::default();
    let file = || ConnectionImportFile::Upload {
        token: transfer.token.clone(),
    };

    let password_required =
        preview_tabularis_import_file(&runtime, &cache, Some(session), file(), None)
            .await
            .unwrap();
    assert!(matches!(
        password_required,
        TabularisImportPreviewResult::PasswordRequired
    ));

    let error = preview_tabularis_import_file(
        &runtime,
        &cache,
        Some(session),
        file(),
        Some("wrong-password".to_string()),
    )
    .await
    .unwrap_err();
    assert!(error.contains("wrong password"));

    let preview = preview_tabularis_import_file(
        &runtime,
        &cache,
        Some(session),
        file(),
        Some("correct-password".to_string()),
    )
    .await
    .unwrap();
    let TabularisImportPreviewResult::Preview { preview } = preview else {
        panic!("the correct password must return a preview");
    };
    assert_eq!(preview.items.len(), 1);
}

#[tokio::test]
async fn imported_secrets_replace_stale_runtime_cache_entries() {
    let (_temp, runtime, secrets) = fixture();
    secrets.set("connection-1:db", "old-secret").unwrap();
    let credential_cache = crate::credential_cache::CredentialCache::default();
    crate::credential_cache::set_db_password_cached(
        &credential_cache,
        "connection-1",
        "old-secret",
    );
    let mut payload = export_payload(&runtime, false, None).await.unwrap();
    payload.connections[0].params.password = Some("new-secret".to_string());
    payload.connections[0].params.save_in_keychain = Some(true);

    apply_export_payload(
        &runtime,
        &crate::connection_cache::ConnectionCache::default(),
        &credential_cache,
        payload,
    )
    .await
    .unwrap();

    assert_eq!(
        secrets.get("connection-1:db").unwrap().as_deref(),
        Some("new-secret")
    );
    assert!(matches!(
        credential_cache
            .db_passwords
            .lock()
            .unwrap()
            .get("connection-1"),
        Some(crate::credential_cache::CacheEntry::Present(value)) if value == "new-secret"
    ));
    let saved =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    assert!(saved.connections[0].params.password.is_none());
}

#[test]
fn browser_imports_never_accept_server_paths() {
    let (_temp, runtime, _secrets) = fixture();
    let error = resolve_import_file(
        &runtime,
        Some(Uuid::new_v4()),
        Some(ConnectionImportFile::ServerPath {
            path: "/etc/passwd".to_string(),
        }),
    )
    .err()
    .expect("server paths must be rejected");
    assert!(error.contains("cannot reference server filesystem paths"));
}
