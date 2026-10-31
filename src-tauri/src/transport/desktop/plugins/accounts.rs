use crate::application::{
    plugin_accounts::{self, AccountRequest},
    AuthorizationLevel,
};
use crate::runtime::{state::ApplicationState, RuntimeContext};
use serde_json::Value;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn plugin_account(
    runtime: State<'_, RuntimeContext>,
    state: State<'_, Arc<ApplicationState>>,
    plugin_id: String,
    operation: String,
    secrets: Option<Value>,
    method: Option<String>,
    args: Option<Value>,
) -> Result<Value, String> {
    let mut value = serde_json::json!({"pluginId":plugin_id,"operation":operation});
    for (name, field) in [
        ("secrets", secrets),
        ("method", method.map(Value::String)),
        ("args", args),
    ] {
        if let Some(field) = field {
            value[name] = field;
        }
    }
    let request: AccountRequest =
        serde_json::from_value(value).map_err(|_| "Invalid provider account request")?;
    plugin_accounts::execute(
        runtime.inner(),
        state.inner(),
        AuthorizationLevel::LocalAdmin,
        request,
    )
    .await
}
