//! Opt-in machine authentication, deliberately outside browser session middleware.
use super::auth::LocalSessionSecurity;
use crate::application::secret_redaction::SecretRedactor;
use crate::application::{
    provisioning::{ProvisionCommand, ProvisionConnection},
    ApplicationApi,
};
use axum::{
    extract::{Path, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use sha2::{Digest, Sha256};
use std::sync::Arc;

#[derive(Clone)]
pub struct ProvisioningToken([u8; 32]);

impl ProvisioningToken {
    pub fn new(token: &str) -> Result<Self, String> {
        if token.len() < 32 || token.bytes().any(|b| b.is_ascii_whitespace()) {
            return Err("Provisioning token must contain at least 32 non-whitespace bytes".into());
        }
        Ok(Self(Sha256::digest(token.as_bytes()).into()))
    }

    pub fn from_env() -> Result<Option<Self>, String> {
        let direct = std::env::var("TABULARIS_PROVISIONING_TOKEN").ok();
        let file = std::env::var_os("TABULARIS_PROVISIONING_TOKEN_FILE");
        let value = match (direct, file) {
            (Some(_), Some(_)) => return Err("Set only one provisioning token source".into()),
            (Some(value), None) => Some(value),
            (None, Some(path)) => Some(
                std::fs::read_to_string(path)
                    .map_err(|_| "Cannot read provisioning token file")?
                    .trim_end_matches(['\r', '\n'])
                    .to_owned(),
            ),
            (None, None) => None,
        };
        value.map(|v| Self::new(&v)).transpose()
    }

    fn accepts(&self, token: &str) -> bool {
        let candidate: [u8; 32] = Sha256::digest(token.as_bytes()).into();
        // Fixed-size comparison; do not reveal matching prefix length.
        self.0
            .iter()
            .zip(candidate)
            .fold(0u8, |diff, (a, b)| diff | (a ^ b))
            == 0
    }
}

#[derive(Clone)]
struct ProvisioningState {
    token: ProvisioningToken,
    security: LocalSessionSecurity,
    application: Arc<dyn ApplicationApi>,
    redactor: SecretRedactor,
}

pub fn routes(
    token: ProvisioningToken,
    security: LocalSessionSecurity,
    application: Arc<dyn ApplicationApi>,
    redactor: SecretRedactor,
) -> Router {
    let state = ProvisioningState {
        token,
        security,
        application,
        redactor,
    };
    Router::new()
        .route("/api/v1/provisioning/connections", get(list))
        .route(
            "/api/v1/provisioning/connections/:external_ref",
            get(read).put(upsert).delete(remove),
        )
        .layer(tower_http::limit::RequestBodyLimitLayer::new(1024 * 1024))
        .with_state(state.clone())
        .layer(middleware::from_fn_with_state(state, authenticate))
}

async fn authenticate(
    State(state): State<ProvisioningState>,
    request: Request,
    next: Next,
) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok());
    if !host.is_some_and(|h| state.security.host_allowed(h))
        || request.headers().contains_key(header::ORIGIN)
    {
        return error(StatusCode::FORBIDDEN, "machine_request_required");
    }
    let token = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    if !token.is_some_and(|t| state.token.accepts(t)) {
        return error(StatusCode::UNAUTHORIZED, "invalid_provisioning_token");
    }
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
}

fn error(status: StatusCode, code: &str) -> Response {
    (
        status,
        [(header::CACHE_CONTROL, "no-store")],
        Json(serde_json::json!({"error":{"code":code}})),
    )
        .into_response()
}

async fn execute(state: ProvisioningState, command: ProvisionCommand) -> Response {
    match state.application.provision_connection(command).await {
        Ok(value) if value.is_null() => StatusCode::NO_CONTENT.into_response(),
        Ok(value) => {
            super::server::refresh_secrets(state.application.as_ref(), &state.redactor).await;
            Json(value).into_response()
        }
        Err(e) => match e.message.as_str() {
            "not_found" => error(StatusCode::NOT_FOUND, "not_found"),
            "invalid_external_ref"
            | "invalid_name"
            | "invalid_connection"
            | "unknown_driver"
            | "unsupported_read_only" => error(StatusCode::BAD_REQUEST, &e.message),
            _ => error(StatusCode::INTERNAL_SERVER_ERROR, "provisioning_failed"),
        },
    }
}
async fn list(State(state): State<ProvisioningState>) -> Response {
    execute(state, ProvisionCommand::List).await
}
async fn read(State(state): State<ProvisioningState>, Path(reference): Path<String>) -> Response {
    execute(state, ProvisionCommand::Get(reference)).await
}
async fn remove(State(state): State<ProvisioningState>, Path(reference): Path<String>) -> Response {
    execute(state, ProvisionCommand::Delete(reference)).await
}
async fn upsert(
    State(state): State<ProvisioningState>,
    Path(reference): Path<String>,
    body: Result<Json<ProvisionConnection>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let input = match body {
        Ok(Json(input)) => input,
        Err(rejection) if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE => {
            return error(StatusCode::PAYLOAD_TOO_LARGE, "payload_too_large");
        }
        Err(_) => return error(StatusCode::BAD_REQUEST, "invalid_connection"),
    };
    // Register incoming secrets before persistence, so concurrent events cannot
    // expose newly rotated credentials. Keep old values until process exit.
    let mut secrets = Vec::new();
    for value in [
        &input.params.password,
        &input.params.ssh_password,
        &input.params.ssh_key_passphrase,
        &input.params.connection_uri,
        &input.params.socks5_proxy_password,
    ] {
        if let Some(value) = value {
            secrets.push(value.clone());
        }
    }
    secrets.extend(input.plugin_secret_changes.values().flatten().cloned());
    secrets.extend(input.params.extra.values().cloned());
    if secrets
        .iter()
        .any(|v| !v.is_empty() && crate::application::secret_redaction::is_short_secret(v))
    {
        return error(StatusCode::BAD_REQUEST, "credential_too_short");
    }
    state.redactor.extend(secrets);
    execute(state, ProvisionCommand::Put(reference, input)).await
}
