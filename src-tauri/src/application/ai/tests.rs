use super::*;
use crate::runtime::events::NoopRuntimeEvents;
use crate::runtime::paths::FixedRuntimePaths;
use crate::runtime::secrets::RuntimeSecrets;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct MemorySecrets {
    values: Mutex<HashMap<String, String>>,
}

impl RuntimeSecrets for MemorySecrets {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self
            .values
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(account)
            .cloned())
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        self.values
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(account.to_string(), secret.to_string());
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        self.values
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(account);
        Ok(())
    }
}

fn fixture() -> (tempfile::TempDir, RuntimeContext, ApplicationState) {
    let temp = tempfile::tempdir().unwrap();
    let config_dir = temp.path().join("config");
    let data_dir = temp.path().join("data");
    std::fs::create_dir_all(&config_dir).unwrap();
    std::fs::create_dir_all(&data_dir).unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(config_dir, data_dir)),
        Arc::new(NoopRuntimeEvents),
        Arc::new(MemorySecrets::default()),
    );
    (temp, runtime, ApplicationState::default())
}

#[tokio::test]
async fn provider_keys_are_write_only_across_the_application_contract() {
    let (_temp, runtime, state) = fixture();

    let set_result = execute(
        &runtime,
        &state,
        None,
        AiCommand::SetKey {
            provider: "fixture-provider".to_string(),
            key: "provider-secret".to_string(),
        },
    )
    .await
    .unwrap();
    assert_eq!(set_result, Value::Null);

    let status = execute(
        &runtime,
        &state,
        None,
        AiCommand::CheckKeyStatus {
            provider: "fixture-provider".to_string(),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        status,
        serde_json::json!({"configured": true, "fromEnv": false})
    );
    assert!(!status.to_string().contains("provider-secret"));

    let delete_result = execute(
        &runtime,
        &state,
        None,
        AiCommand::DeleteKey {
            provider: "fixture-provider".to_string(),
        },
    )
    .await
    .unwrap();
    assert_eq!(delete_result, Value::Null);
}

#[tokio::test]
async fn pending_approvals_are_owned_by_an_authorized_web_session() {
    let (_temp, runtime, state) = fixture();
    let authorized_session = Uuid::new_v4();
    let other_session = Uuid::new_v4();
    state.web_active_connections.lock().unwrap().insert(
        authorized_session,
        HashSet::from(["connection-1".to_string()]),
    );
    state
        .web_active_connections
        .lock()
        .unwrap()
        .insert(other_session, HashSet::new());

    let pending = PendingApproval {
        id: "approval-1".to_string(),
        created_at: "2026-08-22T00:00:00Z".to_string(),
        session_id: "mcp-session".to_string(),
        connection_id: "connection-1".to_string(),
        connection_name: "Fixture".to_string(),
        query: "DELETE FROM values".to_string(),
        query_kind: "write".to_string(),
        client_hint: None,
        explain_plan: None,
        explain_error: None,
    };
    crate::ai_approval::write_pending_in(runtime.paths.config_dir(), &pending).unwrap();

    let authorized = execute(
        &runtime,
        &state,
        Some(authorized_session),
        AiCommand::ListPendingApprovals,
    )
    .await
    .unwrap();
    assert_eq!(authorized.as_array().map(Vec::len), Some(1));

    let unauthorized = execute(
        &runtime,
        &state,
        Some(other_session),
        AiCommand::ListPendingApprovals,
    )
    .await
    .unwrap();
    assert_eq!(unauthorized, serde_json::json!([]));

    let denied = execute(
        &runtime,
        &state,
        Some(other_session),
        AiCommand::DecidePendingApproval {
            approval_id: pending.id.clone(),
            decision: "deny".to_string(),
            reason: None,
            edited_query: None,
        },
    )
    .await;
    assert!(denied.is_err());

    {
        let mut sessions = state.web_active_connections.lock().unwrap();
        sessions.get_mut(&authorized_session).unwrap().clear();
        sessions
            .get_mut(&other_session)
            .unwrap()
            .insert("connection-1".to_string());
    }
    let transferred = execute(
        &runtime,
        &state,
        Some(other_session),
        AiCommand::ListPendingApprovals,
    )
    .await
    .unwrap();
    assert_eq!(transferred.as_array().map(Vec::len), Some(1));

    execute(
        &runtime,
        &state,
        Some(other_session),
        AiCommand::DecidePendingApproval {
            approval_id: pending.id.clone(),
            decision: "approve".to_string(),
            reason: Some("approved by owner".to_string()),
            edited_query: None,
        },
    )
    .await
    .unwrap();
    let decision = crate::ai_approval::read_decision_in(runtime.paths.config_dir(), &pending.id)
        .unwrap()
        .unwrap();
    assert_eq!(decision.decision, "approve");
}
