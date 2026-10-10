use super::*;
use crate::models::DatabaseSelection;
use crate::runtime::events::NoopRuntimeEvents;
use crate::runtime::paths::FixedRuntimePaths;
use crate::runtime::secrets::RuntimeSecrets;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct MemorySecrets {
    values: Mutex<HashMap<String, String>>,
}

impl RuntimeSecrets for MemorySecrets {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.values.lock().unwrap().get(account).cloned())
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        self.values
            .lock()
            .unwrap()
            .insert(account.to_string(), secret.to_string());
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        self.values.lock().unwrap().remove(account);
        Ok(())
    }
}

fn fixture() -> (tempfile::TempDir, RuntimeContext) {
    let temp = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().to_path_buf(),
            temp.path().to_path_buf(),
        )),
        Arc::new(NoopRuntimeEvents),
        Arc::new(MemorySecrets::default()),
    );
    (temp, runtime)
}

fn ssh_input() -> SshConnectionInput {
    SshConnectionInput {
        host: "bastion.example.com".to_string(),
        port: 22,
        user: "browser-user".to_string(),
        auth_type: "password".to_string(),
        password: Some("stored-password".to_string()),
        key_file: None,
        key_passphrase: Some("stored-passphrase".to_string()),
        allow_passphrase_prompt: Some(true),
        save_in_keychain: Some(true),
    }
}

#[test]
fn ssh_profile_secrets_are_write_only_for_web_responses() {
    let (_temp, runtime) = fixture();
    let saved = save_ssh_connection(
        &runtime,
        "Production bastion".to_string(),
        ssh_input(),
        false,
    )
    .unwrap();

    assert!(saved.password.is_none());
    assert!(saved.key_passphrase.is_none());
    let persisted: Vec<SshConnection> = load_json(&ssh_path(&runtime)).unwrap();
    assert!(persisted[0].password.is_none());
    assert!(persisted[0].key_passphrase.is_none());
    assert_eq!(
        runtime
            .secrets
            .get(&secret_account(&saved.id, SSH_SECRET_SUFFIX))
            .unwrap()
            .as_deref(),
        Some("stored-password")
    );

    let desktop = get_ssh_connections(&runtime, true).unwrap();
    assert_eq!(desktop[0].password.as_deref(), Some("stored-password"));
    let web = get_ssh_connections(&runtime, false).unwrap();
    assert!(web[0].password.is_none());
}

#[test]
fn saved_tunnel_profiles_expand_without_exposing_secrets() {
    let (_temp, runtime) = fixture();
    let ssh = save_ssh_connection(
        &runtime,
        "Production bastion".to_string(),
        ssh_input(),
        false,
    )
    .unwrap();
    let k8s = save_k8s_connection(
        &runtime,
        K8sConnectionInput {
            name: "Production cluster".to_string(),
            context: "prod".to_string(),
            namespace: "database".to_string(),
            resource_type: "service".to_string(),
            resource_name: "postgres".to_string(),
            port: 5432,
            kubectl_path: None,
            kubeconfig_path: None,
        },
    )
    .unwrap();

    let ssh_params = expand_connection_params(
        &runtime,
        &ConnectionParams {
            driver: "postgres".to_string(),
            database: DatabaseSelection::Single("app".to_string()),
            ssh_enabled: Some(true),
            ssh_connection_id: Some(ssh.id),
            ..ConnectionParams::default()
        },
    )
    .unwrap();
    assert_eq!(ssh_params.ssh_host.as_deref(), Some("bastion.example.com"));
    assert_eq!(ssh_params.ssh_password.as_deref(), Some("stored-password"));

    let k8s_params = expand_connection_params(
        &runtime,
        &ConnectionParams {
            driver: "postgres".to_string(),
            database: DatabaseSelection::Single("app".to_string()),
            k8s_enabled: Some(true),
            k8s_connection_id: Some(k8s.id),
            ..ConnectionParams::default()
        },
    )
    .unwrap();
    assert_eq!(k8s_params.k8s_context.as_deref(), Some("prod"));
    assert_eq!(k8s_params.k8s_resource_name.as_deref(), Some("postgres"));
}

#[test]
fn ssh_tests_restore_inline_plaintext_secrets_from_saved_database_connections() {
    let (_temp, runtime) = fixture();
    let file = crate::models::ConnectionsFile {
        connections: vec![crate::models::SavedConnection {
            id: "database-1".to_string(),
            name: "Database".to_string(),
            params: ConnectionParams {
                driver: "postgres".to_string(),
                database: DatabaseSelection::Single("app".to_string()),
                ssh_password: Some("inline-password".to_string()),
                ssh_key_passphrase: Some("inline-passphrase".to_string()),
                save_in_keychain: Some(false),
                ..ConnectionParams::default()
            },
            group_id: None,
            sort_order: None,
            detect_json_in_text_columns: None,
            appearance: None,
            tag_ids: None,
            environment: None,
        }],
        ..crate::models::ConnectionsFile::default()
    };
    crate::persistence::save_connections_file(&runtime.paths.connections_file(), &file).unwrap();
    let mut test = SshTestParams {
        host: "bastion.example.com".to_string(),
        port: 22,
        user: "browser-user".to_string(),
        password: None,
        key_file: None,
        key_passphrase: None,
        allow_passphrase_prompt: None,
        connection_id: None,
        db_connection_id: Some("database-1".to_string()),
        progress_id: None,
    };

    restore_ssh_test_secrets(&runtime, &mut test).unwrap();

    assert_eq!(test.password.as_deref(), Some("inline-password"));
    assert_eq!(test.key_passphrase.as_deref(), Some("inline-passphrase"));
}

#[test]
fn profile_validation_rejects_invalid_inputs() {
    let (_temp, runtime) = fixture();
    let mut ssh = ssh_input();
    ssh.auth_type = "agent".to_string();
    assert!(
        save_ssh_connection(&runtime, "Invalid".to_string(), ssh, false)
            .unwrap_err()
            .contains("password or ssh_key")
    );

    let error = save_k8s_connection(
        &runtime,
        K8sConnectionInput {
            name: "Invalid".to_string(),
            context: "prod".to_string(),
            namespace: "database".to_string(),
            resource_type: "deployment".to_string(),
            resource_name: "postgres".to_string(),
            port: 5432,
            kubectl_path: None,
            kubeconfig_path: None,
        },
    )
    .unwrap_err();
    assert_eq!(error, "Invalid Kubernetes connection profile");
}
