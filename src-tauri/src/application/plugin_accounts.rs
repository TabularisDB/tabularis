//! Provider accounts are separate from saved SQL connections; credentials stay in the host.
use super::{connections, AuthorizationLevel};
use crate::drivers::{driver_trait::DatabaseDriver, registry::get_driver};
use crate::models::ConnectionParams;
use crate::plugins::extension_policy::{validate_request, validate_secrets, validate_target};
use crate::runtime::{state::ApplicationState, RuntimeContext};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AccountOperation {
    Connect,
    Fields,
    Disconnect,
    Call,
    Prepare,
    Import,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountRequest {
    pub plugin_id: String,
    pub operation: AccountOperation,
    pub secrets: Option<Value>,
    pub method: Option<String>,
    pub args: Option<Value>,
}

impl std::fmt::Debug for AccountRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AccountRequest")
            .field("plugin_id", &self.plugin_id)
            .field("operation", &self.operation)
            .finish_non_exhaustive()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ImportedConnection {
    name: String,
    params: ConnectionParams,
    secrets: Value,
    #[serde(default)]
    warnings: Vec<String>,
}

fn account_key(plugin_id: &str) -> String {
    format!("plugin-account:{}:{plugin_id}", plugin_id.len())
}

fn validate_operation(request: &AccountRequest) -> Result<(), String> {
    let valid = match request.operation {
        AccountOperation::Connect => {
            request.secrets.is_some() && request.method.is_none() && request.args.is_none()
        }
        AccountOperation::Fields | AccountOperation::Disconnect => {
            request.secrets.is_none() && request.method.is_none() && request.args.is_none()
        }
        AccountOperation::Call | AccountOperation::Prepare => {
            request.secrets.is_none() && request.method.is_some() && request.args.is_some()
        }
        AccountOperation::Import => {
            request.secrets.is_none() && request.method.is_none() && request.args.is_some()
        }
    };
    if !valid {
        return Err("Invalid provider account operation fields".into());
    }
    if let Some(secrets) = &request.secrets {
        validate_secrets(secrets)?;
    }
    if let Some(args) = &request.args {
        let method = request.method.as_deref().unwrap_or("account_import");
        validate_request(method, args)?;
        if matches!(
            request.operation,
            AccountOperation::Call | AccountOperation::Prepare
        ) && method == "account_import"
        {
            return Err("account_import is reserved for the host import operation".into());
        }
    }
    Ok(())
}

async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|_| "Provider credential operation failed".to_string())?
}

async fn account_driver(plugin_id: &str) -> Result<Arc<dyn DatabaseDriver>, String> {
    validate_target(plugin_id, plugin_id)?;
    let driver = get_driver(plugin_id)
        .await
        .ok_or("Plugin is disabled or unavailable")?;
    if driver.manifest().is_builtin {
        return Err("An external provider plugin is required".into());
    }
    Ok(driver)
}

pub async fn execute(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    authorization: AuthorizationLevel,
    request: AccountRequest,
) -> Result<Value, String> {
    if !authorization.permits(AuthorizationLevel::LocalAdmin) {
        return Err("Provider accounts require administrator authorization".into());
    }
    validate_operation(&request)?;
    let driver = account_driver(&request.plugin_id).await?;
    let key = account_key(&request.plugin_id);
    let runtime_owned = runtime.clone();
    match request.operation {
        AccountOperation::Connect => {
            let secrets = request.secrets.unwrap();
            blocking(move || runtime_owned.secrets.set(&key, &secrets.to_string())).await?;
            Ok(Value::Null)
        }
        AccountOperation::Disconnect => {
            blocking(move || runtime_owned.secrets.delete(&key)).await?;
            Ok(Value::Null)
        }
        AccountOperation::Prepare => {
            // Setup status/login flows run before linking an account and never receive its secrets.
            driver
                .call_extension(json!({
                    "method": request.method.unwrap(), "args": request.args.unwrap(), "secrets": {},
                    "context": {"plugin_id": request.plugin_id, "scope": "account-setup"}
                }))
                .await
        }
        operation => {
            let secrets = blocking(move || match runtime_owned.secrets.get(&key)? {
                None => Ok(json!({})),
                Some(value) => {
                    let secrets: Value = serde_json::from_str(&value)
                        .map_err(|_| "Stored provider credentials are invalid")?;
                    validate_secrets(&secrets)
                        .map_err(|_| "Stored provider credentials are invalid")?;
                    Ok(secrets)
                }
            })
            .await?;
            if matches!(operation, AccountOperation::Fields) {
                return Ok(json!(secrets
                    .as_object()
                    .map(|value| value.keys().cloned().collect::<Vec<_>>())
                    .unwrap_or_default()));
            }
            if secrets.as_object().is_none_or(|value| value.is_empty()) {
                return Err("Connect the provider account first".into());
            }
            let importing = matches!(operation, AccountOperation::Import);
            let result = driver.call_extension(json!({
                "method": if importing { "account_import" } else { request.method.as_deref().unwrap() },
                "args": request.args.unwrap(), "secrets": secrets,
                "context": {"plugin_id":request.plugin_id,"scope":"account"}
            })).await?;
            if !importing {
                return Ok(result);
            }
            persist_import(runtime, state, &request.plugin_id, result).await
        }
    }
}

async fn persist_import(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    plugin_id: &str,
    result: Value,
) -> Result<Value, String> {
    let mut imported: ImportedConnection =
        serde_json::from_value(result).map_err(|_| "Provider returned an invalid connection")?;
    validate_target(plugin_id, &imported.params.driver)?;
    if imported.name.trim().is_empty()
        || imported.name.len() > 256
        || imported.warnings.len() > 32
        || imported.warnings.iter().any(|warning| warning.len() > 2048)
    {
        return Err("Provider returned invalid connection metadata".into());
    }
    let fields = imported
        .secrets
        .as_object()
        .ok_or("Provider returned invalid service credentials")?;
    if !fields.is_empty() {
        validate_secrets(&imported.secrets)?;
    }
    // Provider-supplied secrets must never be written into ordinary connection settings.
    if !imported.params.extra.is_empty() {
        return Err("Provider imports cannot include arbitrary connection settings".into());
    }
    imported.params.save_in_keychain = Some(true);
    let runtime_owned = runtime.clone();
    let state = state.clone();
    let name = imported.name;
    let warnings = imported.warnings;
    let saved = blocking(move || {
        connections::save_provider_connection(
            &runtime_owned, &state, name, imported.params, imported.secrets,
        )
    }).await.map_err(|_| "Secure credential storage or local connection persistence failed; the import was rolled back")?;
    let id = saved.id;
    let name = saved.name;
    Ok(json!({"id":id,"name":name,"warnings":warnings}))
}

#[cfg(test)]
mod tests;
