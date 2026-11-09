use super::*;
use crate::drivers::driver_trait::DatabaseDriver;
use crate::models::ConnectionParams;
use serde_json::json;

fn target() -> DebugTarget {
    DebugTarget {
        database: "FREEPDB1".into(),
        schema: "APP".into(),
        name: "TEST_ROUTINE".into(),
        routine_type: "PROCEDURE".into(),
        identity_args: "1".into(),
    }
}

#[test]
fn legacy_capabilities_omit_debugging_and_default_to_unsupported() {
    let capabilities = crate::drivers::driver_trait::DriverCapabilities::default();
    assert!(capabilities.routine_debug.is_none());
    let encoded = serde_json::to_value(capabilities).unwrap();
    assert!(encoded.get("routine_debug").is_none());
    let decoded: crate::drivers::driver_trait::DriverCapabilities =
        serde_json::from_value(encoded).unwrap();
    assert!(decoded.routine_debug.is_none());
}

fn preview() -> DebugCommand {
    DebugCommand::Preview {
        target: target(),
        arguments: vec![DebugArgument {
            position: 1,
            value: json!("hello"),
        }],
    }
}

fn preview_response() -> Value {
    json!({
        "kind": "preview", "version": 1, "preview_id": "preview-1", "target": target(),
        "arguments": [{"position": 1, "value": "hello"}],
        "source": {"state": "unavailable", "reason": "No debug information"},
        "warnings": ["Routine execution may commit or have external effects"]
    })
}

#[test]
fn contract_rejects_unknown_actions_and_raw_sql_parameters() {
    assert!(serde_json::from_value::<DebugCommand>(
        json!({"action": "execute", "sql": "delete from x"})
    )
    .is_err());
    assert!(serde_json::from_value::<DebugArgument>(
        json!({"position": 1, "value": "x", "raw": true})
    )
    .is_err());
    let mut command = preview();
    if let DebugCommand::Preview { arguments, .. } = &mut command {
        arguments.push(DebugArgument {
            position: 1,
            value: Value::Null,
        });
    }
    assert!(command.validate(1, false).is_err());
}

#[test]
fn readonly_keeps_cleanup_but_rejects_execution_and_evaluation() {
    assert!(preview().validate(1, true).is_err());
    for command in [
        DebugCommand::Stop {
            session_id: "s".into(),
        },
        DebugCommand::Status {
            session_id: "s".into(),
        },
    ] {
        assert!(command.validate(1, true).is_ok());
    }
    assert!(DebugCommand::ReadVariables {
        session_id: "s".into(),
        frame_id: "f".into(),
        names: vec![]
    }
    .validate(1, true)
    .is_err());
}

#[test]
fn preview_response_must_preserve_overload_arguments_and_protocol() {
    for (field, value) in [
        ("version", json!(2)),
        ("preview_id", json!("")),
        ("arguments", json!([])),
        (
            "target",
            json!({"database":"OTHER", "schema":"APP", "name":"TEST_ROUTINE", "routine_type":"PROCEDURE", "identity_args":"1"}),
        ),
    ] {
        let mut response = preview_response();
        response[field] = value;
        assert!(serde_json::from_value::<DebugResponse>(response)
            .unwrap()
            .validate_for(&preview())
            .is_err());
    }
    serde_json::from_value::<DebugResponse>(preview_response())
        .unwrap()
        .validate_for(&preview())
        .unwrap();
}

#[tokio::test]
async fn legacy_drivers_never_receive_debugger_rpc() {
    let driver = crate::plugins::driver::test_driver(|_| {
        panic!("unsupported driver must not receive an RPC")
    });
    assert!(driver
        .routine_debug(&ConnectionParams::default(), 1, &preview())
        .await
        .unwrap_err()
        .contains("not supported"));
}

#[tokio::test]
async fn plugin_receives_versioned_native_command_without_sql_fallback() {
    let driver = crate::plugins::driver::test_driver(|request| {
        assert_eq!(request.method, "routine_debug");
        assert_eq!(request.params["version"], 1);
        assert_eq!(request.params["command"]["target"]["identity_args"], "1");
        assert_eq!(request.params["command"]["arguments"][0]["value"], "hello");
        preview_response()
    });
    let mut manifest = driver.manifest().clone();
    manifest.capabilities.routine_debug = Some(1);
    let driver = crate::plugins::driver::test_driver_with_manifest(manifest, |request| {
        assert_eq!(request.method, "routine_debug");
        assert_eq!(request.params["version"], 1);
        assert_eq!(request.params["command"]["target"]["identity_args"], "1");
        Ok(preview_response())
    });
    driver
        .routine_debug(&ConnectionParams::default(), 1, &preview())
        .await
        .unwrap();
    assert!(driver
        .routine_debug(&ConnectionParams::default(), 2, &preview())
        .await
        .is_err());
}

#[tokio::test]
async fn failed_start_is_sent_once_and_never_retried_as_sql() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    let legacy = crate::plugins::driver::test_driver(|_| Value::Null);
    let mut manifest = legacy.manifest().clone();
    manifest.capabilities.routine_debug = Some(1);
    let calls = Arc::new(AtomicUsize::new(0));
    let count = calls.clone();
    let driver = crate::plugins::driver::test_driver_with_manifest(manifest, move |request| {
        assert_eq!(request.method, "routine_debug");
        count.fetch_add(1, Ordering::SeqCst);
        Err("connection lost after execution may have started".into())
    });
    assert!(driver
        .routine_debug(
            &ConnectionParams::default(),
            1,
            &DebugCommand::Start {
                preview_id: "p".into(),
                session_id: "s".into()
            }
        )
        .await
        .is_err());
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}
