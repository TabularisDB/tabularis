use super::*;
use crate::application::connections::profile_db_secret_account;
use crate::runtime::events::NoopRuntimeEvents;
use crate::runtime::paths::FixedRuntimePaths;
use crate::runtime::secrets::RuntimeSecrets;
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

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
    let params = crate::models::ConnectionParams {
        driver: "sqlite".to_string(),
        database: crate::models::DatabaseSelection::Single("fixture.db".to_string()),
        save_in_keychain: Some(true),
        ..Default::default()
    };
    let file = crate::models::ConnectionsFile {
        connections: vec![SavedConnection {
            id: "connection-1".to_string(),
            name: "Fixture".to_string(),
            params,
            plugin_secret_keys: Vec::new(),
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

fn postgres_profile_connection(id: &str, profile_id: &str) -> crate::models::SavedConnection {
    crate::models::SavedConnection {
        id: id.to_string(),
        name: id.to_string(),
        params: crate::models::ConnectionParams {
            driver: "postgres".to_string(),
            host: Some("db.example.com".to_string()),
            port: Some(5432),
            username: Some("stale-inline".to_string()),
            password: Some("stale-inline-password".to_string()),
            database: crate::models::DatabaseSelection::Single("app".to_string()),
            save_in_keychain: Some(true),
            credential_profile_id: Some(profile_id.to_string()),
            ..crate::models::ConnectionParams::default()
        },
        plugin_secret_keys: Vec::new(),
        group_id: None,
        sort_order: None,
        detect_json_in_text_columns: None,
        appearance: None,
        tag_ids: None,
        environment: None,
    }
}

#[tokio::test]
async fn export_reads_profile_secrets_from_dedicated_keychain_namespace() {
    let (_temp, runtime, secrets) = fixture();
    let shared_id = "shared-id";
    secrets
        .set(&format!("{shared_id}:db"), "connection-password")
        .unwrap();
    secrets
        .set(&profile_db_secret_account(shared_id), "profile-password")
        .unwrap();
    let file = crate::models::ConnectionsFile {
        credential_profiles: vec![crate::models::CredentialProfile {
            id: shared_id.to_string(),
            name: "Shared".to_string(),
            username: "profile-user".to_string(),
        }],
        connections: vec![postgres_profile_connection("conn-1", shared_id)],
        ..Default::default()
    };
    crate::persistence::save_connections_file(&runtime.paths.connections_file(), &file).unwrap();

    let payload = export_payload(&runtime, true, None).await.unwrap();

    assert_eq!(
        payload.credential_profile_secrets.get(shared_id),
        Some(&"profile-password".to_string())
    );
}

#[tokio::test]
async fn secrets_free_export_keeps_profile_references_without_passwords() {
    let (_temp, runtime, secrets) = fixture();
    secrets
        .set(
            &profile_db_secret_account("shared-profile"),
            "shared-password",
        )
        .unwrap();
    let file = crate::models::ConnectionsFile {
        credential_profiles: vec![crate::models::CredentialProfile {
            id: "shared-profile".to_string(),
            name: "Shared".to_string(),
            username: "shared-user".to_string(),
        }],
        connections: vec![
            postgres_profile_connection("connection-1", "shared-profile"),
            postgres_profile_connection("connection-2", "shared-profile"),
        ],
        ..Default::default()
    };
    crate::persistence::save_connections_file(&runtime.paths.connections_file(), &file).unwrap();

    let payload = export_payload(&runtime, false, None).await.unwrap();

    assert!(payload.credential_profile_secrets.is_empty());
    assert_eq!(payload.credential_profiles.len(), 1);
    assert!(payload
        .connections
        .iter()
        .all(|c| c.params.password.is_none()));
    assert!(payload
        .connections
        .iter()
        .all(|c| c.params.credential_profile_id.as_deref() == Some("shared-profile")));
}

#[tokio::test]
async fn shared_profile_secrets_survive_export_import_as_new_with_one_keychain_entry() {
    let (_temp, runtime, secrets) = fixture();
    secrets
        .set(
            &profile_db_secret_account("shared-profile"),
            "shared-password",
        )
        .unwrap();
    let file = crate::models::ConnectionsFile {
        credential_profiles: vec![crate::models::CredentialProfile {
            id: "shared-profile".to_string(),
            name: "Shared".to_string(),
            username: "shared-user".to_string(),
        }],
        connections: vec![
            postgres_profile_connection("connection-1", "shared-profile"),
            postgres_profile_connection("connection-2", "shared-profile"),
        ],
        ..Default::default()
    };
    crate::persistence::save_connections_file(&runtime.paths.connections_file(), &file).unwrap();

    let exported = export_payload(&runtime, true, None).await.unwrap();
    assert_eq!(
        exported.credential_profile_secrets.get("shared-profile"),
        Some(&"shared-password".to_string())
    );
    assert!(exported
        .connections
        .iter()
        .all(|c| c.params.password.is_none()));

    let resolutions = vec![
        crate::connection_import::convert::ImportResolution {
            index: 0,
            action: "import".to_string(),
            replace_existing_id: None,
            group_id: None,
            new_group_name: None,
            new_group_parent_id: None,
        },
        crate::connection_import::convert::ImportResolution {
            index: 1,
            action: "import".to_string(),
            replace_existing_id: None,
            group_id: None,
            new_group_name: None,
            new_group_parent_id: None,
        },
    ];
    let remapped = crate::connection_import::tabularis::apply(&exported, &resolutions, &[]);
    assert_eq!(remapped.credential_profiles.len(), 1);
    let new_profile_id = remapped.credential_profiles[0].id.clone();
    assert_eq!(remapped.credential_profile_secrets.len(), 1);
    assert_eq!(
        remapped.credential_profile_secrets.get(&new_profile_id),
        Some(&"shared-password".to_string())
    );
    assert_eq!(
        remapped.connections[0]
            .params
            .credential_profile_id
            .as_deref(),
        Some(new_profile_id.as_str())
    );
    assert_eq!(
        remapped.connections[1]
            .params
            .credential_profile_id
            .as_deref(),
        Some(new_profile_id.as_str())
    );

    crate::persistence::save_connections_file(
        &runtime.paths.connections_file(),
        &crate::models::ConnectionsFile::default(),
    )
    .unwrap();

    apply_export_payload(
        &runtime,
        &crate::connection_cache::ConnectionCache::default(),
        &crate::credential_cache::CredentialCache::default(),
        remapped,
    )
    .await
    .unwrap();

    let saved =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    assert_eq!(saved.connections.len(), 2);
    assert_eq!(saved.credential_profiles.len(), 1);
    assert_eq!(
        secrets
            .get(&profile_db_secret_account(&new_profile_id))
            .unwrap()
            .as_deref(),
        Some("shared-password")
    );
    assert!(secrets.get("connection-1:db").unwrap().is_none());
    assert!(secrets.get("connection-2:db").unwrap().is_none());

    for connection in &saved.connections {
        let (_, params) = crate::application::connections::resolve_saved_connection_params(
            &runtime,
            None,
            &connection.id,
        )
        .unwrap();
        assert_eq!(params.username.as_deref(), Some("shared-user"));
        assert_eq!(params.password.as_deref(), Some("shared-password"));
    }
}

fn profile_import_payload(
    connection_id: &str,
    profile_id: &str,
    profile_password: &str,
) -> ExportPayload {
    ExportPayload {
        version: 1,
        groups: vec![],
        connections: vec![postgres_profile_connection(connection_id, profile_id)],
        ssh_connections: vec![],
        k8s_connections: vec![],
        tags: vec![],
        credential_profiles: vec![crate::models::CredentialProfile {
            id: profile_id.to_string(),
            name: "Shared".to_string(),
            username: "shared-user".to_string(),
        }],
        credential_profile_secrets: HashMap::from([(
            profile_id.to_string(),
            profile_password.to_string(),
        )]),
        plugin_secrets: HashMap::new(),
    }
}

/// Forces the next metadata write to fail on every OS by replacing
/// `connections.json` with a same-named directory: writing a file over a
/// directory fails on Unix (`EISDIR`) and Windows alike. A read-only
/// permission bit is not portable here because `write_private_file` resets the
/// mode to `0o600` on Unix before writing.
fn block_connections_file(path: &std::path::Path) {
    if path.is_file() {
        fs::remove_file(path).unwrap();
    }
    fs::create_dir(path).unwrap();
}

struct FailingOnSetSecrets {
    inner: Arc<Mutex<HashMap<String, String>>>,
    fail_account: String,
    on_fail: Option<Arc<dyn Fn() + Send + Sync>>,
}

impl RuntimeSecrets for FailingOnSetSecrets {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.inner.lock().unwrap().get(account).cloned())
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        if account == self.fail_account {
            if let Some(on_fail) = &self.on_fail {
                on_fail();
            }
            return Err("injected profile keychain failure".to_string());
        }
        self.inner
            .lock()
            .unwrap()
            .insert(account.to_string(), secret.to_string());
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        self.inner.lock().unwrap().remove(account);
        Ok(())
    }
}

struct AttemptCountingSecrets {
    inner: Arc<Mutex<HashMap<String, String>>>,
    set_attempts: Mutex<HashMap<String, u32>>,
    fail_set_on_attempt: HashMap<String, u32>,
}

impl RuntimeSecrets for AttemptCountingSecrets {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.inner.lock().unwrap().get(account).cloned())
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        let attempt = {
            let mut counts = self.set_attempts.lock().unwrap();
            let count = counts.entry(account.to_string()).or_insert(0);
            *count += 1;
            *count
        };
        if self
            .fail_set_on_attempt
            .get(account)
            .is_some_and(|fail_on| *fail_on == attempt)
        {
            return Err(format!(
                "injected keychain failure on attempt {attempt} for {account}"
            ));
        }
        self.inner
            .lock()
            .unwrap()
            .insert(account.to_string(), secret.to_string());
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        self.inner.lock().unwrap().remove(account);
        Ok(())
    }
}

