use crate::ai::{
    AiCellNameRequest, AiExplainRequest, AiGenerateRequest, AiSuggestTableNameRequest,
    AiTabRenameRequest,
};
use crate::ai_activity::EventFilter;
use crate::ai_approval::{ApprovalDecision, PendingApproval};
use crate::credential_cache::{CacheEntry, CredentialCache};
use crate::runtime::{state::ApplicationState, RuntimeContext};
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

const AI_KEY_PREFIX: &str = "ai_key:";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiKeyStatus {
    pub configured: bool,
    pub from_env: bool,
}

#[derive(Debug)]
pub enum AiCommand {
    SetKey {
        provider: String,
        key: String,
    },
    DeleteKey {
        provider: String,
    },
    CheckKey {
        provider: String,
    },
    CheckKeyStatus {
        provider: String,
    },
    GetModels {
        force_refresh: bool,
    },
    GenerateQuery(AiGenerateRequest),
    ExplainQuery(AiExplainRequest),
    AnalyzeExplainPlan(AiExplainRequest),
    GenerateCellName(AiCellNameRequest),
    GenerateTabRename(AiTabRenameRequest),
    SuggestTableName(AiSuggestTableNameRequest),
    GetSchemaContext {
        connection_id: String,
        schema: Option<String>,
    },
    GetActivity {
        filter: Option<EventFilter>,
    },
    GetSessions,
    GetSessionEvents {
        session_id: String,
    },
    ClearActivity,
    ListPendingApprovals,
    DecidePendingApproval {
        approval_id: String,
        decision: String,
        reason: Option<String>,
        edited_query: Option<String>,
    },
}

pub async fn execute(
    runtime: &RuntimeContext,
    state: &ApplicationState,
    web_session_id: Option<Uuid>,
    command: AiCommand,
) -> Result<Value, String> {
    match command {
        AiCommand::SetKey { provider, key } => {
            set_key(runtime, &state.credential_cache, &provider, &key)?;
            Ok(Value::Null)
        }
        AiCommand::DeleteKey { provider } => {
            delete_key(runtime, &state.credential_cache, &provider)?;
            Ok(Value::Null)
        }
        AiCommand::CheckKey { provider } => {
            json(get_api_key(runtime, &state.credential_cache, &provider).is_ok())
        }
        AiCommand::CheckKeyStatus { provider } => {
            json(key_status(runtime, &state.credential_cache, &provider))
        }
        AiCommand::GetModels { force_refresh } => {
            json(crate::ai::get_models(runtime, &state.credential_cache, force_refresh).await?)
        }
        AiCommand::GenerateQuery(request) => {
            json(crate::ai::generate_query(runtime, &state.credential_cache, request).await?)
        }
        AiCommand::ExplainQuery(request) => {
            json(crate::ai::explain_query(runtime, &state.credential_cache, request).await?)
        }
        AiCommand::AnalyzeExplainPlan(request) => {
            json(crate::ai::analyze_explain_plan(runtime, &state.credential_cache, request).await?)
        }
        AiCommand::GenerateCellName(request) => {
            json(crate::ai::generate_cellname(runtime, &state.credential_cache, request).await?)
        }
        AiCommand::GenerateTabRename(request) => {
            json(crate::ai::generate_tab_name(runtime, &state.credential_cache, request).await?)
        }
        AiCommand::SuggestTableName(request) => json(
            crate::ai::suggest_table_name_with_runtime(runtime, &state.credential_cache, request)
                .await?,
        ),
        AiCommand::GetSchemaContext {
            connection_id,
            schema,
        } => json(
            crate::application::metadata::get_ai_schema_context(
                runtime,
                web_session_id,
                &connection_id,
                schema,
            )
            .await?,
        ),
        AiCommand::GetActivity { filter } => {
            let config_dir = runtime.paths.config_dir().to_path_buf();
            let filter = filter.unwrap_or_default();
            json(
                tokio::task::spawn_blocking(move || {
                    crate::ai_activity::read_events_in(&config_dir, &filter)
                })
                .await
                .map_err(|error| error.to_string())??,
            )
        }
        AiCommand::GetSessions => {
            let config_dir = runtime.paths.config_dir().to_path_buf();
            json(
                tokio::task::spawn_blocking(move || {
                    crate::ai_activity::read_sessions_in(&config_dir)
                })
                .await
                .map_err(|error| error.to_string())??,
            )
        }
        AiCommand::GetSessionEvents { session_id } => {
            let config_dir = runtime.paths.config_dir().to_path_buf();
            json(
                tokio::task::spawn_blocking(move || {
                    crate::ai_activity::read_session_events_in(&config_dir, &session_id)
                })
                .await
                .map_err(|error| error.to_string())??,
            )
        }
        AiCommand::ClearActivity => {
            let config_dir = runtime.paths.config_dir().to_path_buf();
            tokio::task::spawn_blocking(move || crate::ai_activity::clear_in(&config_dir))
                .await
                .map_err(|error| error.to_string())??;
            Ok(Value::Null)
        }
        AiCommand::ListPendingApprovals => {
            json(list_pending_approvals(runtime, state, web_session_id).await?)
        }
        AiCommand::DecidePendingApproval {
            approval_id,
            decision,
            reason,
            edited_query,
        } => {
            decide_pending_approval(
                runtime,
                state,
                web_session_id,
                approval_id,
                decision,
                reason,
                edited_query,
            )
            .await?;
            Ok(Value::Null)
        }
    }
}

