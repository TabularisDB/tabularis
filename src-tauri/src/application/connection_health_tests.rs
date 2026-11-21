use super::*;
use crate::application::connection_lifecycle::FAILURE_THRESHOLD;
use crate::application::connections::{execute, register_active_connection, ConnectionCommand};
use crate::models::DatabaseSelection;
use crate::runtime::events::RuntimeEvents;
use crate::runtime::paths::FixedRuntimePaths;
use crate::runtime::secrets::RuntimeSecrets;
use serde_json::Value;
use std::sync::Mutex;

#[derive(Default)]
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

#[derive(Default)]
struct RecordingEvents {
    values: Mutex<Vec<(Option<Uuid>, String, Value)>>,
}

impl RecordingEvents {
    fn record(&self, session_id: Option<Uuid>, event: &str, payload: Value) {
        self.values
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push((session_id, event.to_string(), payload));
    }

    /// Events named `event`, with the session each one was sent to.
    fn sent(&self, event: &str) -> Vec<(Option<Uuid>, Value)> {
        self.values
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .iter()
            .filter(|(_, name, _)| name == event)
            .map(|(session_id, _, payload)| (*session_id, payload.clone()))
            .collect()
    }

    fn clear(&self) {
        self.values
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clear();
    }
}

impl RuntimeEvents for RecordingEvents {
    fn emit(&self, event: &str, payload: Value) -> Result<(), String> {
        self.record(None, event, payload);
        Ok(())
    }

    fn emit_to(&self, session_id: Uuid, event: &str, payload: Value) -> Result<(), String> {
        self.record(Some(session_id), event, payload);
        Ok(())
    }
}

struct Fixture {
    _temp: tempfile::TempDir,
    runtime: RuntimeContext,
    state: Arc<ApplicationState>,
    events: Arc<RecordingEvents>,
    connection_id: String,
}

impl Fixture {
    /// A saved SQLite connection with an open pool.
    async fn new() -> Self {
        crate::drivers::registry::register_driver(crate::drivers::sqlite::SqliteDriver::new())
            .await;
        let temp = tempfile::tempdir().unwrap();
        let database = temp.path().join("health.db");
        std::fs::write(&database, b"").unwrap();
        let events = Arc::new(RecordingEvents::default());
        let runtime = RuntimeContext::new(
            Arc::new(FixedRuntimePaths::new(
                temp.path().to_path_buf(),
                temp.path().to_path_buf(),
            )),
            events.clone(),
            Arc::new(NoSecrets),
        );
        let state = Arc::new(ApplicationState::default());
        let saved = execute(
            &runtime,
            &state,
            ConnectionCommand::SaveConnection {
                name: "Health".to_string(),
                params: ConnectionParams {
                    driver: "sqlite".to_string(),
                    database: DatabaseSelection::Single(database.to_string_lossy().into_owned()),
                    ..ConnectionParams::default()
                },
                plugin_secret_changes: None,
                detect_json_in_text_columns: None,
                environment: None,
            },
        )
        .await
        .unwrap();
        let connection_id = saved["id"].as_str().unwrap().to_string();
        let fixture = Self {
            _temp: temp,
            runtime,
            state,
            events,
            connection_id,
        };
        fixture.open_pool().await;
        fixture
    }

    async fn open_pool(&self) {
        let (_, params) = crate::application::connections::resolve_saved_connection_params(
            &self.runtime,
            None,
            &self.connection_id,
        )
        .unwrap();
        crate::pool_manager::get_sqlite_pool_with_id(&params, Some(&self.connection_id))
            .await
            .unwrap();
    }

    async fn has_pool(&self) -> bool {
        let (_, params) = crate::application::connections::resolve_saved_connection_params(
            &self.runtime,
            None,
            &self.connection_id,
        )
        .unwrap();
        crate::pool_manager::has_pool(&params, Some(&self.connection_id)).await
    }

    async fn close_pool(&self) {
        crate::pool_manager::close_pools_for_connection_id("sqlite", &self.connection_id).await;
    }

    async fn open_in(&self, session_id: Uuid) {
        register_active_connection(
            &self.runtime,
            Some(&self.state),
            Some(session_id),
            self.connection_id.clone(),
        )
        .await;
    }

    fn held_by(&self, session_id: Uuid) -> bool {
        self.state
            .web_active_connections
            .lock()
            .unwrap()
            .get(&session_id)
            .is_some_and(|connections| connections.contains(&self.connection_id))
    }

    async fn registered(&self) -> bool {
        crate::health_check::active_connections()
            .await
            .contains(&self.connection_id)
    }

    async fn ticks(&self, tracker: &mut HealthTracker, count: u32) {
        for _ in 0..count {
            check_connections(
                &self.runtime,
                &self.state,
                tracker,
                vec![self.connection_id.clone()],
            )
            .await;
        }
    }

    async fn finish(self) {
        crate::health_check::unregister_connection(&self.connection_id).await;
        self.close_pool().await;
    }
}

