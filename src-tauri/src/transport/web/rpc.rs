use crate::application::{
    connections::ConnectionCommand, metadata::MetadataCommand, queries::QueryCommand,
    tunnels::TunnelCommand, ApplicationApi, ApplicationError, ApplicationRequestContext,
    AuthorizationLevel,
};
use crate::models::{
    ConnectionAppearance, ConnectionParams, K8sConnectionInput, SshConnectionInput, SshTestParams,
    TestConnectionRequest,
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
    Connection(ConnectionRpcCommand),
    Metadata(MetadataRpcCommand),
    Query(QueryRpcCommand),
    Tunnel(TunnelRpcCommand),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum QueryRpcCommand {
    Execute,
    ExecuteBatch,
    Count,
    Explain,
    GetServerNow,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MetadataRpcCommand {
    GetAvailableDatabases,
    GetSchemas,
    GetTables,
    GetColumns,
    GetForeignKeys,
    GetIndexes,
    GetViews,
    GetViewColumns,
    GetMaterializedViews,
    GetMaterializedViewColumns,
    GetMaterializedViewDefinition,
    GetRoutines,
    GetTriggers,
    GetSchemaSnapshot,
    GetSelectedSchemas,
    SetSelectedSchemas,
    GetSchemaPreference,
    SetSchemaPreference,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TunnelRpcCommand {
    GetSshConnections,
    SaveSshConnection,
    UpdateSshConnection,
    DeleteSshConnection,
    TestSshConnection,
    RespondSshAskpass,
    GetK8sConnections,
    SaveK8sConnection,
    UpdateK8sConnection,
    DeleteK8sConnection,
    TestK8sConnection,
    GetK8sContexts,
    GetK8sNamespaces,
    GetK8sResources,
    GetK8sResourcePorts,
    ValidateK8sPath,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ConnectionRpcCommand {
    GetConnectionById,
    GetConnectionsWithGroups,
    SaveConnection,
    UpdateConnection,
    DeleteConnection,
    DuplicateConnection,
    SetConnectionAppearance,
    SaveConnectionIcon,
    DeleteConnectionIcon,
    GetConnectionGroups,
    CreateConnectionGroup,
    CreateGroupPath,
    UpdateConnectionGroup,
    MoveGroupToParent,
    DeleteConnectionGroup,
    MoveConnectionToGroup,
    ReorderGroups,
    ReorderConnectionsInGroup,
    ListConnectionTags,
    CreateConnectionTag,
    UpdateConnectionTag,
    DeleteConnectionTag,
    SetConnectionTags,
    GetRegisteredDrivers,
    GetDriverManifest,
    GetActiveConnections,
    RegisterActiveConnection,
    DisconnectConnection,
    TestConnection,
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
    query_request_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IdRequest {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConnectionIdRequest {
    connection_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MetadataRequest {
    connection_id: String,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TableMetadataRequest {
    connection_id: String,
    table_name: String,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ViewMetadataRequest {
    connection_id: String,
    view_name: String,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetSelectedSchemasRequest {
    connection_id: String,
    schemas: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetSchemaPreferenceRequest {
    connection_id: String,
    schema: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExecuteQueryRequest {
    connection_id: String,
    query: String,
    limit: Option<u32>,
    page: Option<u32>,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExecuteQueryBatchRequest {
    connection_id: String,
    queries: Vec<String>,
    limit: Option<u32>,
    page: Option<u32>,
    schema: Option<String>,
    batch_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CountQueryRequest {
    connection_id: String,
    query: String,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExplainQueryRequest {
    connection_id: String,
    query: String,
    analyze: bool,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveConnectionRequest {
    name: String,
    params: ConnectionParams,
    detect_json_in_text_columns: Option<bool>,
    environment: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateConnectionRequest {
    id: String,
    name: String,
    params: ConnectionParams,
    detect_json_in_text_columns: Option<bool>,
    environment: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AppearanceRequest {
    id: String,
    appearance: Option<ConnectionAppearance>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveIconRequest {
    connection_id: String,
    upload_token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeleteIconRequest {
    relative_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateGroupRequest {
    name: String,
    parent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateGroupPathRequest {
    path: String,
    parent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateGroupRequest {
    id: String,
    name: Option<String>,
    collapsed: Option<bool>,
    sort_order: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MoveGroupRequest {
    id: String,
    parent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MoveConnectionRequest {
    connection_id: String,
    group_id: Option<String>,
    sort_order: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReorderGroupsRequest {
    group_orders: Vec<(String, i32)>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReorderConnectionsRequest {
    connection_orders: Vec<(String, i32)>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TagMutationRequest {
    id: String,
    name: String,
    color: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateTagRequest {
    name: String,
    color: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetTagsRequest {
    connection_id: String,
    tag_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DriverManifestRequest {
    driver_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TestRequest {
    request: TestConnectionRequest,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveSshRequest {
    name: String,
    ssh: SshConnectionInput,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateSshRequest {
    id: String,
    name: String,
    ssh: SshConnectionInput,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TestSshRequest {
    ssh: SshTestParams,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AskpassResponseRequest {
    id: u64,
    response: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveK8sRequest {
    k8s: K8sConnectionInput,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateK8sRequest {
    id: String,
    k8s: K8sConnectionInput,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct K8sOptionsRequest {
    kubectl_path: Option<String>,
    kubeconfig_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TestK8sRequest {
    context: String,
    namespace: String,
    kubectl_path: Option<String>,
    kubeconfig_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct K8sContextRequest {
    context: String,
    kubectl_path: Option<String>,
    kubeconfig_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct K8sResourcesRequest {
    context: String,
    namespace: String,
    resource_type: String,
    kubectl_path: Option<String>,
    kubeconfig_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct K8sPortsRequest {
    context: String,
    namespace: String,
    resource_type: String,
    resource_name: String,
    kubectl_path: Option<String>,
    kubeconfig_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ValidateK8sPathRequest {
    path: String,
    kind: String,
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
        session_id: Option<uuid::Uuid>,
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
        let _registration = match self.register_cancellation(cancellation_id.as_deref(), session_id)
        {
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
            session_id,
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
                if let Some(request_id) = request.query_request_id.as_deref() {
                    validate_query_request_id(request_id)
                        .map_err(InvocationError::InvalidPayload)?;
                }
                self.application
                    .cancel_query(context, request.connection_id, request.query_request_id)
                    .await
                    .map_err(InvocationError::Application)?;
                Ok(Value::Null)
            }
            RpcCommand::Query(command) => {
                let command =
                    decode_query_command(command, body).map_err(InvocationError::InvalidPayload)?;
                self.application
                    .execute_query_command(context, command)
                    .await
                    .map_err(InvocationError::Application)
            }
            RpcCommand::Connection(command) => {
                let command = decode_connection_command(command, context.session_id, body)
                    .map_err(InvocationError::InvalidPayload)?;
                self.application
                    .execute_connection_command(context, command)
                    .await
                    .map_err(InvocationError::Application)
            }
            RpcCommand::Metadata(command) => {
                let command = decode_metadata_command(command, body)
                    .map_err(InvocationError::InvalidPayload)?;
                self.application
                    .execute_metadata_command(context, command)
                    .await
                    .map_err(InvocationError::Application)
            }
            RpcCommand::Tunnel(command) => {
                let command = decode_tunnel_command(command, body)
                    .map_err(InvocationError::InvalidPayload)?;
                self.application
                    .execute_tunnel_command(context, command)
                    .await
                    .map_err(InvocationError::Application)
            }
        }
    }

    fn register_cancellation(
        &self,
        cancellation_id: Option<&str>,
        session_id: Option<uuid::Uuid>,
    ) -> Result<Option<CancellationRegistration>, String> {
        let Some(id) = cancellation_id else {
            return Ok(None);
        };
        let id =
            session_id.map_or_else(|| id.to_string(), |session_id| format!("{session_id}:{id}"));
        let mut active = self
            .active_cancellations
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if !active.insert(id.clone()) {
            return Err("The cancellation identifier is already active".to_string());
        }
        drop(active);
        Ok(Some(CancellationRegistration {
            id,
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
            name => QueryRpcCommand::parse(name)
                .map(Self::Query)
                .or_else(|| TunnelRpcCommand::parse(name).map(Self::Tunnel))
                .or_else(|| MetadataRpcCommand::parse(name).map(Self::Metadata))
                .or_else(|| ConnectionRpcCommand::parse(name).map(Self::Connection)),
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
            Self::Query(_) => CommandMetadata {
                authorization: AuthorizationLevel::Database,
                application_error_code: "QUERY_FAILED",
                application_error_status: StatusCode::CONFLICT,
            },
            Self::Connection(_) => CommandMetadata {
                authorization: AuthorizationLevel::Database,
                application_error_code: "CONNECTION_COMMAND_FAILED",
                application_error_status: StatusCode::CONFLICT,
            },
            Self::Metadata(_) => CommandMetadata {
                authorization: AuthorizationLevel::Database,
                application_error_code: "METADATA_COMMAND_FAILED",
                application_error_status: StatusCode::CONFLICT,
            },
            Self::Tunnel(command) => CommandMetadata {
                authorization: if command == TunnelRpcCommand::RespondSshAskpass {
                    AuthorizationLevel::Sensitive
                } else {
                    AuthorizationLevel::LocalAdmin
                },
                application_error_code: "TUNNEL_COMMAND_FAILED",
                application_error_status: StatusCode::CONFLICT,
            },
        }
    }
}

impl QueryRpcCommand {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "execute_query" => Self::Execute,
            "execute_query_batch" => Self::ExecuteBatch,
            "count_query" => Self::Count,
            "explain_query_plan" => Self::Explain,
            "get_server_now" => Self::GetServerNow,
            _ => return None,
        })
    }
}

impl MetadataRpcCommand {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "get_available_databases" => Self::GetAvailableDatabases,
            "get_schemas" => Self::GetSchemas,
            "get_tables" => Self::GetTables,
            "get_columns" => Self::GetColumns,
            "get_foreign_keys" => Self::GetForeignKeys,
            "get_indexes" => Self::GetIndexes,
            "get_views" => Self::GetViews,
            "get_view_columns" => Self::GetViewColumns,
            "get_materialized_views" => Self::GetMaterializedViews,
            "get_materialized_view_columns" => Self::GetMaterializedViewColumns,
            "get_materialized_view_definition" => Self::GetMaterializedViewDefinition,
            "get_routines" => Self::GetRoutines,
            "get_triggers" => Self::GetTriggers,
            "get_schema_snapshot" => Self::GetSchemaSnapshot,
            "get_selected_schemas" => Self::GetSelectedSchemas,
            "set_selected_schemas" => Self::SetSelectedSchemas,
            "get_schema_preference" => Self::GetSchemaPreference,
            "set_schema_preference" => Self::SetSchemaPreference,
            _ => return None,
        })
    }
}

impl TunnelRpcCommand {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "get_ssh_connections" => Self::GetSshConnections,
            "save_ssh_connection" => Self::SaveSshConnection,
            "update_ssh_connection" => Self::UpdateSshConnection,
            "delete_ssh_connection" => Self::DeleteSshConnection,
            "test_ssh_connection" => Self::TestSshConnection,
            "respond_ssh_askpass" => Self::RespondSshAskpass,
            "get_k8s_connections" => Self::GetK8sConnections,
            "save_k8s_connection" => Self::SaveK8sConnection,
            "update_k8s_connection" => Self::UpdateK8sConnection,
            "delete_k8s_connection" => Self::DeleteK8sConnection,
            "test_k8s_connection_cmd" => Self::TestK8sConnection,
            "get_k8s_contexts_cmd" => Self::GetK8sContexts,
            "get_k8s_namespaces_cmd" => Self::GetK8sNamespaces,
            "get_k8s_resources_cmd" => Self::GetK8sResources,
            "get_k8s_resource_ports_cmd" => Self::GetK8sResourcePorts,
            "validate_k8s_path_cmd" => Self::ValidateK8sPath,
            _ => return None,
        })
    }
}

impl ConnectionRpcCommand {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "get_connection_by_id" => Self::GetConnectionById,
            "get_connections_with_groups" => Self::GetConnectionsWithGroups,
            "save_connection" => Self::SaveConnection,
            "update_connection" => Self::UpdateConnection,
            "delete_connection" => Self::DeleteConnection,
            "duplicate_connection" => Self::DuplicateConnection,
            "set_connection_appearance" => Self::SetConnectionAppearance,
            "save_connection_icon" => Self::SaveConnectionIcon,
            "delete_connection_icon" => Self::DeleteConnectionIcon,
            "get_connection_groups" => Self::GetConnectionGroups,
            "create_connection_group" => Self::CreateConnectionGroup,
            "create_group_path" => Self::CreateGroupPath,
            "update_connection_group" => Self::UpdateConnectionGroup,
            "move_group_to_parent" => Self::MoveGroupToParent,
            "delete_connection_group" => Self::DeleteConnectionGroup,
            "move_connection_to_group" => Self::MoveConnectionToGroup,
            "reorder_groups" => Self::ReorderGroups,
            "reorder_connections_in_group" => Self::ReorderConnectionsInGroup,
            "list_connection_tags" => Self::ListConnectionTags,
            "create_connection_tag" => Self::CreateConnectionTag,
            "update_connection_tag" => Self::UpdateConnectionTag,
            "delete_connection_tag" => Self::DeleteConnectionTag,
            "set_connection_tags" => Self::SetConnectionTags,
            "get_registered_drivers" => Self::GetRegisteredDrivers,
            "get_driver_manifest" => Self::GetDriverManifest,
            "get_active_connections" => Self::GetActiveConnections,
            "register_active_connection" => Self::RegisterActiveConnection,
            "disconnect_connection" => Self::DisconnectConnection,
            "test_connection" => Self::TestConnection,
            _ => return None,
        })
    }
}

fn decode_query_command(command: QueryRpcCommand, body: &[u8]) -> Result<QueryCommand, String> {
    Ok(match command {
        QueryRpcCommand::Execute => {
            let request: ExecuteQueryRequest = decode_payload(body)?;
            QueryCommand::Execute {
                connection_id: request.connection_id,
                query: request.query,
                limit: request.limit,
                page: request.page,
                schema: request.schema,
            }
        }
        QueryRpcCommand::ExecuteBatch => {
            let request: ExecuteQueryBatchRequest = decode_payload(body)?;
            QueryCommand::ExecuteBatch {
                connection_id: request.connection_id,
                queries: request.queries,
                limit: request.limit,
                page: request.page,
                schema: request.schema,
                batch_id: request.batch_id,
            }
        }
        QueryRpcCommand::Count => {
            let request: CountQueryRequest = decode_payload(body)?;
            QueryCommand::Count {
                connection_id: request.connection_id,
                query: request.query,
                schema: request.schema,
            }
        }
        QueryRpcCommand::Explain => {
            let request: ExplainQueryRequest = decode_payload(body)?;
            QueryCommand::Explain {
                connection_id: request.connection_id,
                query: request.query,
                analyze: request.analyze,
                schema: request.schema,
            }
        }
        QueryRpcCommand::GetServerNow => {
            let request: ConnectionIdRequest = decode_payload(body)?;
            QueryCommand::GetServerNow {
                connection_id: request.connection_id,
            }
        }
    })
}

fn decode_metadata_command(
    command: MetadataRpcCommand,
    body: &[u8],
) -> Result<MetadataCommand, String> {
    Ok(match command {
        MetadataRpcCommand::GetAvailableDatabases => {
            let request: ConnectionIdRequest = decode_payload(body)?;
            MetadataCommand::GetAvailableDatabases {
                connection_id: request.connection_id,
            }
        }
        MetadataRpcCommand::GetSchemas => {
            let request: ConnectionIdRequest = decode_payload(body)?;
            MetadataCommand::GetSchemas {
                connection_id: request.connection_id,
            }
        }
        MetadataRpcCommand::GetTables => {
            let request: MetadataRequest = decode_payload(body)?;
            MetadataCommand::GetTables {
                connection_id: request.connection_id,
                schema: request.schema,
            }
        }
        MetadataRpcCommand::GetColumns => {
            let request: TableMetadataRequest = decode_payload(body)?;
            MetadataCommand::GetColumns {
                connection_id: request.connection_id,
                table_name: request.table_name,
                schema: request.schema,
            }
        }
        MetadataRpcCommand::GetForeignKeys => {
            let request: TableMetadataRequest = decode_payload(body)?;
            MetadataCommand::GetForeignKeys {
                connection_id: request.connection_id,
                table_name: request.table_name,
                schema: request.schema,
            }
        }
        MetadataRpcCommand::GetIndexes => {
            let request: TableMetadataRequest = decode_payload(body)?;
            MetadataCommand::GetIndexes {
                connection_id: request.connection_id,
                table_name: request.table_name,
                schema: request.schema,
            }
        }
        MetadataRpcCommand::GetViews => {
            let request: MetadataRequest = decode_payload(body)?;
            MetadataCommand::GetViews {
                connection_id: request.connection_id,
                schema: request.schema,
            }
        }
        MetadataRpcCommand::GetViewColumns => {
            let request: ViewMetadataRequest = decode_payload(body)?;
            MetadataCommand::GetViewColumns {
                connection_id: request.connection_id,
                view_name: request.view_name,
                schema: request.schema,
            }
        }
        MetadataRpcCommand::GetMaterializedViews => {
            let request: MetadataRequest = decode_payload(body)?;
            MetadataCommand::GetMaterializedViews {
                connection_id: request.connection_id,
                schema: request.schema,
            }
        }
        MetadataRpcCommand::GetMaterializedViewColumns => {
            let request: ViewMetadataRequest = decode_payload(body)?;
            MetadataCommand::GetMaterializedViewColumns {
                connection_id: request.connection_id,
                view_name: request.view_name,
                schema: request.schema,
            }
        }
        MetadataRpcCommand::GetMaterializedViewDefinition => {
            let request: ViewMetadataRequest = decode_payload(body)?;
            MetadataCommand::GetMaterializedViewDefinition {
                connection_id: request.connection_id,
                view_name: request.view_name,
                schema: request.schema,
            }
        }
        MetadataRpcCommand::GetRoutines => {
            let request: MetadataRequest = decode_payload(body)?;
            MetadataCommand::GetRoutines {
                connection_id: request.connection_id,
                schema: request.schema,
            }
        }
        MetadataRpcCommand::GetTriggers => {
            let request: MetadataRequest = decode_payload(body)?;
            MetadataCommand::GetTriggers {
                connection_id: request.connection_id,
                schema: request.schema,
            }
        }
        MetadataRpcCommand::GetSchemaSnapshot => {
            let request: MetadataRequest = decode_payload(body)?;
            MetadataCommand::GetSchemaSnapshot {
                connection_id: request.connection_id,
                schema: request.schema,
            }
        }
        MetadataRpcCommand::GetSelectedSchemas => {
            let request: ConnectionIdRequest = decode_payload(body)?;
            MetadataCommand::GetSelectedSchemas {
                connection_id: request.connection_id,
            }
        }
        MetadataRpcCommand::SetSelectedSchemas => {
            let request: SetSelectedSchemasRequest = decode_payload(body)?;
            MetadataCommand::SetSelectedSchemas {
                connection_id: request.connection_id,
                schemas: request.schemas,
            }
        }
        MetadataRpcCommand::GetSchemaPreference => {
            let request: ConnectionIdRequest = decode_payload(body)?;
            MetadataCommand::GetSchemaPreference {
                connection_id: request.connection_id,
            }
        }
        MetadataRpcCommand::SetSchemaPreference => {
            let request: SetSchemaPreferenceRequest = decode_payload(body)?;
            MetadataCommand::SetSchemaPreference {
                connection_id: request.connection_id,
                schema: request.schema,
            }
        }
    })
}

fn decode_tunnel_command(command: TunnelRpcCommand, body: &[u8]) -> Result<TunnelCommand, String> {
    Ok(match command {
        TunnelRpcCommand::GetSshConnections => {
            decode_empty_payload(body)?;
            TunnelCommand::GetSshConnections
        }
        TunnelRpcCommand::SaveSshConnection => {
            let request: SaveSshRequest = decode_payload(body)?;
            TunnelCommand::SaveSshConnection {
                name: request.name,
                ssh: request.ssh,
            }
        }
        TunnelRpcCommand::UpdateSshConnection => {
            let request: UpdateSshRequest = decode_payload(body)?;
            TunnelCommand::UpdateSshConnection {
                id: request.id,
                name: request.name,
                ssh: request.ssh,
            }
        }
        TunnelRpcCommand::DeleteSshConnection => {
            let request: IdRequest = decode_payload(body)?;
            TunnelCommand::DeleteSshConnection { id: request.id }
        }
        TunnelRpcCommand::TestSshConnection => {
            let request: TestSshRequest = decode_payload(body)?;
            TunnelCommand::TestSshConnection { ssh: request.ssh }
        }
        TunnelRpcCommand::RespondSshAskpass => {
            let request: AskpassResponseRequest = decode_payload(body)?;
            TunnelCommand::RespondSshAskpass {
                id: request.id,
                response: request.response,
            }
        }
        TunnelRpcCommand::GetK8sConnections => {
            decode_empty_payload(body)?;
            TunnelCommand::GetK8sConnections
        }
        TunnelRpcCommand::SaveK8sConnection => {
            let request: SaveK8sRequest = decode_payload(body)?;
            TunnelCommand::SaveK8sConnection { k8s: request.k8s }
        }
        TunnelRpcCommand::UpdateK8sConnection => {
            let request: UpdateK8sRequest = decode_payload(body)?;
            TunnelCommand::UpdateK8sConnection {
                id: request.id,
                k8s: request.k8s,
            }
        }
        TunnelRpcCommand::DeleteK8sConnection => {
            let request: IdRequest = decode_payload(body)?;
            TunnelCommand::DeleteK8sConnection { id: request.id }
        }
        TunnelRpcCommand::TestK8sConnection => {
            let request: TestK8sRequest = decode_payload(body)?;
            TunnelCommand::TestK8sConnection {
                context: request.context,
                namespace: request.namespace,
                options: k8s_options(request.kubectl_path, request.kubeconfig_path),
            }
        }
        TunnelRpcCommand::GetK8sContexts => {
            let request: K8sOptionsRequest = decode_optional_payload(body)?;
            TunnelCommand::GetK8sContexts {
                options: k8s_options(request.kubectl_path, request.kubeconfig_path),
            }
        }
        TunnelRpcCommand::GetK8sNamespaces => {
            let request: K8sContextRequest = decode_payload(body)?;
            TunnelCommand::GetK8sNamespaces {
                context: request.context,
                options: k8s_options(request.kubectl_path, request.kubeconfig_path),
            }
        }
        TunnelRpcCommand::GetK8sResources => {
            let request: K8sResourcesRequest = decode_payload(body)?;
            TunnelCommand::GetK8sResources {
                context: request.context,
                namespace: request.namespace,
                resource_type: request.resource_type,
                options: k8s_options(request.kubectl_path, request.kubeconfig_path),
            }
        }
        TunnelRpcCommand::GetK8sResourcePorts => {
            let request: K8sPortsRequest = decode_payload(body)?;
            TunnelCommand::GetK8sResourcePorts {
                context: request.context,
                namespace: request.namespace,
                resource_type: request.resource_type,
                resource_name: request.resource_name,
                options: k8s_options(request.kubectl_path, request.kubeconfig_path),
            }
        }
        TunnelRpcCommand::ValidateK8sPath => {
            let request: ValidateK8sPathRequest = decode_payload(body)?;
            TunnelCommand::ValidateK8sPath {
                path: request.path,
                kind: request.kind,
            }
        }
    })
}

fn k8s_options(
    kubectl_path: Option<String>,
    kubeconfig_path: Option<String>,
) -> crate::k8s_tunnel::K8sCommandOptions {
    crate::k8s_tunnel::K8sCommandOptions::new(kubectl_path, kubeconfig_path)
}

fn decode_optional_payload<T: for<'de> Deserialize<'de> + Default>(
    body: &[u8],
) -> Result<T, String> {
    if body.is_empty() {
        return Ok(T::default());
    }
    let value: Value = decode_payload(body)?;
    if value.is_null() {
        Ok(T::default())
    } else {
        serde_json::from_value(value).map_err(|error| format!("Invalid command payload: {error}"))
    }
}

fn decode_connection_command(
    command: ConnectionRpcCommand,
    session_id: Option<uuid::Uuid>,
    body: &[u8],
) -> Result<ConnectionCommand, String> {
    Ok(match command {
        ConnectionRpcCommand::GetConnectionById => {
            let request: IdRequest = decode_payload(body)?;
            ConnectionCommand::GetConnectionById { id: request.id }
        }
        ConnectionRpcCommand::GetConnectionsWithGroups => {
            decode_empty_payload(body)?;
            ConnectionCommand::GetConnectionsWithGroups
        }
        ConnectionRpcCommand::SaveConnection => {
            let request: SaveConnectionRequest = decode_payload(body)?;
            ConnectionCommand::SaveConnection {
                name: request.name,
                params: request.params,
                detect_json_in_text_columns: request.detect_json_in_text_columns,
                environment: request.environment,
            }
        }
        ConnectionRpcCommand::UpdateConnection => {
            let request: UpdateConnectionRequest = decode_payload(body)?;
            ConnectionCommand::UpdateConnection {
                id: request.id,
                name: request.name,
                params: request.params,
                detect_json_in_text_columns: request.detect_json_in_text_columns,
                environment: request.environment,
            }
        }
        ConnectionRpcCommand::DeleteConnection => {
            let request: IdRequest = decode_payload(body)?;
            ConnectionCommand::DeleteConnection { id: request.id }
        }
        ConnectionRpcCommand::DuplicateConnection => {
            let request: IdRequest = decode_payload(body)?;
            ConnectionCommand::DuplicateConnection { id: request.id }
        }
        ConnectionRpcCommand::SetConnectionAppearance => {
            let request: AppearanceRequest = decode_payload(body)?;
            ConnectionCommand::SetConnectionAppearance {
                id: request.id,
                appearance: request.appearance,
            }
        }
        ConnectionRpcCommand::SaveConnectionIcon => {
            let request: SaveIconRequest = decode_payload(body)?;
            ConnectionCommand::SaveConnectionIcon {
                connection_id: request.connection_id,
                upload_token: request.upload_token,
                session_id: session_id
                    .ok_or_else(|| "An authenticated upload session is required".to_string())?,
            }
        }
        ConnectionRpcCommand::DeleteConnectionIcon => {
            let request: DeleteIconRequest = decode_payload(body)?;
            ConnectionCommand::DeleteConnectionIcon {
                relative_path: request.relative_path,
            }
        }
        ConnectionRpcCommand::GetConnectionGroups => {
            decode_empty_payload(body)?;
            ConnectionCommand::GetConnectionGroups
        }
        ConnectionRpcCommand::CreateConnectionGroup => {
            let request: CreateGroupRequest = decode_payload(body)?;
            ConnectionCommand::CreateConnectionGroup {
                name: request.name,
                parent_id: request.parent_id,
            }
        }
        ConnectionRpcCommand::CreateGroupPath => {
            let request: CreateGroupPathRequest = decode_payload(body)?;
            ConnectionCommand::CreateGroupPath {
                path: request.path,
                parent_id: request.parent_id,
            }
        }
        ConnectionRpcCommand::UpdateConnectionGroup => {
            let request: UpdateGroupRequest = decode_payload(body)?;
            ConnectionCommand::UpdateConnectionGroup {
                id: request.id,
                name: request.name,
                collapsed: request.collapsed,
                sort_order: request.sort_order,
            }
        }
        ConnectionRpcCommand::MoveGroupToParent => {
            let request: MoveGroupRequest = decode_payload(body)?;
            ConnectionCommand::MoveGroupToParent {
                id: request.id,
                parent_id: request.parent_id,
            }
        }
        ConnectionRpcCommand::DeleteConnectionGroup => {
            let request: IdRequest = decode_payload(body)?;
            ConnectionCommand::DeleteConnectionGroup { id: request.id }
        }
        ConnectionRpcCommand::MoveConnectionToGroup => {
            let request: MoveConnectionRequest = decode_payload(body)?;
            ConnectionCommand::MoveConnectionToGroup {
                connection_id: request.connection_id,
                group_id: request.group_id,
                sort_order: request.sort_order,
            }
        }
        ConnectionRpcCommand::ReorderGroups => {
            let request: ReorderGroupsRequest = decode_payload(body)?;
            ConnectionCommand::ReorderGroups {
                group_orders: request.group_orders,
            }
        }
        ConnectionRpcCommand::ReorderConnectionsInGroup => {
            let request: ReorderConnectionsRequest = decode_payload(body)?;
            ConnectionCommand::ReorderConnectionsInGroup {
                connection_orders: request.connection_orders,
            }
        }
        ConnectionRpcCommand::ListConnectionTags => {
            decode_empty_payload(body)?;
            ConnectionCommand::ListConnectionTags
        }
        ConnectionRpcCommand::CreateConnectionTag => {
            let request: CreateTagRequest = decode_payload(body)?;
            ConnectionCommand::CreateConnectionTag {
                name: request.name,
                color: request.color,
            }
        }
        ConnectionRpcCommand::UpdateConnectionTag => {
            let request: TagMutationRequest = decode_payload(body)?;
            ConnectionCommand::UpdateConnectionTag {
                id: request.id,
                name: request.name,
                color: request.color,
            }
        }
        ConnectionRpcCommand::DeleteConnectionTag => {
            let request: IdRequest = decode_payload(body)?;
            ConnectionCommand::DeleteConnectionTag { id: request.id }
        }
        ConnectionRpcCommand::SetConnectionTags => {
            let request: SetTagsRequest = decode_payload(body)?;
            ConnectionCommand::SetConnectionTags {
                connection_id: request.connection_id,
                tag_ids: request.tag_ids,
            }
        }
        ConnectionRpcCommand::GetRegisteredDrivers => {
            decode_empty_payload(body)?;
            ConnectionCommand::GetRegisteredDrivers
        }
        ConnectionRpcCommand::GetDriverManifest => {
            let request: DriverManifestRequest = decode_payload(body)?;
            ConnectionCommand::GetDriverManifest {
                driver_id: request.driver_id,
            }
        }
        ConnectionRpcCommand::GetActiveConnections => {
            decode_empty_payload(body)?;
            ConnectionCommand::GetActiveConnections
        }
        ConnectionRpcCommand::RegisterActiveConnection => {
            let request: ConnectionIdRequest = decode_payload(body)?;
            ConnectionCommand::RegisterActiveConnection {
                connection_id: request.connection_id,
            }
        }
        ConnectionRpcCommand::DisconnectConnection => {
            let request: ConnectionIdRequest = decode_payload(body)?;
            ConnectionCommand::DisconnectConnection {
                connection_id: request.connection_id,
            }
        }
        ConnectionRpcCommand::TestConnection => {
            let request: TestRequest = decode_payload(body)?;
            ConnectionCommand::TestConnection {
                request: request.request,
            }
        }
    })
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

fn validate_query_request_id(request_id: &str) -> Result<(), String> {
    if request_id.is_empty()
        || request_id.len() > MAX_CANCELLATION_ID_LENGTH
        || !request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err("The query request identifier has an invalid format".to_string());
    }
    Ok(())
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