pub fn set_key(
    runtime: &RuntimeContext,
    cache: &CredentialCache,
    provider: &str,
    key: &str,
) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err("The AI provider key must not be empty".to_string());
    }
    runtime.secrets.set(&key_account(provider), key)?;
    crate::credential_cache::set_ai_key_cached(cache, provider, key);
    Ok(())
}

pub fn delete_key(
    runtime: &RuntimeContext,
    cache: &CredentialCache,
    provider: &str,
) -> Result<(), String> {
    runtime.secrets.delete(&key_account(provider))?;
    crate::credential_cache::invalidate_ai_key(cache, provider);
    Ok(())
}

pub fn get_api_key(
    runtime: &RuntimeContext,
    cache: &CredentialCache,
    provider: &str,
) -> Result<String, String> {
    match cached_key(cache, provider) {
        Some(Some(key)) => return Ok(key),
        Some(None) => {}
        None => match runtime.secrets.get(&key_account(provider)) {
            Ok(Some(key)) if !key.is_empty() => {
                crate::credential_cache::set_ai_key_cached(cache, provider, &key);
                return Ok(key);
            }
            Ok(_) => {
                cache
                    .ai_keys
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .insert(provider.to_string(), CacheEntry::Absent);
            }
            Err(error) => log::warn!("Failed to read the {provider} AI key: {error}"),
        },
    }

    environment_key(provider).ok_or_else(|| missing_key_error(provider))
}

pub fn key_status(
    runtime: &RuntimeContext,
    cache: &CredentialCache,
    provider: &str,
) -> AiKeyStatus {
    let stored = match cached_key(cache, provider) {
        Some(value) => value.is_some(),
        None => match runtime.secrets.get(&key_account(provider)) {
            Ok(Some(key)) if !key.is_empty() => {
                crate::credential_cache::set_ai_key_cached(cache, provider, &key);
                true
            }
            Ok(_) => {
                cache
                    .ai_keys
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .insert(provider.to_string(), CacheEntry::Absent);
                false
            }
            Err(error) => {
                log::warn!("Failed to check the {provider} AI key: {error}");
                false
            }
        },
    };
    let from_env = !stored && environment_key(provider).is_some();
    AiKeyStatus {
        configured: stored || from_env,
        from_env,
    }
}

pub async fn list_pending_approvals(
    runtime: &RuntimeContext,
    state: &ApplicationState,
    web_session_id: Option<Uuid>,
) -> Result<Vec<PendingApproval>, String> {
    let config_dir = runtime.paths.config_dir().to_path_buf();
    let pending =
        tokio::task::spawn_blocking(move || crate::ai_approval::list_pending_in(&config_dir))
            .await
            .map_err(|error| error.to_string())??;

    let Some(session_id) = web_session_id else {
        return Ok(pending);
    };
    Ok(pending
        .into_iter()
        .filter(|approval| claim_pending_for_session(state, session_id, approval))
        .collect())
}