#[tokio::test]
async fn failed_metadata_save_preserves_existing_profile_password() {
    let (_temp, runtime, secrets) = fixture();
    secrets
        .set(
            &profile_db_secret_account("shared-profile"),
            "original-password",
        )
        .unwrap();
    let path = runtime.paths.connections_file();
    let payload = profile_import_payload("connection-1", "shared-profile", "rotated-password");
    block_connections_file(&path);

    let error = apply_export_payload(
        &runtime,
        &crate::connection_cache::ConnectionCache::default(),
        &crate::credential_cache::CredentialCache::default(),
        payload,
    )
    .await
    .unwrap_err();

    fs::remove_dir(&path).unwrap();
    assert!(!error.is_empty());
    assert_eq!(
        secrets
            .get(&profile_db_secret_account("shared-profile"))
            .unwrap()
            .as_deref(),
        Some("original-password")
    );
}

#[tokio::test]
async fn failed_metadata_save_does_not_delete_stale_connection_db_secret() {
    let (_temp, runtime, secrets) = fixture();
    secrets
        .set(
            &profile_db_secret_account("shared-profile"),
            "profile-password",
        )
        .unwrap();
    secrets
        .set("connection-1:db", "stale-connection-password")
        .unwrap();
    let path = runtime.paths.connections_file();
    let payload = profile_import_payload("connection-1", "shared-profile", "rotated-password");
    block_connections_file(&path);

    let _ = apply_export_payload(
        &runtime,
        &crate::connection_cache::ConnectionCache::default(),
        &crate::credential_cache::CredentialCache::default(),
        payload,
    )
    .await;

    fs::remove_dir(&path).unwrap();
    assert_eq!(
        secrets.get("connection-1:db").unwrap().as_deref(),
        Some("stale-connection-password")
    );
}

