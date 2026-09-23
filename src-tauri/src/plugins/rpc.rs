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
        id: u64,
    },
    Error {
        jsonrpc: String,
        error: JsonRpcError,
        id: u64,
    },
}
