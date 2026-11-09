use super::*;
use crate::runtime::{
    events::NoopRuntimeEvents, paths::FixedRuntimePaths, secrets::RuntimeSecrets,
};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Default)]
struct MemorySecrets(Mutex<HashMap<String, String>>);
impl RuntimeSecrets for MemorySecrets {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap().get(account).cloned())
    }
    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        self.0.lock().unwrap().insert(account.into(), value.into());
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}
fn runtime(path: &std::path::Path) -> RuntimeContext {
    RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(path.into(), path.into())),
        Arc::new(NoopRuntimeEvents),
        Arc::new(MemorySecrets::default()),
    )
}
fn scope(plugin: &str, connection: &str) -> ExtensionScope {
    ExtensionScope {
        plugin_id: plugin.into(),
        connection_id: connection.into(),
    }
}
fn call(plugin: &str, connection: &str, method: &str) -> ExtensionCommand {
    ExtensionCommand::Call(ExtensionRequest {
        plugin_id: plugin.into(),
        connection_id: connection.into(),
        method: method.into(),
        args: json!({}),
    })
}

#[tokio::test]
async fn plugin_extension_rejects_unprivileged_context_before_accessing_secrets() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = runtime(temp.path());
    for authorization in [
        AuthorizationLevel::Session,
        AuthorizationLevel::Database,
        AuthorizationLevel::Sensitive,
    ] {
        for command in [
            call("test", "missing", "test_status"),
            ExtensionCommand::SetSecrets(SecretRequest {
                plugin_id: "test".into(),
                connection_id: "missing".into(),
                secrets: json!({"TOKEN":"private"}),
            }),
            ExtensionCommand::DeleteSecrets(scope("test", "missing")),
        ] {
            assert!(execute(&runtime, None, authorization, command)
                .await
                .unwrap_err()
                .contains("authorization"));
        }
    }
}

#[tokio::test]
async fn plugin_extension_scopes_credentials_and_rejects_disabled_or_foreign_driver() {
    use crate::plugins::driver::{test_driver, with_test_driver_id};
    let temp = tempfile::tempdir().unwrap();
    let runtime = runtime(temp.path());
    let plugin = "extension-scope-test";
    let saved: Vec<crate::models::SavedConnection> = serde_json::from_value(json!([
        {"id":"first","name":"First","params":{"driver":plugin,"host":"saved.example","database":"db","username":"user","port":5432}},
        {"id":"second","name":"Second","params":{"driver":plugin,"database":"db"}},
        {"id":"foreign","name":"Foreign","params":{"driver":"other-plugin","database":"db"}}
    ])).unwrap();
    crate::persistence::save_connections(&runtime.paths.connections_file(), &saved).unwrap();
    let driver = with_test_driver_id(
        test_driver(|request| {
            assert_eq!(request.method, "extension");
            assert_eq!(request.params["params"]["host"], "saved.example");
            assert_eq!(request.params["params"]["connection_id"], "first");
            assert_eq!(request.params["secrets"], json!({"TOKEN":"private"}));
            assert_eq!(request.params["context"]["connection_id"], "first");
            assert_eq!(request.params["method"], "service_status");
            json!({"ready":true})
        }),
        plugin,
    );
    crate::drivers::registry::register_driver(driver).await;
    let authorization = AuthorizationLevel::LocalAdmin;
    execute(
        &runtime,
        None,
        authorization,
        ExtensionCommand::SetSecrets(SecretRequest {
            plugin_id: plugin.into(),
            connection_id: "first".into(),
            secrets: json!({"TOKEN":"private"}),
        }),
    )
    .await
    .unwrap();
    assert_eq!(
        execute(
            &runtime,
            None,
            AuthorizationLevel::Database,
            ExtensionCommand::SecretFields(scope(plugin, "first"))
        )
        .await
        .unwrap(),
        json!(["TOKEN"])
    );
    assert_eq!(
        execute(
            &runtime,
            None,
            AuthorizationLevel::Database,
            ExtensionCommand::SecretFields(scope(plugin, "second"))
        )
        .await
        .unwrap(),
        json!([])
    );
    assert!(execute(
        &runtime,
        None,
        authorization,
        call(plugin, "foreign", "service_status")
    )
    .await
    .unwrap_err()
    .contains("own"));
    assert!(execute(
        &runtime,
        None,
        authorization,
        call(plugin, "first", "execute_query")
    )
    .await
    .unwrap_err()
    .contains("namespaced"));
    assert_eq!(
        execute(
            &runtime,
            None,
            authorization,
            call(plugin, "first", "service_status")
        )
        .await
        .unwrap(),
        json!({"ready":true})
    );
    execute(
        &runtime,
        None,
        authorization,
        ExtensionCommand::DeleteSecrets(scope(plugin, "first")),
    )
    .await
    .unwrap();
    assert_eq!(
        execute(
            &runtime,
            None,
            AuthorizationLevel::Database,
            ExtensionCommand::SecretFields(scope(plugin, "first"))
        )
        .await
        .unwrap(),
        json!([])
    );
    crate::drivers::registry::unregister_driver(plugin).await;
    assert!(execute(
        &runtime,
        None,
        authorization,
        call(plugin, "first", "service_status")
    )
    .await
    .unwrap_err()
    .contains("disabled"));
}

#[test]
fn plugin_extension_envelopes_reject_client_credentials_and_secret_read_commands() {
    assert!(serde_json::from_value::<ExtensionRequest>(json!({"pluginId":"test","connectionId":"first","method":"test_status","args":{},"params":{"password":"injected"}})).is_err());
    assert!(serde_json::from_value::<SecretRequest>(
        json!({"pluginId":"test","connectionId":"first","secrets":{},"host":"injected"})
    )
    .is_err());
}

#[tokio::test(flavor = "current_thread")]
async fn plugin_secret_lookup_does_not_block_runtime_timers() {
    struct SlowSecrets;
    impl RuntimeSecrets for SlowSecrets {
        fn get(&self, _: &str) -> Result<Option<String>, String> {
            std::thread::sleep(std::time::Duration::from_millis(100));
            Ok(None)
        }
        fn set(&self, _: &str, _: &str) -> Result<(), String> {
            Ok(())
        }
        fn delete(&self, _: &str) -> Result<(), String> {
            Ok(())
        }
    }
    let temp = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().into(),
            temp.path().into(),
        )),
        Arc::new(NoopRuntimeEvents),
        Arc::new(SlowSecrets),
    );
    let plugin = "extension-blocking-test";
    let saved: Vec<crate::models::SavedConnection> = serde_json::from_value(
        json!([{"id":"slow","name":"Slow","params":{"driver":plugin,"database":"db"}}]),
    )
    .unwrap();
    crate::persistence::save_connections(&runtime.paths.connections_file(), &saved).unwrap();
    crate::drivers::registry::register_driver(crate::plugins::driver::with_test_driver_id(
        crate::plugins::driver::test_driver(|_| json!(null)),
        plugin,
    ))
    .await;
    tokio::select! {
        _ = execute(&runtime, None, AuthorizationLevel::LocalAdmin, ExtensionCommand::SecretFields(scope(plugin, "slow"))) => panic!("secret lookup blocked the runtime timer"),
        _ = tokio::time::sleep(std::time::Duration::from_millis(10)) => (),
    }
    crate::drivers::registry::unregister_driver(plugin).await;
}
