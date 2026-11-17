//! Connection-scoped plugin services. Credentials never return to UI callers.
use super::{connections, AuthorizationLevel};
use crate::drivers::{driver_trait::DatabaseDriver, registry::get_driver};
use crate::plugins::extension_policy::{
    secret_key, validate_request, validate_secrets, validate_target,
};
use crate::runtime::RuntimeContext;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionScope {
    pub plugin_id: String,
    pub connection_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionRequest {
    pub plugin_id: String,
    pub connection_id: String,
    pub method: String,
    pub args: Value,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SecretRequest {
    pub plugin_id: String,
    pub connection_id: String,
    pub secrets: Value,
}

#[derive(Clone, Debug)]
pub enum ExtensionCommand {
    Call(ExtensionRequest),
    SetSecrets(SecretRequest),
    SecretFields(ExtensionScope),
    DeleteSecrets(ExtensionScope),
}

impl ExtensionCommand {
    pub fn authorization(&self) -> AuthorizationLevel {
        match self {
            Self::SecretFields(_) => AuthorizationLevel::Database,
            // An opaque plugin method may mutate remote resources.
            _ => AuthorizationLevel::LocalAdmin,
        }
    }
}

async fn owned_driver(
    runtime: &RuntimeContext,
    plugin_id: &str,
    connection_id: &str,
) -> Result<Arc<dyn DatabaseDriver>, String> {
    let driver_id = connections::saved_connection_driver(runtime, connection_id)?;
    validate_target(plugin_id, &driver_id)?;
    let driver = get_driver(plugin_id)
        .await
        .ok_or("Plugin is disabled or unavailable")?;
    if driver.manifest().is_builtin {
        return Err("Built-in drivers do not expose plugin extensions".into());
    }
    Ok(driver)
}

fn read_secrets(
    runtime: &RuntimeContext,
    plugin_id: &str,
    connection_id: &str,
) -> Result<Value, String> {
    match runtime.secrets.get(&secret_key(plugin_id, connection_id))? {
        None => Ok(json!({})),
        Some(value) => {
            let value: Value = serde_json::from_str(&value)
                .map_err(|_| "Stored plugin credentials are invalid")?;
            validate_secrets(&value).map_err(|_| "Stored plugin credentials are invalid")?;
            Ok(value)
        }
    }
}

async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|error| error.to_string())?
}

pub async fn execute(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    authorization: AuthorizationLevel,
    command: ExtensionCommand,
) -> Result<Value, String> {
    if !authorization.permits(command.authorization()) {
        return Err("Plugin service requires administrator authorization".into());
    }
    match command {
        ExtensionCommand::Call(request) => {
            validate_request(&request.method, &request.args)?;
            let driver = owned_driver(runtime, &request.plugin_id, &request.connection_id).await?;
            let owned_runtime = runtime.clone();
            let plugin_id = request.plugin_id.clone();
            let connection_id = request.connection_id.clone();
            let (driver_id, params, secrets) = blocking(move || {
                let (driver_id, params) = connections::resolve_saved_connection_params(
                    &owned_runtime,
                    session_id,
                    &connection_id,
                )?;
                let secrets = read_secrets(&owned_runtime, &plugin_id, &connection_id)?;
                Ok((driver_id, params, secrets))
            })
            .await?;
            // Recheck after resolution to avoid forwarding credentials after a driver change.
            validate_target(&request.plugin_id, &driver_id)?;
            driver.call_extension(json!({
                "method": request.method, "args": request.args, "params": params, "secrets": secrets,
                "context": { "plugin_id": request.plugin_id, "connection_id": request.connection_id }
            })).await
        }
        ExtensionCommand::SetSecrets(request) => {
            owned_driver(runtime, &request.plugin_id, &request.connection_id).await?;
            validate_secrets(&request.secrets)?;
            let runtime = runtime.clone();
            blocking(move || {
                runtime.secrets.set(
                    &secret_key(&request.plugin_id, &request.connection_id),
                    &request.secrets.to_string(),
                )
            })
            .await?;
            Ok(Value::Null)
        }
        ExtensionCommand::SecretFields(scope) => {
            owned_driver(runtime, &scope.plugin_id, &scope.connection_id).await?;
            let runtime = runtime.clone();
            let value =
                blocking(move || read_secrets(&runtime, &scope.plugin_id, &scope.connection_id))
                    .await?;
            Ok(json!(value
                .as_object()
                .map(|fields| fields.keys().cloned().collect::<Vec<_>>())
                .unwrap_or_default()))
        }
        ExtensionCommand::DeleteSecrets(scope) => {
            owned_driver(runtime, &scope.plugin_id, &scope.connection_id).await?;
            let runtime = runtime.clone();
            blocking(move || {
                runtime
                    .secrets
                    .delete(&secret_key(&scope.plugin_id, &scope.connection_id))
            })
            .await?;
            Ok(Value::Null)
        }
    }
}

#[cfg(test)]
mod tests;