#[tokio::test]
async fn failed_profile_keychain_write_preserves_previous_password() {
    let temp = tempfile::tempdir().unwrap();
    let config = temp.path().join("config");
    let data = temp.path().join("data");
    fs::create_dir_all(&config).unwrap();
    fs::create_dir_all(&data).unwrap();
    let store = Arc::new(Mutex::new(HashMap::from([(
        profile_db_secret_account("shared-profile"),
        "original-password".to_string(),
    )])));
    let secrets = Arc::new(FailingOnSetSecrets {
        inner: store.clone(),
        fail_account: profile_db_secret_account("shared-profile"),
        on_fail: None,
    });
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(config, data)),
        Arc::new(NoopRuntimeEvents),
        secrets.clone(),
    );
    crate::persistence::save_connections_file(
        &runtime.paths.connections_file(),
        &crate::models::ConnectionsFile::default(),
    )
    .unwrap();
    let payload = profile_import_payload("connection-1", "shared-profile", "rotated-password");

    let error = apply_export_payload(
        &runtime,
        &crate::connection_cache::ConnectionCache::default(),
        &crate::credential_cache::CredentialCache::default(),
        payload,
    )
    .await
    .unwrap_err();

    assert!(error.contains("injected profile keychain failure"));
    assert_eq!(
        store
            .lock()
            .unwrap()
            .get(&profile_db_secret_account("shared-profile"))
            .map(String::as_str),
        Some("original-password")
    );
    let saved =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    assert!(
        saved.credential_profiles.is_empty(),
        "profile metadata must be rolled back when keychain writes fail"
    );
    assert!(saved.connections.is_empty());
}