fn tracker() -> HealthTracker {
    HealthTracker::new(Duration::from_secs(30))
}

#[tokio::test]
async fn a_healthy_web_connection_stays_open_and_sends_nothing() {
    let _registry = crate::drivers::registry::REGISTRY_TEST_LOCK.lock().await;
    let fixture = Fixture::new().await;
    let session = Uuid::new_v4();
    fixture.open_in(session).await;
    fixture.events.clear();

    let mut tracker = tracker();
    fixture.ticks(&mut tracker, FAILURE_THRESHOLD + 1).await;

    assert!(fixture.held_by(session));
    assert!(fixture.registered().await);
    assert!(fixture
        .events
        .sent(CONNECTION_HEALTH_FAILED_EVENT)
        .is_empty());
    assert!(fixture.events.sent(CONNECTION_LIFECYCLE_EVENT).is_empty());
    fixture.finish().await;
}

#[tokio::test]
async fn a_failed_web_connection_is_dropped_and_only_its_sessions_are_told() {
    let _registry = crate::drivers::registry::REGISTRY_TEST_LOCK.lock().await;
    let fixture = Fixture::new().await;
    let (holder_a, holder_b, bystander) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
    fixture.open_in(holder_a).await;
    fixture.open_in(holder_b).await;
    fixture
        .state
        .web_active_connections
        .lock()
        .unwrap()
        .entry(bystander)
        .or_default()
        .insert("another-connection".to_string());
    fixture.close_pool().await;
    fixture.events.clear();

    let mut tracker = tracker();
    fixture.ticks(&mut tracker, FAILURE_THRESHOLD - 1).await;
    assert!(
        fixture.held_by(holder_a),
        "one failed ping only makes it suspect"
    );
    assert!(fixture
        .events
        .sent(CONNECTION_HEALTH_FAILED_EVENT)
        .is_empty());

    fixture.ticks(&mut tracker, 1).await;
    assert!(!fixture.held_by(holder_a));
    assert!(!fixture.held_by(holder_b));
    assert!(!fixture.registered().await);
    let mut told: Vec<Option<Uuid>> = fixture
        .events
        .sent(CONNECTION_HEALTH_FAILED_EVENT)
        .into_iter()
        .map(|(session, payload)| {
            assert_eq!(payload["connectionId"], fixture.connection_id.as_str());
            assert_eq!(payload["error"], "No active connection pool");
            session
        })
        .collect();
    told.sort();
    let mut holders = vec![Some(holder_a), Some(holder_b)];
    holders.sort();
    assert_eq!(told, holders);
    let refreshed: Vec<Option<Uuid>> = fixture
        .events
        .sent("connections:active-changed")
        .into_iter()
        .map(|(session, payload)| {
            assert_eq!(payload, serde_json::json!([]));
            session
        })
        .collect();
    assert_eq!(refreshed.len(), 2);
    assert!(!refreshed.contains(&Some(bystander)));
    assert!(fixture
        .state
        .web_active_connections
        .lock()
        .unwrap()
        .contains_key(&bystander));
    fixture.finish().await;
}

#[tokio::test]
async fn auto_reconnect_reopens_a_failed_web_connection() {
    let _registry = crate::drivers::registry::REGISTRY_TEST_LOCK.lock().await;
    let fixture = Fixture::new().await;
    crate::application::persistence::save_config(
        &fixture.runtime,
        crate::config::AppConfig {
            auto_reconnect: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    let session = Uuid::new_v4();
    fixture.open_in(session).await;
    fixture.close_pool().await;
    fixture.events.clear();

    let mut tracker = tracker();
    fixture.ticks(&mut tracker, FAILURE_THRESHOLD).await;

    assert!(fixture.held_by(session));
    assert!(fixture.registered().await);
    assert!(fixture.has_pool().await);
    assert!(fixture
        .events
        .sent(CONNECTION_HEALTH_FAILED_EVENT)
        .is_empty());
    let id = fixture.connection_id.as_str();
    assert_eq!(
        fixture.events.sent(CONNECTION_LIFECYCLE_EVENT),
        vec![
            (
                Some(session),
                serde_json::json!({"connectionId": id, "state": "reconnecting"})
            ),
            (
                Some(session),
                serde_json::json!({"connectionId": id, "state": "reconnected", "releasedSessions": 0})
            ),
        ]
    );
    fixture.finish().await;
}

#[test]
fn a_disabled_or_unset_interval_reads_from_the_config() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().to_path_buf(),
            temp.path().to_path_buf(),
        )),
        Arc::new(RecordingEvents::default()),
        Arc::new(NoSecrets),
    );
    assert_eq!(
        ping_interval_secs(&runtime),
        u64::from(DEFAULT_PING_INTERVAL)
    );
    crate::application::persistence::save_config(
        &runtime,
        crate::config::AppConfig {
            ping_interval: Some(0),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(ping_interval_secs(&runtime), 0);
}
