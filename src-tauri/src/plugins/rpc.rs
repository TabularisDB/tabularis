use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize, Debug)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub method: String,
    pub params: Value,
    pub id: u64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
}

/// Preserve remote error codes internally without changing legacy callers'
/// error strings. Discovery falls back only on the remote -32601 code.
#[derive(Debug)]
pub enum PluginCallError {
    Remote(JsonRpcError),
    Transport(String),
}

impl std::fmt::Display for PluginCallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Remote(error) => f.write_str(&error.message),
            Self::Transport(message) => f.write_str(message),
        }
    }
}

impl From<String> for PluginCallError {
    fn from(message: String) -> Self {
        Self::Transport(message)
    }
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(untagged)]
pub enum JsonRpcResponse {
    Success {
        jsonrpc: String,
        result: Value,
        id: Option<u64>,
    },
    /// `id` is `null` when the plugin couldn't determine the request id,
    /// e.g. parse errors (-32700) and invalid requests (-32600).
    Error {
        jsonrpc: String,
        error: JsonRpcError,
        id: Option<u64>,
    },
}

/// A JSON-RPC notification: no `id`, so the plugin must not reply.
#[derive(Serialize, Debug)]
pub struct JsonRpcNotification {
    pub jsonrpc: String,
    pub method: String,
    pub params: Value,
}

/// Line written to the plugin's stdin when the host stops waiting for request
/// `id` (call timeout). Plugins that support it cancel the in-flight work,
/// e.g. the server-side statement; unknown ids must be ignored.
pub fn cancel_notification_line(id: u64) -> String {
    let notification = JsonRpcNotification {
        jsonrpc: "2.0".to_string(),
        method: "cancel".to_string(),
        params: serde_json::json!({ "id": id }),
    };
    let mut line = serde_json::to_string(&notification).unwrap();
    line.push('\n');
    line
}

#[cfg(test)]
#[path = "rpc_tests.rs"]
mod tests;