#[tokio::test]
async fn failed_profile_keychain_write_keeps_resolved_username_and_password_aligned() {
    let (_temp, runtime, secrets) = fixture();
    secrets
        .set(
            &profile_db_secret_account("shared-profile"),
            "original-password",
        )
        .unwrap();
    let file = crate::models::ConnectionsFile {
        credential_profiles: vec![crate::models::CredentialProfile {
            id: "shared-profile".to_string(),
            name: "Original".to_string(),
            username: "original-user".to_string(),
        }],
        connections: vec![postgres_profile_connection(
            "connection-1",
            "shared-profile",
        )],
        ..Default::default()
    };
    crate::persistence::save_connections_file(&runtime.paths.connections_file(), &file).unwrap();

    let store = Arc::new(Mutex::new(HashMap::from([(
        profile_db_secret_account("shared-profile"),
        "original-password".to_string(),
    )])));
    let failing = Arc::new(FailingOnSetSecrets {
        inner: store.clone(),
        fail_account: profile_db_secret_account("shared-profile"),
        on_fail: None,
    });
    let runtime = RuntimeContext::new(runtime.paths.clone(), runtime.events.clone(), failing);
    let mut payload = profile_import_payload("connection-1", "shared-profile", "rotated-password");
    payload.credential_profiles[0].name = "Imported".to_string();
    payload.credential_profiles[0].username = "imported-user".to_string();

    let error = apply_export_payload(
        &runtime,
        &crate::connection_cache::ConnectionCache::default(),
        &crate::credential_cache::CredentialCache::default(),
        payload,
    )
    .await
    .unwrap_err();
    assert!(error.contains("injected profile keychain failure"));

    let (_, params) = crate::application::connections::resolve_saved_connection_params(
        &runtime,
        None,
        "connection-1",
    )
    .unwrap();
    assert_eq!(params.username.as_deref(), Some("original-user"));
    assert_eq!(params.password.as_deref(), Some("original-password"));
}

#[tokio::test]
async fn partial_multi_profile_import_rolls_back_prior_profile_secrets_and_metadata() {
    let temp = tempfile::tempdir().unwrap();
    let config = temp.path().join("config");
    let data = temp.path().join("data");
    fs::create_dir_all(&config).unwrap();
    fs::create_dir_all(&data).unwrap();
    let store = Arc::new(Mutex::new(HashMap::from([
        (
            profile_db_secret_account("profile-a"),
            "password-a".to_string(),
        ),
        (
            profile_db_secret_account("profile-b"),
            "password-b".to_string(),
        ),
    ])));
    let secrets = Arc::new(FailingOnSetSecrets {
        inner: store.clone(),
        fail_account: profile_db_secret_account("profile-b"),
        on_fail: None,
    });
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(config, data)),
        Arc::new(NoopRuntimeEvents),
        secrets.clone(),
    );
    let file = crate::models::ConnectionsFile {
        credential_profiles: vec![
            crate::models::CredentialProfile {
                id: "profile-a".to_string(),
                name: "A".to_string(),
                username: "user-a".to_string(),
            },
            crate::models::CredentialProfile {
                id: "profile-b".to_string(),
                name: "B".to_string(),
                username: "user-b".to_string(),
            },
        ],
        connections: vec![
            postgres_profile_connection("connection-a", "profile-a"),
            postgres_profile_connection("connection-b", "profile-b"),
        ],
        ..Default::default()
    };
    crate::persistence::save_connections_file(&runtime.paths.connections_file(), &file).unwrap();

    let payload = ExportPayload {
        version: 1,
        groups: vec![],
        connections: vec![
            postgres_profile_connection("connection-a", "profile-a"),
            postgres_profile_connection("connection-b", "profile-b"),
        ],
        ssh_connections: vec![],
        k8s_connections: vec![],
        tags: vec![],
        credential_profiles: vec![
            crate::models::CredentialProfile {
                id: "profile-a".to_string(),
                name: "A-imported".to_string(),
                username: "user-a-imported".to_string(),
            },
            crate::models::CredentialProfile {
                id: "profile-b".to_string(),
                name: "B-imported".to_string(),
                username: "user-b-imported".to_string(),
            },
        ],
        credential_profile_secrets: HashMap::from([
            ("profile-a".to_string(), "password-a-imported".to_string()),
            ("profile-b".to_string(), "password-b-imported".to_string()),
        ]),
        plugin_secrets: HashMap::new(),
    };

    let error = apply_export_payload(
        &runtime,
        &crate::connection_cache::ConnectionCache::default(),
        &crate::credential_cache::CredentialCache::default(),
        payload,
    )
    .await
    .unwrap_err();
    assert!(error.contains("injected profile keychain failure"));

    assert_eq!(
        store
            .lock()
            .unwrap()
            .get(&profile_db_secret_account("profile-a"))
            .map(String::as_str),
        Some("password-a")
    );
    assert_eq!(
        store
            .lock()
            .unwrap()
            .get(&profile_db_secret_account("profile-b"))
            .map(String::as_str),
        Some("password-b")
    );
    let saved =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    let profile_a = saved
        .credential_profiles
        .iter()
        .find(|profile| profile.id == "profile-a")
        .expect("profile-a");
    assert_eq!(profile_a.username, "user-a");
    assert_eq!(profile_a.name, "A");
}

