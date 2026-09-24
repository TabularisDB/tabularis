use super::bootstrap::{bootstrap_application, BootstrapOptions};
use super::events::RuntimeEvents;
use super::lifecycle::ShutdownHooks;
use super::paths::RuntimePaths;
use super::secrets::RuntimeSecrets;
use super::state::ApplicationState;
use super::RuntimeContext;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

struct TestPaths {
    config_dir: PathBuf,
    data_dir: PathBuf,
}

impl RuntimePaths for TestPaths {
    fn config_dir(&self) -> &Path {
        &self.config_dir
    }

    fn data_dir(&self) -> &Path {
        &self.data_dir
    }
}

#[derive(Default)]
struct TestEvents {
    emitted: Mutex<Vec<(String, Value)>>,
}

impl RuntimeEvents for TestEvents {
    fn emit(&self, event: &str, payload: Value) -> Result<(), String> {
        self.emitted
            .lock()
            .map_err(|error| error.to_string())?
            .push((event.to_string(), payload));
        Ok(())
    }
}

#[derive(Default)]
struct TestSecrets;

impl RuntimeSecrets for TestSecrets {
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

#[tokio::test]
async fn bootstraps_application_services_without_a_webview() {
    let temp = tempfile::tempdir().unwrap();
    let config_dir = temp.path().join("config");
    let data_dir = temp.path().join("data");
    std::fs::create_dir_all(&config_dir).unwrap();
    std::fs::write(
        config_dir.join("config.json"),
        r#"{"language":"en","activeExternalDrivers":[]}"#,
    )
    .unwrap();

    let context = RuntimeContext::new(
        Arc::new(TestPaths {
            config_dir,
            data_dir,
        }),
        Arc::new(TestEvents::default()),
        Arc::new(TestSecrets),
    );

    let bootstrapped = bootstrap_application(
        context,
        BootstrapOptions {
            load_external_plugins: false,
            run_connection_migrations: false,
        },
    )
    .await
    .unwrap();

    assert_eq!(bootstrapped.config.language.as_deref(), Some("en"));
    let driver_ids: Vec<String> = crate::drivers::registry::list_drivers()
        .await
        .into_iter()
        .filter(|manifest| manifest.is_builtin)
        .map(|manifest| manifest.id)
        .collect();
    assert_eq!(driver_ids, vec!["mysql", "postgres", "sqlite"]);
    assert!(bootstrapped.context.paths.data_dir().ends_with("data"));
}

#[test]
fn application_state_can_be_created_without_tauri() {
    let _state = ApplicationState::default();
}

#[tokio::test]
async fn aborts_all_background_jobs_during_headless_shutdown() {
    let state = ApplicationState::default();
    let query = tokio::spawn(std::future::pending::<()>());
    let export = tokio::spawn(std::future::pending::<()>());
    let dump = tokio::spawn(std::future::pending::<()>());

    state
        .query_cancellation
        .handles
        .lock()
        .unwrap()
        .insert("query".to_string(), vec![Arc::new(query.abort_handle())]);
    state
        .export_cancellation
        .handles
        .lock()
        .unwrap()
        .insert("export".to_string(), vec![Arc::new(export.abort_handle())]);
    state
        .dump_cancellation
        .handles
        .lock()
        .unwrap()
        .insert("dump".to_string(), vec![Arc::new(dump.abort_handle())]);

    state.abort_background_jobs();

    assert!(query.await.unwrap_err().is_cancelled());
    assert!(export.await.unwrap_err().is_cancelled());
    assert!(dump.await.unwrap_err().is_cancelled());
    assert!(state.query_cancellation.handles.lock().unwrap().is_empty());
    assert!(state.export_cancellation.handles.lock().unwrap().is_empty());
    assert!(state.dump_cancellation.handles.lock().unwrap().is_empty());
}

#[test]
fn shutdown_hooks_run_without_a_tauri_runtime() {
    let calls = Arc::new(AtomicUsize::new(0));
    let hooks = ShutdownHooks::default();
    let hook_calls = calls.clone();
    hooks.register(move || {
        hook_calls.fetch_add(1, Ordering::Relaxed);
    });

    hooks.run();

    assert_eq!(calls.load(Ordering::Relaxed), 1);
}
