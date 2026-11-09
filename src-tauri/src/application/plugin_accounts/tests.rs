use super::*;
use crate::plugins::driver::{test_driver, with_test_driver_id};
use crate::plugins::extension_policy::secret_key;
use crate::runtime::{
    events::NoopRuntimeEvents, paths::FixedRuntimePaths, secrets::RuntimeSecrets,
};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Default)]
struct MemorySecrets {
    values: Mutex<HashMap<String, String>>,
    fail_bundle: bool,
    fail_sql: bool,
}
impl RuntimeSecrets for MemorySecrets {
    fn get(&self, key: &str) -> Result<Option<String>, String> {
        Ok(self.values.lock().unwrap().get(key).cloned())
    }
    fn set(&self, key: &str, value: &str) -> Result<(), String> {
        if (self.fail_sql && key.ends_with(":db"))
            || (self.fail_bundle && key.starts_with("plugin:"))
        {
            return Err("Bundle storage failed".into());
        }
        self.values.lock().unwrap().insert(key.into(), value.into());
        Ok(())
    }
    fn delete(&self, key: &str) -> Result<(), String> {
        self.values.lock().unwrap().remove(key);
        Ok(())
    }
}
fn fixture(fail_bundle: bool) -> (tempfile::TempDir, RuntimeContext, Arc<ApplicationState>) {
    let temp = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().into(),
            temp.path().into(),
        )),
        Arc::new(NoopRuntimeEvents),
        Arc::new(MemorySecrets {
            fail_bundle,
            ..Default::default()
        }),
    );
    (temp, runtime, Arc::new(ApplicationState::default()))
}
fn request(plugin: &str, operation: &str, fields: Value) -> AccountRequest {
    let mut value = fields;
    value["pluginId"] = json!(plugin);
    value["operation"] = json!(operation);
    serde_json::from_value(value).unwrap()
}

#[tokio::test]
async fn provider_preparation_needs_admin_but_no_account_and_never_receives_stored_secrets() {
    let (_temp, runtime, state) = fixture(false);
    let plugin = "account-prepare-test";
    crate::drivers::registry::register_driver(with_test_driver_id(
        test_driver(move |rpc| {
            assert_eq!(
                rpc.params["context"],
                json!({"plugin_id":plugin,"scope":"account-setup"})
            );
            assert_eq!(rpc.params["secrets"], json!({}));
            assert!(rpc.params.get("params").is_none());
            json!({"installed":true})
        }),
        plugin,
    ))
    .await;
    let payload = || {
        request(
            plugin,
            "prepare",
            json!({"method":"account_cli_status","args":{}}),
        )
    };
    for level in [
        AuthorizationLevel::Session,
        AuthorizationLevel::Database,
        AuthorizationLevel::Sensitive,
    ] {
        assert!(execute(&runtime, &state, level, payload())
            .await
            .unwrap_err()
            .contains("administrator"));
    }
    assert_eq!(
        execute(&runtime, &state, AuthorizationLevel::LocalAdmin, payload())
            .await
            .unwrap(),
        json!({"installed":true})
    );
    runtime
        .secrets
        .set(
            &account_key(plugin),
            &json!({"TOKEN":"must-stay-in-host"}).to_string(),
        )
        .unwrap();
    assert_eq!(
        execute(&runtime, &state, AuthorizationLevel::LocalAdmin, payload())
            .await
            .unwrap(),
        json!({"installed":true})
    );
    assert!(validate_operation(&request(
        plugin,
        "prepare",
        json!({"method":"account_import","args":{}})
    ))
    .unwrap_err()
    .contains("reserved"));
    assert!(validate_operation(&request(
        plugin,
        "prepare",
        json!({"method":"account_cli_status","args":{},"secrets":{"TOKEN":"injected"}})
    ))
    .is_err());
    crate::drivers::registry::unregister_driver(plugin).await;
}