#[tokio::test]
async fn concurrent_connection_edit_survives_failed_profile_import_recovery() {
    let (_temp, runtime, secrets) = fixture();
    secrets
        .set(
            &profile_db_secret_account("shared-profile"),
            "original-password",
        )
        .unwrap();
    let mut file = crate::models::ConnectionsFile {
        credential_profiles: vec![crate::models::CredentialProfile {
            id: "shared-profile".to_string(),
            name: "Shared".to_string(),
            username: "shared-user".to_string(),
        }],
        connections: vec![
            postgres_profile_connection("connection-1", "shared-profile"),
            postgres_profile_connection("connection-2", "shared-profile"),
        ],
        ..Default::default()
    };
    file.connections[1].name = "Other".to_string();
    crate::persistence::save_connections_file(&runtime.paths.connections_file(), &file).unwrap();

    let path = runtime.paths.connections_file();
    let store = Arc::new(Mutex::new(HashMap::from([(
        profile_db_secret_account("shared-profile"),
        "original-password".to_string(),
    )])));
    let failing = Arc::new(FailingOnSetSecrets {
        inner: store,
        fail_account: profile_db_secret_account("shared-profile"),
        on_fail: None,
    });
    let runtime = RuntimeContext::new(runtime.paths.clone(), runtime.events.clone(), failing);
    let payload = profile_import_payload("connection-1", "shared-profile", "rotated-password");

    let (concurrent_done, wait_for_concurrent) = mpsc::channel();
    let concurrent = thread::spawn(move || {
        let mut file = crate::persistence::load_connections_file(&path).unwrap();
        let connection = file
            .connections
            .iter_mut()
            .find(|connection| connection.id == "connection-2")
            .expect("connection-2");
        connection.name = "Concurrent-Edit".to_string();
        crate::persistence::save_connections_file(&path, &file).unwrap();
        concurrent_done.send(()).unwrap();
    });

    let error = apply_export_payload(
        &runtime,
        &crate::connection_cache::ConnectionCache::default(),
        &crate::credential_cache::CredentialCache::default(),
        payload,
    )
    .await
    .unwrap_err();
    wait_for_concurrent
        .recv_timeout(Duration::from_secs(5))
        .expect("concurrent writer must finish after import releases the file lock");
    concurrent.join().unwrap();
    assert!(error.contains("injected profile keychain failure"));

    let saved =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    let connection_2 = saved
        .connections
        .iter()
        .find(|connection| connection.id == "connection-2")
        .expect("connection-2");
    assert_eq!(connection_2.name, "Concurrent-Edit");
}

