use crate::application::plugin_extensions::{
    self, ExtensionCommand, ExtensionRequest, ExtensionScope, SecretRequest,
};
use crate::application::AuthorizationLevel;
use crate::runtime::RuntimeContext;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn call_plugin_extension(
    runtime: State<'_, RuntimeContext>,
    plugin_id: String,
    connection_id: String,
    method: String,
    args: Value,
) -> Result<Value, String> {
    plugin_extensions::execute(
        runtime.inner(),
        None,
        AuthorizationLevel::LocalAdmin,
        ExtensionCommand::Call(ExtensionRequest {
            plugin_id,
            connection_id,
            method,
            args,
        }),
    )
    .await
}

#[tauri::command]
pub async fn set_plugin_secrets(
    runtime: State<'_, RuntimeContext>,
    plugin_id: String,
    connection_id: String,
    secrets: Value,
) -> Result<Value, String> {
    plugin_extensions::execute(
        runtime.inner(),
        None,
        AuthorizationLevel::LocalAdmin,
        ExtensionCommand::SetSecrets(SecretRequest {
            plugin_id,
            connection_id,
            secrets,
        }),
    )
    .await
}

#[tauri::command]
pub async fn get_plugin_secret_fields(
    runtime: State<'_, RuntimeContext>,
    plugin_id: String,
    connection_id: String,
) -> Result<Value, String> {
    plugin_extensions::execute(
        runtime.inner(),
        None,
        AuthorizationLevel::LocalAdmin,
        ExtensionCommand::SecretFields(ExtensionScope {
            plugin_id,
            connection_id,
        }),
    )
    .await
}

#[tauri::command]
pub async fn delete_plugin_secrets(
    runtime: State<'_, RuntimeContext>,
    plugin_id: String,
    connection_id: String,
) -> Result<Value, String> {
    plugin_extensions::execute(
        runtime.inner(),
        None,
        AuthorizationLevel::LocalAdmin,
        ExtensionCommand::DeleteSecrets(ExtensionScope {
            plugin_id,
            connection_id,
        }),
    )
    .await
}
