//! Versioned driver protocol for isolated routine-debugging sessions.
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct DebugTarget {
    pub database: String,
    pub schema: String,
    pub name: String,
    pub routine_type: String,
    pub identity_args: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DebugArgument {
    pub position: u32,
    /// Bound input value, never a SQL expression.
    pub value: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum DebugCommand {
    Preview {
        target: DebugTarget,
        arguments: Vec<DebugArgument>,
    },
    Start {
        preview_id: String,
        session_id: String,
    },
    Stop {
        session_id: String,
    },
    Continue {
        session_id: String,
    },
    Step {
        session_id: String,
        mode: DebugStep,
    },
    SetBreakpoints {
        session_id: String,
        breakpoints: Vec<DebugBreakpoint>,
    },
    ReadStack {
        session_id: String,
    },
    ReadVariables {
        session_id: String,
        frame_id: String,
        names: Vec<String>,
    },
    Status {
        session_id: String,
    },
}

impl DebugCommand {
    /// Even inspection may evaluate code in a native debugger. Only stop/status
    /// remain available after a connection is switched to read-only.
    pub fn validate(&self, version: u32, readonly: bool) -> Result<(), String> {
        if version != PROTOCOL_VERSION {
            return Err("Unsupported routine debugger protocol version".into());
        }
        if readonly && !matches!(self, Self::Stop { .. } | Self::Status { .. }) {
            return Err("Routine debugging is unavailable on read-only connections".into());
        }
        match self {
            Self::Preview { target, arguments } => {
                if [&target.database, &target.schema, &target.name]
                    .iter()
                    .any(|s| s.trim().is_empty())
                    || !matches!(target.routine_type.as_str(), "PROCEDURE" | "FUNCTION")
                {
                    return Err("A fully qualified routine target is required".into());
                }
                let mut positions = std::collections::HashSet::new();
                if arguments
                    .iter()
                    .any(|arg| arg.position == 0 || !positions.insert(arg.position))
                {
                    return Err("Routine argument positions must be unique and one-based".into());
                }
            }
            Self::Start {
                preview_id,
                session_id,
            } => {
                if preview_id.is_empty() || session_id.is_empty() {
                    return Err("An explicit start requires a preview and session identity".into());
                }
            }
            Self::SetBreakpoints {
                session_id,
                breakpoints,
            } => {
                if session_id.is_empty()
                    || breakpoints
                        .iter()
                        .any(|bp| bp.line == 0 || bp.source_id.is_empty())
                {
                    return Err("Breakpoints require a session, source and one-based line".into());
                }
            }
            Self::ReadVariables {
                session_id,
                frame_id,
                ..
            } => {
                if session_id.is_empty() || frame_id.is_empty() {
                    return Err("Variable reads require a session and frame".into());
                }
            }
            Self::Stop { session_id }
            | Self::Continue { session_id }
            | Self::Step { session_id, .. }
            | Self::ReadStack { session_id }
            | Self::Status { session_id } => {
                if session_id.is_empty() {
                    return Err("A debug session identity is required".into());
                }
            }
        }
        Ok(())
    }

    pub fn session_id(&self) -> Option<&str> {
        match self {
            Self::Preview { .. } => None,
            Self::Start { session_id, .. }
            | Self::Stop { session_id }
            | Self::Continue { session_id }
            | Self::Step { session_id, .. }
            | Self::SetBreakpoints { session_id, .. }
            | Self::ReadStack { session_id }
            | Self::ReadVariables { session_id, .. }
            | Self::Status { session_id } => Some(session_id),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DebugStep {
    Into,
    Over,
    Out,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DebugBreakpoint {
    pub source_id: String,
    pub line: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DebugResponse {
    Preview {
        version: u32,
        preview_id: String,
        target: DebugTarget,
        arguments: Vec<DebugArgument>,
        source: DebugRead<DebugSource>,
        /// Engine-specific transaction and external-effect semantics.
        warnings: Vec<String>,
    },
    Session {
        version: u32,
        session: DebugSnapshot,
    },
}

impl DebugResponse {
    pub fn validate_for(&self, command: &DebugCommand) -> Result<(), String> {
        let valid = match (self, command) {
            (
                Self::Preview {
                    version,
                    preview_id,
                    target,
                    arguments,
                    ..
                },
                DebugCommand::Preview {
                    target: expected,
                    arguments: expected_args,
                },
            ) => {
                *version == PROTOCOL_VERSION
                    && !preview_id.is_empty()
                    && target == expected
                    && serde_json::to_value(arguments).ok()
                        == serde_json::to_value(expected_args).ok()
            }
            (Self::Session { version, session }, command) => {
                *version == PROTOCOL_VERSION
                    && command.session_id() == Some(session.session_id.as_str())
            }
            _ => false,
        };
        if valid {
            Ok(())
        } else {
            Err("Invalid routine debugger response identity or version".into())
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DebugSnapshot {
    pub session_id: String,
    /// Monotonically increasing within one session, including inspection reads.
    pub revision: u64,
    pub execution: DebugExecution,
    pub transaction: DebugTransaction,
    pub resources: DebugResources,
    pub source: DebugRead<DebugSource>,
    pub stop: DebugRead<DebugLocation>,
    pub stack: DebugRead<Vec<DebugFrame>>,
    pub variables: DebugRead<Vec<DebugVariable>>,
    pub outputs: DebugRead<Vec<DebugVariable>>,
    pub breakpoints: DebugRead<Vec<DebugBreakpoint>>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DebugExecution {
    Running,
    Paused,
    Completed,
    Failed,
    Cancelled,
    Unknown,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DebugTransaction {
    Open,
    Committed,
    RolledBack,
    Unknown,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DebugResources {
    Held,
    Released,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum DebugRead<T> {
    Available { value: T },
    Partial { value: T, reason: String },
    Stale { value: T, reason: String },
    Unavailable { reason: String },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DebugSource {
    pub source_id: String,
    pub text: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DebugLocation {
    pub source_id: String,
    pub line: u32,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DebugFrame {
    pub frame_id: String,
    pub name: String,
    pub location: DebugRead<DebugLocation>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DebugVariable {
    pub name: String,
    pub data_type: String,
    pub value: DebugRead<Value>,
}

#[cfg(test)]
mod tests;