#[tokio::test]
async fn failed_profile_import_restores_metadata_when_keychain_rollback_set_fails() {
    let temp = tempfile::tempdir().unwrap();
    let config = temp.path().join("config");
    let data = temp.path().join("data");
    fs::create_dir_all(&config).unwrap();
    fs::create_dir_all(&data).unwrap();
    let store = Arc::new(Mutex::new(HashMap::from([
        (
            profile_db_secret_account("profile-a"),
            "password-a".to_string(),
        ),
        (
            profile_db_secret_account("profile-b"),
            "password-b".to_string(),
        ),
    ])));
    let secrets = Arc::new(AttemptCountingSecrets {
        inner: store.clone(),
        set_attempts: Mutex::new(HashMap::new()),
        fail_set_on_attempt: HashMap::from([
            (profile_db_secret_account("profile-b"), 1),
            (profile_db_secret_account("profile-a"), 2),
        ]),
    });
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(config, data)),
        Arc::new(NoopRuntimeEvents),
        secrets,
    );
    let file = crate::models::ConnectionsFile {
        credential_profiles: vec![
            crate::models::CredentialProfile {
                id: "profile-a".to_string(),
                name: "A".to_string(),
                username: "user-a".to_string(),
            },
            crate::models::CredentialProfile {
                id: "profile-b".to_string(),
                name: "B".to_string(),
                username: "user-b".to_string(),
            },
        ],
        connections: vec![
            postgres_profile_connection("connection-a", "profile-a"),
            postgres_profile_connection("connection-b", "profile-b"),
        ],
        ..Default::default()
    };
    crate::persistence::save_connections_file(&runtime.paths.connections_file(), &file).unwrap();

    let payload = ExportPayload {
        version: 1,
        groups: vec![],
        connections: file.connections.clone(),
        ssh_connections: vec![],
        k8s_connections: vec![],
        tags: vec![],
        credential_profiles: vec![
            crate::models::CredentialProfile {
                id: "profile-a".to_string(),
                name: "A-imported".to_string(),
                username: "user-a-imported".to_string(),
            },
            crate::models::CredentialProfile {
                id: "profile-b".to_string(),
                name: "B-imported".to_string(),
                username: "user-b-imported".to_string(),
            },
        ],
        credential_profile_secrets: HashMap::from([
            ("profile-a".to_string(), "password-a-imported".to_string()),
            ("profile-b".to_string(), "password-b-imported".to_string()),
        ]),
        plugin_secrets: HashMap::new(),
    };

    let error = apply_export_payload(
        &runtime,
        &crate::connection_cache::ConnectionCache::default(),
        &crate::credential_cache::CredentialCache::default(),
        payload,
    )
    .await
    .unwrap_err();
    assert!(error.contains("injected keychain failure"));

    let saved =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    let profile_a = saved
        .credential_profiles
        .iter()
        .find(|profile| profile.id == "profile-a")
        .expect("profile-a");
    assert_eq!(profile_a.username, "user-a");
    assert_eq!(profile_a.name, "A");
    // Rollback of profile-a's keychain write failed; the imported password may remain.
    assert_eq!(
        store
            .lock()
            .unwrap()
            .get(&profile_db_secret_account("profile-a"))
            .map(String::as_str),
        Some("password-a-imported")
    );
}

#[tokio::test]
async fn partial_export_includes_only_referenced_credential_profiles() {
    let (_temp, runtime, _secrets) = fixture();
    let mut file =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    file.credential_profiles = vec![
        crate::models::CredentialProfile {
            id: "keep-profile".to_string(),
            name: "Keep".to_string(),
            username: "keep_user".to_string(),
        },
        crate::models::CredentialProfile {
            id: "other-profile".to_string(),
            name: "Other".to_string(),
            username: "other_user".to_string(),
        },
        crate::models::CredentialProfile {
            id: "unused-profile".to_string(),
            name: "Unused".to_string(),
            username: "unused_user".to_string(),
        },
    ];
    file.connections[0].params.credential_profile_id = Some("keep-profile".to_string());
    let mut other = file.connections[0].clone();
    other.id = "connection-2".to_string();
    other.name = "Other".to_string();
    other.params.credential_profile_id = Some("other-profile".to_string());
    file.connections.push(other);
    crate::persistence::save_connections_file(&runtime.paths.connections_file(), &file).unwrap();

    let payload = export_payload(&runtime, false, Some(vec!["connection-1".to_string()]))
        .await
        .unwrap();

    assert_eq!(payload.connections.len(), 1);
    assert_eq!(payload.credential_profiles.len(), 1);
    assert_eq!(payload.credential_profiles[0].id, "keep-profile");
}

