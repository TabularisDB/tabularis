use super::{connections, tunnels};
use crate::runtime::{state::ApplicationState, RuntimeContext};
use async_trait::async_trait;
use serde_json::Value;
use std::sync::Arc;
use std::time::Instant;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum AuthorizationLevel {
    Session,
    Database,
    Sensitive,
    LocalAdmin,
}

impl AuthorizationLevel {
    pub fn permits(self, required: Self) -> bool {
        self >= required
    }
}

#[derive(Clone, Debug)]
pub struct ApplicationRequestContext {
    pub request_id: String,
    pub deadline: Instant,
    pub cancellation_id: Option<String>,
    pub authorization: AuthorizationLevel,
    pub session_id: Option<Uuid>,
}

#[derive(Debug)]
pub struct ApplicationError {
    pub message: String,
    pub details: Option<Value>,
}

impl ApplicationError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            details: None,
        }
    }
}

#[async_trait]
pub trait ApplicationApi: Send + Sync {
    async fn is_debug_mode(
        &self,
        context: ApplicationRequestContext,
    ) -> Result<bool, ApplicationError>;

    async fn get_connections(
        &self,
        context: ApplicationRequestContext,
    ) -> Result<Vec<crate::models::SavedConnection>, ApplicationError>;

    async fn cancel_query(
        &self,
        context: ApplicationRequestContext,
        connection_id: String,
    ) -> Result<(), ApplicationError>;

    async fn execute_connection_command(
        &self,
        context: ApplicationRequestContext,
        command: connections::ConnectionCommand,
    ) -> Result<Value, ApplicationError>;

    async fn execute_tunnel_command(
        &self,
        context: ApplicationRequestContext,
        command: tunnels::TunnelCommand,
    ) -> Result<Value, ApplicationError>;
}

pub struct RuntimeApplicationApi {
    runtime: RuntimeContext,
    state: Arc<ApplicationState>,
}

impl RuntimeApplicationApi {
    pub fn new(runtime: RuntimeContext, state: Arc<ApplicationState>) -> Self {
        Self { runtime, state }
    }
}

#[async_trait]
impl ApplicationApi for RuntimeApplicationApi {
    async fn is_debug_mode(
        &self,
        _context: ApplicationRequestContext,
    ) -> Result<bool, ApplicationError> {
        Ok(crate::runtime::bootstrap::is_debug_mode())
    }

    async fn get_connections(
        &self,
        _context: ApplicationRequestContext,
    ) -> Result<Vec<crate::models::SavedConnection>, ApplicationError> {
        let path = self.runtime.paths.connections_file();
        tokio::task::spawn_blocking(move || connections::load_redacted_connections(&path))
            .await
            .map_err(|error| ApplicationError::new(format!("Failed to load connections: {error}")))?
            .map_err(ApplicationError::new)
    }

    async fn cancel_query(
        &self,
        _context: ApplicationRequestContext,
        connection_id: String,
    ) -> Result<(), ApplicationError> {
        crate::commands::cancel_query_impl(&self.state.query_cancellation, &connection_id)
            .map_err(ApplicationError::new)
    }

    async fn execute_connection_command(
        &self,
        context: ApplicationRequestContext,
        command: connections::ConnectionCommand,
    ) -> Result<Value, ApplicationError> {
        connections::execute_for_session(&self.runtime, &self.state, context.session_id, command)
            .await
            .map_err(ApplicationError::new)
    }

    async fn execute_tunnel_command(
        &self,
        context: ApplicationRequestContext,
        command: tunnels::TunnelCommand,
    ) -> Result<Value, ApplicationError> {
        tunnels::execute(&self.runtime, context.session_id, command)
            .await
            .map_err(ApplicationError::new)
    }
}
