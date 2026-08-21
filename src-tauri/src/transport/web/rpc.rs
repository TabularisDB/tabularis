use crate::application::{
    ApplicationApi, ApplicationError, ApplicationRequestContext, AuthorizationLevel,
};
use axum::body::Bytes;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const RPC_DEADLINE_HEADER_NAME: &str = "x-tabularis-deadline-ms";
pub const RPC_CANCELLATION_HEADER_NAME: &str = "x-tabularis-cancellation-id";

const DEFAULT_DEADLINE: Duration = Duration::from_secs(30);
const MAX_DEADLINE: Duration = Duration::from_secs(5 * 60);
const MAX_CANCELLATION_ID_LENGTH: usize = 128;

#[derive(Clone)]
pub struct RpcDispatcher {
    application: Arc<dyn ApplicationApi>,
    active_cancellations: Arc<Mutex<HashSet<String>>>,
}

#[derive(Clone, Debug)]
pub struct RequestId(pub String);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RpcCommand {
    IsDebugMode,
    GetConnections,
    CancelQuery,
}

#[derive(Clone, Copy)]
struct CommandMetadata {
    authorization: AuthorizationLevel,
    application_error_code: &'static str,
    application_error_status: StatusCode,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CancelQueryRequest {
    connection_id: String,
}

#[derive(Serialize)]
struct RpcSuccess {
    ok: bool,
    data: Value,
}

#[derive(Serialize)]
struct RpcFailure {
    ok: bool,
    error: RpcError,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RpcError {
    code: &'static str,
    message: String,
    details: Option<Value>,
    request_id: String,
}

enum InvocationError {
    InvalidPayload(String),
    Application(ApplicationError),
}

struct CancellationRegistration {
    id: String,
    active: Arc<Mutex<HashSet<String>>>,
}

impl RpcDispatcher {
    pub fn new(application: Arc<dyn ApplicationApi>) -> Self {
        Self {
            application,
            active_cancellations: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    pub async fn dispatch(
        &self,
        command_name: &str,
        request_id: RequestId,
        headers: &HeaderMap,
        body: Bytes,
    ) -> Response {
        let Some(command) = RpcCommand::parse(command_name) else {
            return failure(
                StatusCode::NOT_FOUND,
                "COMMAND_NOT_FOUND",
                format!("Unknown RPC command: {command_name}"),
                None,
                request_id.0,
            );
        };
        let metadata = command.metadata();
        let granted_authorization = AuthorizationLevel::LocalAdmin;
        if !granted_authorization.permits(metadata.authorization) {
            return failure(
                StatusCode::FORBIDDEN,
                "FORBIDDEN",
                "The session is not authorized for this command".to_string(),
                None,
                request_id.0,
            );
        }

        if !body.is_empty() && !has_json_content_type(headers) {
            return failure(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "INVALID_CONTENT_TYPE",
                "RPC requests must use application/json".to_string(),
                None,
                request_id.0,
            );
        }

        let deadline = match request_deadline(headers) {
            Ok(deadline) => deadline,
            Err(message) => {
                return failure(
                    StatusCode::BAD_REQUEST,
                    "INVALID_DEADLINE",
                    message,
                    None,
                    request_id.0,
                )
            }
        };
        let cancellation_id = match cancellation_id(headers) {
            Ok(id) => id,
            Err(message) => {
                return failure(
                    StatusCode::BAD_REQUEST,
                    "INVALID_CANCELLATION_ID",
                    message,
                    None,
                    request_id.0,
                )
            }
        };
        let _registration = match self.register_cancellation(cancellation_id.as_deref()) {
            Ok(registration) => registration,
            Err(message) => {
                return failure(
                    StatusCode::CONFLICT,
                    "CANCELLATION_ID_IN_USE",
                    message,
                    None,
                    request_id.0,
                )
            }
        };

        let context = ApplicationRequestContext {
            request_id: request_id.0.clone(),
            deadline: Instant::now() + deadline,
            cancellation_id,
            authorization: metadata.authorization,
        };
        let invocation = self.invoke(command, context, &body);
        match tokio::time::timeout(deadline, invocation).await {
            Ok(Ok(data)) => success(data),
            Ok(Err(InvocationError::InvalidPayload(message))) => failure(
                StatusCode::BAD_REQUEST,
                "INVALID_REQUEST",
                message,
                None,
                request_id.0,
            ),
            Ok(Err(InvocationError::Application(error))) => failure(
                metadata.application_error_status,
                metadata.application_error_code,
                error.message,
                error.details,
                request_id.0,
            ),
            Err(_) => failure(
                StatusCode::GATEWAY_TIMEOUT,
                "DEADLINE_EXCEEDED",
                "The RPC request exceeded its deadline".to_string(),
                None,
                request_id.0,
            ),
        }
    }

    async fn invoke(
        &self,
        command: RpcCommand,
        context: ApplicationRequestContext,
        body: &[u8],
    ) -> Result<Value, InvocationError> {
        match command {
            RpcCommand::IsDebugMode => {
                decode_empty_payload(body).map_err(InvocationError::InvalidPayload)?;
                let result = self
                    .application
                    .is_debug_mode(context)
                    .await
                    .map_err(InvocationError::Application)?;
                serde_json::to_value(result).map_err(|error| {
                    InvocationError::Application(ApplicationError::new(error.to_string()))
                })
            }
            RpcCommand::GetConnections => {
                decode_empty_payload(body).map_err(InvocationError::InvalidPayload)?;
                let result = self
                    .application
                    .get_connections(context)
                    .await
                    .map_err(InvocationError::Application)?;
                serde_json::to_value(result).map_err(|error| {
                    InvocationError::Application(ApplicationError::new(error.to_string()))
                })
            }
            RpcCommand::CancelQuery => {
                let request: CancelQueryRequest =
                    decode_payload(body).map_err(InvocationError::InvalidPayload)?;
                self.application
                    .cancel_query(context, request.connection_id)
                    .await
                    .map_err(InvocationError::Application)?;
                Ok(Value::Null)
            }
        }
    }

    fn register_cancellation(
        &self,
        cancellation_id: Option<&str>,
    ) -> Result<Option<CancellationRegistration>, String> {
        let Some(id) = cancellation_id else {
            return Ok(None);
        };
        let mut active = self
            .active_cancellations
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if !active.insert(id.to_string()) {
            return Err("The cancellation identifier is already active".to_string());
        }
        drop(active);
        Ok(Some(CancellationRegistration {
            id: id.to_string(),
            active: self.active_cancellations.clone(),
        }))
    }
}

impl RpcCommand {
    fn parse(name: &str) -> Option<Self> {
        match name {
            "is_debug_mode" => Some(Self::IsDebugMode),
            "get_connections" => Some(Self::GetConnections),
            "cancel_query" => Some(Self::CancelQuery),
            _ => None,
        }
    }

    fn metadata(self) -> CommandMetadata {
        match self {
            Self::IsDebugMode => CommandMetadata {
                authorization: AuthorizationLevel::LocalAdmin,
                application_error_code: "DEBUG_MODE_FAILED",
                application_error_status: StatusCode::INTERNAL_SERVER_ERROR,
            },
            Self::GetConnections => CommandMetadata {
                authorization: AuthorizationLevel::Database,
                application_error_code: "CONNECTIONS_LOAD_FAILED",
                application_error_status: StatusCode::INTERNAL_SERVER_ERROR,
            },
            Self::CancelQuery => CommandMetadata {
                authorization: AuthorizationLevel::Database,
                application_error_code: "QUERY_CANCELLATION_FAILED",
                application_error_status: StatusCode::CONFLICT,
            },
        }
    }
}

impl Drop for CancellationRegistration {
    fn drop(&mut self) {
        self.active
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&self.id);
    }
}

fn decode_empty_payload(body: &[u8]) -> Result<(), String> {
    if body.is_empty() {
        return Ok(());
    }
    let value: Value = decode_payload(body)?;
    if value.is_null() || value.as_object().is_some_and(|object| object.is_empty()) {
        Ok(())
    } else {
        Err("This command does not accept a payload".to_string())
    }
}

fn decode_payload<T: for<'de> Deserialize<'de>>(body: &[u8]) -> Result<T, String> {
    serde_json::from_slice(body).map_err(|error| format!("Invalid command payload: {error}"))
}

fn request_deadline(headers: &HeaderMap) -> Result<Duration, String> {
    let Some(value) = headers.get(RPC_DEADLINE_HEADER_NAME) else {
        return Ok(DEFAULT_DEADLINE);
    };
    let milliseconds = value
        .to_str()
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .ok_or_else(|| "The RPC deadline must be a positive number of milliseconds".to_string())?;
    let deadline = Duration::from_millis(milliseconds);
    if deadline > MAX_DEADLINE {
        return Err(format!(
            "The RPC deadline cannot exceed {} milliseconds",
            MAX_DEADLINE.as_millis()
        ));
    }
    Ok(deadline)
}

fn cancellation_id(headers: &HeaderMap) -> Result<Option<String>, String> {
    let Some(value) = headers.get(RPC_CANCELLATION_HEADER_NAME) else {
        return Ok(None);
    };
    let value = value
        .to_str()
        .map_err(|_| "The cancellation identifier is not valid text".to_string())?;
    if value.is_empty()
        || value.len() > MAX_CANCELLATION_ID_LENGTH
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err("The cancellation identifier has an invalid format".to_string());
    }
    Ok(Some(value.to_string()))
}

fn has_json_content_type(headers: &HeaderMap) -> bool {
    headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value
                .split(';')
                .next()
                .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("application/json"))
        })
}

fn success(data: Value) -> Response {
    (
        StatusCode::OK,
        [(CACHE_CONTROL, "no-store")],
        Json(RpcSuccess { ok: true, data }),
    )
        .into_response()
}

fn failure(
    status: StatusCode,
    code: &'static str,
    message: String,
    details: Option<Value>,
    request_id: String,
) -> Response {
    (
        status,
        [(CACHE_CONTROL, "no-store")],
        Json(RpcFailure {
            ok: false,
            error: RpcError {
                code,
                message,
                details,
                request_id,
            },
        }),
    )
        .into_response()
}

#[cfg(test)]
#[path = "rpc_tests.rs"]
mod tests;