#[tokio::test]
async fn apply_export_payload_persists_credential_profiles_and_merges_by_id() {
    let (_temp, runtime, _secrets) = fixture();
    let mut file =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    file.credential_profiles = vec![crate::models::CredentialProfile {
        id: "cred-existing".to_string(),
        name: "Old".to_string(),
        username: "old_user".to_string(),
    }];
    crate::persistence::save_connections_file(&runtime.paths.connections_file(), &file).unwrap();

    let mut payload = export_payload(&runtime, false, None).await.unwrap();
    payload.credential_profiles = vec![
        crate::models::CredentialProfile {
            id: "cred-existing".to_string(),
            name: "Updated".to_string(),
            username: "new_user".to_string(),
        },
        crate::models::CredentialProfile {
            id: "cred-new".to_string(),
            name: "New".to_string(),
            username: "new_user".to_string(),
        },
    ];
    payload.connections[0].params.credential_profile_id = Some("cred-new".to_string());

    apply_export_payload(
        &runtime,
        &crate::connection_cache::ConnectionCache::default(),
        &crate::credential_cache::CredentialCache::default(),
        payload,
    )
    .await
    .unwrap();

    let saved =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    assert_eq!(saved.credential_profiles.len(), 2);
    let existing = saved
        .credential_profiles
        .iter()
        .find(|profile| profile.id == "cred-existing")
        .expect("existing profile is kept");
    assert_eq!(existing.name, "Updated");
    assert_eq!(existing.username, "new_user");
    assert!(saved
        .credential_profiles
        .iter()
        .any(|profile| profile.id == "cred-new"));
    assert_eq!(
        saved.connections[0].params.credential_profile_id.as_deref(),
        Some("cred-new")
    );
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

#[tokio::test]
async fn import_rejects_connection_profile_link_with_colliding_imported_ids() {
    use crate::models::{ConnectionParams, CredentialProfile, DatabaseSelection, SavedConnection};

    let (_temp, runtime, _secrets) = fixture();
    let mut payload = export_payload(&runtime, false, None).await.unwrap();
    payload.connections = vec![SavedConnection {
        id: "abc:profile".to_string(),
        name: "Colliding".to_string(),
        params: ConnectionParams {
            driver: "postgres".to_string(),
            save_in_keychain: Some(true),
            credential_profile_id: Some("abc".to_string()),
            password: Some("imported-inline-password".to_string()),
            database: DatabaseSelection::Single("db".to_string()),
            ..ConnectionParams::default()
        },
        plugin_secret_keys: Vec::new(),
        group_id: None,
        sort_order: None,
        detect_json_in_text_columns: None,
        appearance: None,
        tag_ids: None,
        environment: None,
    }];
    payload.credential_profiles = vec![CredentialProfile {
        id: "abc".to_string(),
        name: "Profile".to_string(),
        username: "profile-user".to_string(),
    }];
    payload
        .credential_profile_secrets
        .insert("abc".to_string(), "profile-secret".to_string());

    let error = apply_export_payload(
        &runtime,
        &crate::connection_cache::ConnectionCache::default(),
        &crate::credential_cache::CredentialCache::default(),
        payload,
    )
    .await
    .unwrap_err();
    assert!(error.contains("keychain"));
}

#[cfg(unix)]
#[tokio::test]
async fn imported_ssh_secrets_create_and_repair_private_file_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let (_temp, runtime, _secrets) = fixture();
    let mut payload = export_payload(&runtime, false, None).await.unwrap();
    payload.ssh_connections = vec![serde_json::from_value(serde_json::json!({
        "id": "ssh-import", "name": "Imported", "host": "localhost", "port": 22,
        "user": "user", "auth_type": "password", "password": "imported-secret",
        "save_in_keychain": false
    }))
    .unwrap()];
    let path = ssh_path(&runtime);
    for existing in [false, true] {
        if existing {
            fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        }
        apply_export_payload(
            &runtime,
            &crate::connection_cache::ConnectionCache::default(),
            &crate::credential_cache::CredentialCache::default(),
            payload.clone(),
        )
        .await
        .unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(fs::read_to_string(&path)
            .unwrap()
            .contains("imported-secret"));
    }
}