#[tokio::test]
async fn provider_account_requires_admin_before_credentials_or_plugins() {
    let (_temp, runtime, state) = fixture(false);
    for level in [
        AuthorizationLevel::Session,
        AuthorizationLevel::Database,
        AuthorizationLevel::Sensitive,
    ] {
        let error = execute(
            &runtime,
            &state,
            level,
            request("missing", "connect", json!({"secrets":{"TOKEN":"private"}})),
        )
        .await
        .unwrap_err();
        assert!(error.contains("administrator"));
    }
    assert!(runtime
        .secrets
        .get(&account_key("missing"))
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn provider_account_secrets_are_isolated_and_import_is_private() {
    let (_temp, runtime, state) = fixture(false);
    let plugin = "account-import-test";
    crate::drivers::registry::register_driver(with_test_driver_id(test_driver(move |rpc| {
        assert_eq!(rpc.method, "extension");
        assert_eq!(rpc.params["context"], json!({"plugin_id":plugin,"scope":"account"}));
        assert_eq!(rpc.params["secrets"], json!({"API_KEY":"account-private"}));
        assert!(rpc.params.get("params").is_none());
        if rpc.params["method"] == "account_import" {
            json!({"name":"Imported project", "params":{"driver":plugin,"database":"neondb","host":"db.example","username":"owner","password":"sql-private","save_in_keychain":false},"secrets":{"STORAGE_TOKEN":"service-private"},"warnings":["AI credential not created"]})
        } else { json!({"projects":[{"id":"project-one"}]}) }
    }), plugin)).await;
    let admin = AuthorizationLevel::LocalAdmin;
    execute(
        &runtime,
        &state,
        admin,
        request(
            plugin,
            "connect",
            json!({"secrets":{"API_KEY":"account-private"}}),
        ),
    )
    .await
    .unwrap();
    assert_eq!(
        execute(
            &runtime,
            &state,
            admin,
            request(plugin, "fields", json!({}))
        )
        .await
        .unwrap(),
        json!(["API_KEY"])
    );
    assert!(runtime
        .secrets
        .get(&secret_key(plugin, "first"))
        .unwrap()
        .is_none());
    assert!(runtime
        .secrets
        .get(&account_key("other-plugin"))
        .unwrap()
        .is_none());
    let error = execute(
        &runtime,
        &state,
        admin,
        request(plugin, "call", json!({"method":"account_import","args":{}})),
    )
    .await
    .unwrap_err();
    assert!(error.contains("reserved"));
    let imported = execute(
        &runtime,
        &state,
        admin,
        request(plugin, "import", json!({"args":{}})),
    )
    .await
    .unwrap();
    let response = imported.to_string();
    for secret in ["account-private", "sql-private", "service-private"] {
        assert!(!response.contains(secret));
    }
    assert!(imported.get("params").is_none());
    let id = imported["id"].as_str().unwrap();
    let saved =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    assert_eq!(saved.connections.len(), 1);
    assert!(saved.connections[0].params.password.is_none());
    assert_eq!(saved.connections[0].params.save_in_keychain, Some(true));
    assert_eq!(
        runtime.secrets.get(&format!("{id}:db")).unwrap().as_deref(),
        Some("sql-private")
    );
    assert!(runtime
        .secrets
        .get(&secret_key(plugin, id))
        .unwrap()
        .unwrap()
        .contains("service-private"));
    execute(
        &runtime,
        &state,
        admin,
        request(plugin, "disconnect", json!({})),
    )
    .await
    .unwrap();
    assert_eq!(
        execute(
            &runtime,
            &state,
            admin,
            request(plugin, "fields", json!({}))
        )
        .await
        .unwrap(),
        json!([])
    );
    assert!(runtime
        .secrets
        .get(&secret_key(plugin, id))
        .unwrap()
        .is_some());
    crate::drivers::registry::unregister_driver(plugin).await;
}

#[tokio::test]
async fn provider_import_rolls_back_local_connection_on_service_storage_failure() {
    let (_temp, runtime, state) = fixture(true);
    let plugin = "account-rollback-test";
    crate::drivers::registry::register_driver(with_test_driver_id(test_driver(move |_| json!({"name":"Partial", "params":{"driver":plugin,"database":"db","password":"private"}, "secrets":{"TOKEN":"private"}})),plugin)).await;
    let admin = AuthorizationLevel::LocalAdmin;
    execute(
        &runtime,
        &state,
        admin,
        request(plugin, "connect", json!({"secrets":{"KEY":"private"}})),
    )
    .await
    .unwrap();
    assert!(execute(
        &runtime,
        &state,
        admin,
        request(plugin, "import", json!({"args":{}}))
    )
    .await
    .unwrap_err()
    .contains("storage"));
    let saved =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    assert!(saved.connections.is_empty());
    crate::drivers::registry::unregister_driver(plugin).await;
}

#[test]
fn provider_account_rejects_injected_params_and_wrong_operation_fields() {
    assert!(serde_json::from_value::<AccountRequest>(
        json!({"pluginId":"test","operation":"import","args":{},"params":{"password":"injected"}})
    )
    .is_err());
    for (operation, fields) in [
        (
            "call",
            json!({"method":"account_projects","args":{},"secrets":{"TOKEN":"injected"}}),
        ),
        ("fields", json!({"args":{}})),
        ("import", json!({"method":"account_projects","args":{}})),
    ] {
        assert!(validate_operation(&request("test", operation, fields)).is_err());
    }
}

#[tokio::test]
async fn provider_import_never_falls_back_to_plaintext_when_sql_secret_storage_fails() {
    let (_temp, mut runtime, state) = fixture(false);
    let secrets = Arc::new(MemorySecrets {
        fail_sql: true,
        ..Default::default()
    });
    runtime.secrets = secrets.clone();
    let plugin = "account-sql-storage-test";
    crate::drivers::registry::register_driver(with_test_driver_id(test_driver(move |_| json!({
        "name":"Secure import", "params":{"driver":plugin,"database":"db","password":"never-plaintext"}, "secrets":{"TOKEN":"service-private"}
    })),plugin)).await;
    let admin = AuthorizationLevel::LocalAdmin;
    execute(
        &runtime,
        &state,
        admin,
        request(
            plugin,
            "connect",
            json!({"secrets":{"KEY":"account-private"}}),
        ),
    )
    .await
    .unwrap();
    let error = execute(
        &runtime,
        &state,
        admin,
        request(plugin, "import", json!({"args":{}})),
    )
    .await
    .unwrap_err();
    assert!(error.contains("rolled back"));
    let file =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    assert!(file.connections.is_empty());
    assert_eq!(
        secrets.values.lock().unwrap().len(),
        1,
        "Only the existing account key may remain"
    );
    crate::drivers::registry::unregister_driver(plugin).await;
}
