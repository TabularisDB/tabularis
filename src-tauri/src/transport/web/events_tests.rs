use super::events::{EventBusConfig, WebEventBus};
use crate::application::AuthorizationLevel;
use crate::runtime::events::RuntimeEvents;
use serde_json::json;
use std::time::Duration;
use uuid::Uuid;

fn test_config() -> EventBusConfig {
    EventBusConfig {
        connection_queue_capacity: 1,
        session_history_capacity: 2,
        max_sessions: 4,
        max_connections_per_session: 2,
        disconnected_session_ttl: Duration::from_secs(60),
        heartbeat_interval: Duration::from_millis(20),
        heartbeat_timeout: Duration::from_millis(60),
    }
}

#[tokio::test]
async fn scopes_events_to_authorized_sessions() {
    let bus = WebEventBus::new(test_config());
    let database_session = Uuid::new_v4();
    let admin_session = Uuid::new_v4();
    let mut database = bus
        .connect(database_session, AuthorizationLevel::Database)
        .unwrap();
    let mut admin = bus
        .connect(admin_session, AuthorizationLevel::LocalAdmin)
        .unwrap();

    database
        .subscribe(&["connection-health-failed".to_string()], None)
        .unwrap();
    admin
        .subscribe(&["connection-health-failed".to_string()], None)
        .unwrap();
    assert!(database
        .subscribe(&["ssh-askpass://request".to_string()], None)
        .is_err());
    assert!(bus
        .emit_to(
            database_session,
            "ssh-askpass://request",
            json!({"id": 1, "prompt": "Password"}),
        )
        .is_err());

    bus.emit_to(
        database_session,
        "connection-health-failed",
        json!({"connectionId": "connection-1", "error": "offline"}),
    )
    .unwrap();

    let event = database.recv().await.unwrap();
    assert_eq!(event.event, "connection-health-failed");
    assert!(admin.try_recv().is_err());
}

#[tokio::test]
async fn disconnects_slow_consumers_and_bounds_reconnect_history() {
    let bus = WebEventBus::new(test_config());
    let session = Uuid::new_v4();
    let mut connection = bus
        .connect(session, AuthorizationLevel::LocalAdmin)
        .unwrap();
    connection
        .subscribe(&["export_progress".to_string()], None)
        .unwrap();

    for rows_processed in 1..=4 {
        RuntimeEvents::emit(
            &bus,
            "export_progress",
            json!({"rowsProcessed": rows_processed}),
        )
        .unwrap();
    }

    assert_eq!(bus.connection_count(session), 0);
    assert_eq!(bus.history_len(session), 2);
    assert!(connection.recv().await.is_none());
}

#[tokio::test]
async fn replays_only_missed_events_for_the_same_session() {
    let bus = WebEventBus::new(test_config());
    let session = Uuid::new_v4();
    let mut first = bus
        .connect(session, AuthorizationLevel::LocalAdmin)
        .unwrap();
    first
        .subscribe(&["query-status".to_string()], None)
        .unwrap();

    RuntimeEvents::emit(&bus, "query-status", json!({"status": "running"})).unwrap();
    let first_sequence = first.recv().await.unwrap().sequence;
    drop(first);

    RuntimeEvents::emit(&bus, "query-status", json!({"status": "cancelled"})).unwrap();

    let mut reconnected = bus
        .connect(session, AuthorizationLevel::LocalAdmin)
        .unwrap();
    let replay = reconnected
        .subscribe(&["query-status".to_string()], Some(first_sequence))
        .unwrap();
    assert_eq!(replay.len(), 1);
    assert_eq!(replay[0].payload, json!({"status": "cancelled"}));

    let other_session = Uuid::new_v4();
    let mut other = bus
        .connect(other_session, AuthorizationLevel::LocalAdmin)
        .unwrap();
    assert!(other
        .subscribe(&["query-status".to_string()], Some(0))
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn removing_a_session_discards_queued_events() {
    let bus = WebEventBus::new(test_config());
    let session = Uuid::new_v4();
    let mut connection = bus
        .connect(session, AuthorizationLevel::LocalAdmin)
        .unwrap();
    connection
        .subscribe(&["query-status".to_string()], None)
        .unwrap();
    RuntimeEvents::emit(&bus, "query-status", json!({"status": "running"})).unwrap();

    bus.remove_session(session);

    assert!(connection.recv().await.is_none());
}

#[test]
fn bounds_connections_per_session() {
    let bus = WebEventBus::new(test_config());
    let session = Uuid::new_v4();
    let _first = bus
        .connect(session, AuthorizationLevel::LocalAdmin)
        .unwrap();
    let _second = bus
        .connect(session, AuthorizationLevel::LocalAdmin)
        .unwrap();
    assert!(bus
        .connect(session, AuthorizationLevel::LocalAdmin)
        .is_err());
}

#[test]
fn declares_authorization_for_required_event_groups() {
    for event in [
        "connection-health-failed",
        "query-status",
        "dump_progress",
        "import_progress",
        "export_progress",
        "plugin-install-progress",
        "ai://pending_approval",
        "ai://activity",
        "ssh-askpass://request",
        "update-progress",
        "server://lifecycle",
    ] {
        assert!(WebEventBus::authorization_for(event).is_some(), "{event}");
    }
    assert!(WebEventBus::authorization_for("unregistered-sensitive-event").is_none());
}