pub fn authorized_sessions_for_pending(
    state: &ApplicationState,
    pending: &PendingApproval,
) -> Vec<Uuid> {
    let mut sessions = state
        .web_active_connections
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .iter()
        .filter_map(|(session_id, connections)| {
            connections
                .contains(&pending.connection_id)
                .then_some(*session_id)
        })
        .collect::<Vec<_>>();
    sessions.sort_unstable();
    sessions
}

pub fn release_pending_owner(state: &ApplicationState, approval_id: &str, session_id: Uuid) {
    let mut owners = state
        .web_approval_owners
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if owners.get(approval_id) == Some(&session_id) {
        owners.remove(approval_id);
    }
}

pub(crate) fn claim_pending_for_session(
    state: &ApplicationState,
    session_id: Uuid,
    pending: &PendingApproval,
) -> bool {
    let authorized_sessions = authorized_sessions_for_pending(state, pending);
    if !authorized_sessions.contains(&session_id) {
        return false;
    }

    let mut owners = state
        .web_approval_owners
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    match owners.get(&pending.id) {
        Some(owner) if *owner == session_id => true,
        Some(owner) if authorized_sessions.contains(owner) => false,
        Some(_) | None => {
            owners.insert(pending.id.clone(), session_id);
            true
        }
    }
}

async fn decide_pending_approval(
    runtime: &RuntimeContext,
    state: &ApplicationState,
    web_session_id: Option<Uuid>,
    approval_id: String,
    decision: String,
    reason: Option<String>,
    edited_query: Option<String>,
) -> Result<(), String> {
    if decision != "approve" && decision != "deny" {
        return Err(format!(
            "Invalid decision '{decision}': expected 'approve' or 'deny'"
        ));
    }

    let config_dir = runtime.paths.config_dir().to_path_buf();
    let pending_id = approval_id.clone();
    let pending = tokio::task::spawn_blocking({
        let config_dir = config_dir.clone();
        move || crate::ai_approval::read_pending_in(&config_dir, &pending_id)
    })
    .await
    .map_err(|error| error.to_string())??
    .ok_or_else(|| "The pending AI approval no longer exists".to_string())?;

    if let Some(session_id) = web_session_id {
        if !claim_pending_for_session(state, session_id, &pending) {
            return Err("The AI approval belongs to another authorized session".to_string());
        }
    }

    let payload = ApprovalDecision {
        approval_id: approval_id.clone(),
        decided_at: crate::ai_activity::now_iso8601(),
        decision,
        reason,
        edited_query,
    };
    tokio::task::spawn_blocking(move || {
        crate::ai_approval::write_decision_in(&config_dir, &payload)
    })
    .await
    .map_err(|error| error.to_string())??;
    state
        .web_approval_owners
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(&approval_id);
    Ok(())
}

fn cached_key(cache: &CredentialCache, provider: &str) -> Option<Option<String>> {
    cache
        .ai_keys
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get(provider)
        .map(|entry| match entry {
            CacheEntry::Present(key) => Some(key.clone()),
            CacheEntry::Absent => None,
        })
}

fn key_account(provider: &str) -> String {
    format!("{AI_KEY_PREFIX}{provider}")
}

fn environment_key(provider: &str) -> Option<String> {
    let variable = match provider {
        "openai" => "OPENAI_API_KEY",
        "anthropic" => "ANTHROPIC_API_KEY",
        "openrouter" => "OPENROUTER_API_KEY",
        "custom-openai" => "CUSTOM_OPENAI_API_KEY",
        "minimax" => "MINIMAX_API_KEY",
        _ => return None,
    };
    std::env::var(variable).ok().filter(|key| !key.is_empty())
}

fn missing_key_error(provider: &str) -> String {
    format!("API Key for {provider} not found in Keychain or Environment")
}

fn json(value: impl Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests;
