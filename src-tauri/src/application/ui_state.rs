//! Shared UI state commands (see [`crate::ui_state`]).

use crate::runtime::RuntimeContext;
use serde_json::{json, Value};

/// Event emitted after a key changes so other windows and browser sessions
/// can apply the new value without reloading.
pub const UI_STATE_CHANGED_EVENT: &str = "ui-state://changed";

#[derive(Clone, Debug, PartialEq)]
pub enum UiStateCommand {
    Get { keys: Option<Vec<String>> },
    Set { key: String, value: Value },
    Delete { key: String },
}

pub async fn execute(runtime: &RuntimeContext, command: UiStateCommand) -> Result<Value, String> {
    let database = crate::ui_state::database_path(runtime.paths.config_dir());
    match command {
        UiStateCommand::Get { keys } => Ok(Value::Object(
            crate::ui_state::get_entries(&database, keys.as_deref()).await?,
        )),
        UiStateCommand::Set { key, value } => {
            crate::ui_state::set_entry(&database, &key, &value).await?;
            notify(runtime, &key, value);
            Ok(Value::Null)
        }
        UiStateCommand::Delete { key } => {
            if crate::ui_state::delete_entry(&database, &key).await? {
                notify(runtime, &key, Value::Null);
            }
            Ok(Value::Null)
        }
    }
}

fn notify(runtime: &RuntimeContext, key: &str, value: Value) {
    if let Err(error) = runtime.events.emit(
        UI_STATE_CHANGED_EVENT,
        json!({ "key": key, "value": value }),
    ) {
        log::warn!("UI state {key} saved but change delivery failed: {error}");
    }
}

#[cfg(test)]
#[path = "ui_state_tests.rs"]
mod tests;
