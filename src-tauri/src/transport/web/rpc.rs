use crate::application::{
    ai::AiCommand,
    connection_files::{ConnectionExportMode, ConnectionFilesCommand, ConnectionImportFile},
    connections::ConnectionCommand,
    database_objects::DatabaseObjectCommand,
    database_transfers::{DatabaseTransferCommand, DumpOptions},
    generic_exports::GenericExportCommand,
    mcp_host::McpHostCommand,
    metadata::MetadataCommand,
    notebooks::NotebookCommand,
    operations::{GetLogsRequest, OperationalCommand},
    persistence::PersistenceCommand,
    plugins::PluginCommand,
    productivity::ProductivityCommand,
    queries::QueryCommand,
    records::RecordCommand,
    tunnels::TunnelCommand,
    ApplicationApi, ApplicationError, ApplicationRequestContext, AuthorizationLevel,
};
use crate::models::{
    ColumnDefinition, ConnectionAppearance, ConnectionParams, K8sConnectionInput, RoutineCallArg,
    SshConnectionInput, SshTestParams, TestConnectionRequest,
};
use axum::body::Bytes;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

pub const RPC_DEADLINE_HEADER_NAME: &str = "x-tabularis-deadline-ms";
pub const RPC_CANCELLATION_HEADER_NAME: &str = "x-tabularis-cancellation-id";

const DEFAULT_DEADLINE: Duration = Duration::from_secs(30);
const MAX_DEADLINE: Duration = Duration::from_secs(6 * 60 * 60);
const MAX_CANCELLATION_ID_LENGTH: usize = 128;
const DEFAULT_MAX_CONCURRENT_RPC_REQUESTS: usize = 64;
const DEFAULT_MAX_CONCURRENT_RPC_REQUESTS_PER_SESSION: usize = 16;

#[derive(Clone)]
pub struct RpcDispatcher {
    application: Arc<dyn ApplicationApi>,
    active_cancellations: Arc<Mutex<HashSet<String>>>,
    access_policy: RpcAccessPolicy,
    concurrency: RpcConcurrency,
}

#[derive(Clone, Copy, Debug)]
struct RpcConcurrencyLimits {
    max_global: usize,
    max_per_session: usize,
}

impl Default for RpcConcurrencyLimits {
    fn default() -> Self {
        Self {
            max_global: DEFAULT_MAX_CONCURRENT_RPC_REQUESTS,
            max_per_session: DEFAULT_MAX_CONCURRENT_RPC_REQUESTS_PER_SESSION,
        }
    }
}

#[derive(Clone)]
struct RpcConcurrency {
    global: Arc<Semaphore>,
    sessions: Arc<Mutex<HashMap<uuid::Uuid, Weak<Semaphore>>>>,
    max_per_session: usize,
}

struct RpcConcurrencyPermit {
    _global: OwnedSemaphorePermit,
    _session: Option<OwnedSemaphorePermit>,
}

enum RpcAdmissionError {
    SessionBusy,
    ServerBusy,
}

impl RpcConcurrency {
    fn new(limits: RpcConcurrencyLimits) -> Self {
        assert!(limits.max_global > 0);
        assert!(limits.max_per_session > 0);
        Self {
            global: Arc::new(Semaphore::new(limits.max_global)),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            max_per_session: limits.max_per_session,
        }
    }

    fn try_acquire(
        &self,
        session_id: Option<uuid::Uuid>,
    ) -> Result<RpcConcurrencyPermit, RpcAdmissionError> {
        let session = session_id.map(|session_id| {
            let mut sessions = self
                .sessions
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            sessions.retain(|_, semaphore| semaphore.strong_count() > 0);
            if let Some(semaphore) = sessions.get(&session_id).and_then(Weak::upgrade) {
                semaphore
            } else {
                let semaphore = Arc::new(Semaphore::new(self.max_per_session));
                sessions.insert(session_id, Arc::downgrade(&semaphore));
                semaphore
            }
        });
        let session_permit = session
            .map(|semaphore| {
                semaphore
                    .try_acquire_owned()
                    .map_err(|_| RpcAdmissionError::SessionBusy)
            })
            .transpose()?;
        let global_permit = self
            .global
            .clone()
            .try_acquire_owned()
            .map_err(|_| RpcAdmissionError::ServerBusy)?;
        Ok(RpcConcurrencyPermit {
            _global: global_permit,
            _session: session_permit,
        })
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct RpcAccessPolicy {
    pub mcp_host_configuration: bool,
}

impl Default for RpcAccessPolicy {
    fn default() -> Self {
        Self {
            mcp_host_configuration: false,
        }
    }
}

#[derive(Clone, Debug)]
pub struct RequestId(pub String);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RpcCommand {
    IsDebugMode,
    GetConnections,
    CancelQuery,
    Connection(ConnectionRpcCommand),
    ConnectionFiles(ConnectionFilesRpcCommand),
    DatabaseTransfer(DatabaseTransferRpcCommand),
    GenericExport(GenericExportRpcCommand),
    Ai(AiRpcCommand),
    Metadata(MetadataRpcCommand),
    DatabaseObject(DatabaseObjectRpcCommand),
    Query(QueryRpcCommand),
    Record(RecordRpcCommand),
    Tunnel(TunnelRpcCommand),
    Persistence(PersistenceRpcCommand),
    Productivity(ProductivityRpcCommand),
    Notebook(NotebookRpcCommand),
    Plugin(PluginRpcCommand),
    Operational(OperationalRpcCommand),
    McpHost(McpHostRpcCommand),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum McpHostRpcCommand {
    GetStatus,
    InstallConfig,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OperationalRpcCommand {
    GetLogs,
    ClearLogs,
    GetLogSettings,
    SetLogEnabled,
    SetLogMaxSize,
    GetProcessList,
    GetSystemStats,
    GetTabularisChildren,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PluginRpcCommand {
    FetchRegistry,
    FetchPreview,
    FetchReadme,
    Install,
    CancelInstall,
    Uninstall,
    GetInstalled,
    Disable,
    Enable,
    GetManifest,
    GetStartupErrors,
    KillProcess,
    RestartProcess,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AiRpcCommand {
    SetKey,
    DeleteKey,
    CheckKey,
    CheckKeyStatus,
    GetModels,
    GenerateQuery,
    ExplainQuery,
    AnalyzeExplainPlan,
    GenerateCellName,
    GenerateTabRename,
    SuggestTableName,
    GetSchemaContext,
    GetActivity,
    GetSessions,
    GetSessionEvents,
    ClearActivity,
    ListPendingApprovals,
    DecidePendingApproval,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DatabaseTransferRpcCommand {
    Dump,
    CancelDump,
    Import,
    CancelImport,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum GenericExportRpcCommand {
    ExportQuery,
    CancelExport,
    ExportAiActivityJson,
    ExportAiActivityCsv,
    ExportAiSessionAsNotebook,
    ExportLogs,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ConnectionFilesRpcCommand {
    Export,
    ListImportSources,
    PreviewForeignImport,
    ApplyForeignImport,
    PreviewTabularisImport,
    ApplyPreparedTabularisImport,
    GetBackupStatus,
    SetBackupPassword,
    SetBackupTargetPassword,
    RunBackup,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum NotebookRpcCommand {
    Create,
    Save,
    Load,
    Delete,
    Rename,
    List,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ProductivityRpcCommand {
    GetSavedQueries,
    SaveQuery,
    UpdateSavedQuery,
    DeleteSavedQuery,
    GetQueryHistory,
    AddQueryHistoryEntry,
    DeleteQueryHistoryEntry,
    ClearQueryHistory,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PersistenceRpcCommand {
    GetConfig,
    SaveConfig,
    GetConfigJson,
    SaveConfigJson,
    GetKeybindings,
    SaveKeybindings,
    GetAllThemes,
    SaveCustomTheme,
    DeleteCustomTheme,
    GetPrompt(crate::application::persistence::PromptKind),
    SavePrompt(crate::application::persistence::PromptKind),
    ResetPrompt(crate::application::persistence::PromptKind),
    LoadEditorPreferences,
    SaveEditorPreferences,
    DeleteEditorPreferences,
    GetLastActiveConnection,
    SetLastActiveConnection,
    GetLastOpenConnections,
    SetLastOpenConnections,
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
enum RecordRpcCommand {
    Delete,
    Update,
    Insert,
    FetchBlob,
    DetectBlobMime,
    DetectMimeType,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DatabaseObjectRpcCommand {
    GetViewDefinition,
    CreateView,
    AlterView,
    DropView,
    RefreshMaterializedView,
    GetRoutineParameters,
    GetRoutineDefinition,
    BuildRoutineCallSql,
    GetRoutineCreateTemplate,
    GetRoutineEditScript,
    DropRoutine,
    GetTriggerDefinition,
    CreateTrigger,
    DropTrigger,
    GetCreateTableSql,
    GetAddColumnSql,
    GetAlterColumnSql,
    GetCreateIndexSql,
    GetCreateForeignKeySql,
    DropIndex,
    DropForeignKey,
    GetDbPrivilegeCatalog,
    GetDbUsers,
    GetDbUserGrants,
    GetDbUserPrivileges,
    CreateDbUser,
    DropDbUser,
    SetDbUserPassword,
    ApplyDbUserPrivileges,
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
#[serde(deny_unknown_fields)]
struct GetLogsRpcRequest {
    request: GetLogsRequest,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SetLogEnabledRequest {
    enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetLogMaxSizeRequest {
    max_size: usize,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AiProviderRequest {
    provider: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SetAiKeyRequest {
    provider: String,
    key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AiModelsRequest {
    #[serde(default)]
    force_refresh: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AiRequest<T> {
    req: T,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AiSchemaContextRequest {
    connection_id: String,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AiActivityRequest {
    filter: Option<crate::ai_activity::EventFilter>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AiSessionRequest {
    session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AiApprovalDecisionRequest {
    approval_id: String,
    decision: String,
    reason: Option<String>,
    edited_query: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExportConnectionsFileRequest {
    mode: ConnectionExportMode,
    password: Option<String>,
    connection_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PreviewConnectionImportRequest {
    source_id: String,
    include_passwords: bool,
    file: Option<ConnectionImportFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApplyConnectionImportRequest {
    source_id: String,
    resolutions: Vec<crate::connection_import::convert::ImportResolution>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PreviewTabularisImportRequest {
    file: ConnectionImportFile,
    password: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ApplyPreparedImportRequest {
    resolutions: Vec<crate::connection_import::convert::ImportResolution>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SetBackupPasswordRequest {
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetBackupTargetPasswordRequest {
    target_id: String,
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DumpDatabaseRequest {
    connection_id: String,
    options: DumpOptions,
    schema: Option<String>,
    database: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportDatabaseRequest {
    connection_id: String,
    upload_token: String,
    schema: Option<String>,
    database: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveConfigRequest {
    config: crate::config::AppConfig,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveConfigJsonRequest {
    json: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveKeybindingsRequest {
    keybindings: Value,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveThemeRequest {
    theme: crate::theme_models::Theme,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ThemeIdRequest {
    theme_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SavePromptRequest {
    prompt: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveEditorPreferencesRequest {
    connection_id: String,
    preferences: crate::preferences::EditorPreferences,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetLastActiveConnectionRequest {
    connection_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetLastOpenConnectionsRequest {
    connection_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IdRequest {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PluginIdRequest {
    plugin_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct McpClientRequest {
    client_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InstallPluginRequest {
    plugin_id: String,
    version: Option<String>,
    registry_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PluginPreviewRequest {
    slug: String,
    registry_url: Option<String>,
    version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PluginReadmeRequest {
    slug: String,
    locale: Option<String>,
    registry_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConnectionIdRequest {
    connection_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveQueryRequest {
    connection_id: String,
    name: String,
    sql: String,
    database: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateSavedQueryRequest {
    connection_id: String,
    id: String,
    name: String,
    sql: String,
    database: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConnectionItemRequest {
    connection_id: String,
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NotebookTargetRequest {
    connection_id: String,
    notebook_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NotebookContentRequest {
    connection_id: String,
    notebook_id: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RenameNotebookRequest {
    connection_id: String,
    notebook_id: String,
    title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AddQueryHistoryEntryRequest {
    connection_id: String,
    sql: String,
    executed_at: String,
    execution_time_ms: Option<f64>,
    status: QueryHistoryStatus,
    rows_affected: Option<i64>,
    error: Option<String>,
    database: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum QueryHistoryStatus {
    Success,
    Error,
}

impl QueryHistoryStatus {
    fn into_string(self) -> String {
        match self {
            Self::Success => "success",
            Self::Error => "error",
        }
        .to_string()
    }
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
struct ViewDefinitionRequest {
    connection_id: String,
    view_name: String,
    definition: String,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RoutineNameRequest {
    connection_id: String,
    routine_name: String,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RoutineTargetRequest {
    connection_id: String,
    routine_name: String,
    routine_type: String,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RoutineCallRequest {
    connection_id: String,
    routine_name: String,
    routine_type: String,
    args: Vec<RoutineCallArg>,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RoutineTemplateRequest {
    connection_id: String,
    routine_type: String,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TriggerTargetRequest {
    connection_id: String,
    trigger_name: String,
    table_name: String,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateTriggerRequest {
    connection_id: String,
    trigger_sql: String,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateTableSqlRequest {
    connection_id: String,
    table_name: String,
    columns: Vec<ColumnDefinition>,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AddColumnSqlRequest {
    connection_id: String,
    table: String,
    column: ColumnDefinition,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AlterColumnSqlRequest {
    connection_id: String,
    table: String,
    old_column: ColumnDefinition,
    new_column: ColumnDefinition,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateIndexSqlRequest {
    connection_id: String,
    table: String,
    index_name: String,
    columns: Vec<String>,
    is_unique: bool,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateForeignKeySqlRequest {
    connection_id: String,
    table: String,
    fk_name: String,
    column: String,
    ref_table: String,
    ref_column: String,
    on_delete: Option<String>,
    on_update: Option<String>,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DropIndexRequest {
    connection_id: String,
    table: String,
    index_name: String,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DropForeignKeyRequest {
    connection_id: String,
    table: String,
    fk_name: String,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DbUserTargetRequest {
    connection_id: String,
    user: String,
    host: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DbUserPasswordRequest {
    connection_id: String,
    user: String,
    host: String,
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApplyDbUserPrivilegesRequest {
    connection_id: String,
    user: String,
    host: String,
    database: Option<String>,
    table: Option<String>,
    privileges: Vec<String>,
    grant: bool,
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
struct QueryExportRequest {
    connection_id: String,
    query: String,
    format: String,
    csv_delimiter: Option<String>,
    database: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AiSessionExportRequest {
    session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecordIdentityRequest {
    connection_id: String,
    table: String,
    pk_map: std::collections::HashMap<String, Value>,
    schema: Option<String>,
    database: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateRecordRequest {
    connection_id: String,
    table: String,
    pk_map: std::collections::HashMap<String, Value>,
    col_name: String,
    new_val: Value,
    schema: Option<String>,
    database: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InsertRecordRequest {
    connection_id: String,
    table: String,
    data: std::collections::HashMap<String, Value>,
    schema: Option<String>,
    database: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BlobColumnRequest {
    connection_id: String,
    table: String,
    col_name: String,
    pk_map: std::collections::HashMap<String, Value>,
    schema: Option<String>,
    database: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DetectBlobMimeRequest {
    base64_data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DetectMimeTypeRequest {
    header_base64: String,
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
        Self::with_access_policy(application, RpcAccessPolicy::default())
    }

    pub(crate) fn with_access_policy(
        application: Arc<dyn ApplicationApi>,
        access_policy: RpcAccessPolicy,
    ) -> Self {
        Self::with_access_policy_and_limits(
            application,
            access_policy,
            RpcConcurrencyLimits::default(),
        )
    }

    fn with_access_policy_and_limits(
        application: Arc<dyn ApplicationApi>,
        access_policy: RpcAccessPolicy,
        concurrency_limits: RpcConcurrencyLimits,
    ) -> Self {
        Self {
            application,
            active_cancellations: Arc::new(Mutex::new(HashSet::new())),
            access_policy,
            concurrency: RpcConcurrency::new(concurrency_limits),
        }
    }

    pub fn clear_session(&self, session_id: uuid::Uuid) {
        self.application.clear_session(session_id);
    }

    pub async fn dispatch(
        &self,
        command_name: &str,
        request_id: RequestId,
        headers: &HeaderMap,
        body: Bytes,
        session_id: Option<uuid::Uuid>,
    ) -> Response {
        self.dispatch_authorized(
            command_name,
            request_id,
            headers,
            body,
            session_id,
            AuthorizationLevel::LocalAdmin,
        )
        .await
    }

    pub(crate) async fn dispatch_with_authorization(
        &self,
        command_name: &str,
        request_id: RequestId,
        headers: &HeaderMap,
        body: Bytes,
        session_id: Option<uuid::Uuid>,
        granted_authorization: AuthorizationLevel,
    ) -> Response {
        self.dispatch_authorized(
            command_name,
            request_id,
            headers,
            body,
            session_id,
            granted_authorization,
        )
        .await
    }

    async fn dispatch_authorized(
        &self,
        command_name: &str,
        request_id: RequestId,
        headers: &HeaderMap,
        body: Bytes,
        session_id: Option<uuid::Uuid>,
        granted_authorization: AuthorizationLevel,
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
        if matches!(command, RpcCommand::McpHost(_)) && !self.access_policy.mcp_host_configuration {
            return failure(
                StatusCode::FORBIDDEN,
                "MCP_HOST_CONFIGURATION_DISABLED",
                "MCP host configuration is disabled for this Web UI mode".to_string(),
                None,
                request_id.0,
            );
        }
        let metadata = command.metadata();
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
        let _concurrency_permit = match self.concurrency.try_acquire(session_id) {
            Ok(permit) => permit,
            Err(RpcAdmissionError::SessionBusy) => {
                return failure(
                    StatusCode::TOO_MANY_REQUESTS,
                    "SESSION_BUSY",
                    "The session has too many active RPC requests".to_string(),
                    None,
                    request_id.0,
                )
            }
            Err(RpcAdmissionError::ServerBusy) => {
                return failure(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "SERVER_BUSY",
                    "The server has too many active RPC requests".to_string(),
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
            RpcCommand::ConnectionFiles(command) => {
                let command = decode_connection_files_command(command, body)
                    .map_err(InvocationError::InvalidPayload)?;
                self.application
                    .execute_connection_files_command(context, command)
                    .await
                    .map_err(InvocationError::Application)
            }
            RpcCommand::DatabaseTransfer(command) => {
                let command = decode_database_transfer_command(command, body)
                    .map_err(InvocationError::InvalidPayload)?;
                self.application
                    .execute_database_transfer_command(context, command)
                    .await
                    .map_err(InvocationError::Application)
            }
            RpcCommand::GenericExport(command) => {
                let command = decode_generic_export_command(command, body)
                    .map_err(InvocationError::InvalidPayload)?;
                self.application
                    .execute_generic_export_command(context, command)
                    .await
                    .map_err(InvocationError::Application)
            }
            RpcCommand::Ai(command) => {
                let command =
                    decode_ai_command(command, body).map_err(InvocationError::InvalidPayload)?;
                self.application
                    .execute_ai_command(context, command)
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
            RpcCommand::Record(command) => {
                let command = decode_record_command(command, body)
                    .map_err(InvocationError::InvalidPayload)?;
                self.application
                    .execute_record_command(context, command)
                    .await
                    .map_err(InvocationError::Application)
            }
            RpcCommand::DatabaseObject(command) => {
                let command = decode_database_object_command(command, body)
                    .map_err(InvocationError::InvalidPayload)?;
                self.application
                    .execute_database_object_command(context, command)
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
            RpcCommand::Persistence(command) => {
                let command = decode_persistence_command(command, body)
                    .map_err(InvocationError::InvalidPayload)?;
                self.application
                    .execute_persistence_command(context, command)
                    .await
                    .map_err(InvocationError::Application)
            }
            RpcCommand::Productivity(command) => {
                let command = decode_productivity_command(command, body)
                    .map_err(InvocationError::InvalidPayload)?;
                self.application
                    .execute_productivity_command(context, command)
                    .await
                    .map_err(InvocationError::Application)
            }
            RpcCommand::Notebook(command) => {
                let command = decode_notebook_command(command, body)
                    .map_err(InvocationError::InvalidPayload)?;
                self.application
                    .execute_notebook_command(context, command)
                    .await
                    .map_err(InvocationError::Application)
            }
            RpcCommand::Plugin(command) => {
                let command = decode_plugin_command(command, body)
                    .map_err(InvocationError::InvalidPayload)?;
                self.application
                    .execute_plugin_command(context, command)
                    .await
                    .map_err(InvocationError::Application)
            }
            RpcCommand::Operational(command) => {
                let command = decode_operational_command(command, body)
                    .map_err(InvocationError::InvalidPayload)?;
                self.application
                    .execute_operational_command(context, command)
                    .await
                    .map_err(InvocationError::Application)
            }
            RpcCommand::McpHost(command) => {
                let command = decode_mcp_host_command(command, body)
                    .map_err(InvocationError::InvalidPayload)?;
                self.application
                    .execute_mcp_host_command(context, command)
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
                .or_else(|| RecordRpcCommand::parse(name).map(Self::Record))
                .or_else(|| TunnelRpcCommand::parse(name).map(Self::Tunnel))
                .or_else(|| DatabaseObjectRpcCommand::parse(name).map(Self::DatabaseObject))
                .or_else(|| MetadataRpcCommand::parse(name).map(Self::Metadata))
                .or_else(|| ConnectionRpcCommand::parse(name).map(Self::Connection))
                .or_else(|| ConnectionFilesRpcCommand::parse(name).map(Self::ConnectionFiles))
                .or_else(|| DatabaseTransferRpcCommand::parse(name).map(Self::DatabaseTransfer))
                .or_else(|| GenericExportRpcCommand::parse(name).map(Self::GenericExport))
                .or_else(|| AiRpcCommand::parse(name).map(Self::Ai))
                .or_else(|| PersistenceRpcCommand::parse(name).map(Self::Persistence))
                .or_else(|| ProductivityRpcCommand::parse(name).map(Self::Productivity))
                .or_else(|| NotebookRpcCommand::parse(name).map(Self::Notebook))
                .or_else(|| PluginRpcCommand::parse(name).map(Self::Plugin))
                .or_else(|| OperationalRpcCommand::parse(name).map(Self::Operational))
                .or_else(|| McpHostRpcCommand::parse(name).map(Self::McpHost)),
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
            Self::ConnectionFiles(command) => CommandMetadata {
                authorization: command.authorization(),
                application_error_code: "CONNECTION_FILE_COMMAND_FAILED",
                application_error_status: StatusCode::CONFLICT,
            },
            Self::DatabaseTransfer(_) => CommandMetadata {
                authorization: AuthorizationLevel::Sensitive,
                application_error_code: "DATABASE_TRANSFER_FAILED",
                application_error_status: StatusCode::CONFLICT,
            },
            Self::GenericExport(command) => CommandMetadata {
                authorization: command.authorization(),
                application_error_code: "EXPORT_FAILED",
                application_error_status: StatusCode::CONFLICT,
            },
            Self::Ai(command) => CommandMetadata {
                authorization: if command == AiRpcCommand::GetSchemaContext {
                    AuthorizationLevel::Database
                } else {
                    AuthorizationLevel::Sensitive
                },
                application_error_code: "AI_COMMAND_FAILED",
                application_error_status: StatusCode::CONFLICT,
            },
            Self::Metadata(_) => CommandMetadata {
                authorization: AuthorizationLevel::Database,
                application_error_code: "METADATA_COMMAND_FAILED",
                application_error_status: StatusCode::CONFLICT,
            },
            Self::Record(command) => CommandMetadata {
                authorization: if matches!(
                    command,
                    RecordRpcCommand::DetectBlobMime | RecordRpcCommand::DetectMimeType
                ) {
                    AuthorizationLevel::Sensitive
                } else {
                    AuthorizationLevel::Database
                },
                application_error_code: "RECORD_COMMAND_FAILED",
                application_error_status: StatusCode::CONFLICT,
            },
            Self::DatabaseObject(command) => CommandMetadata {
                authorization: if command.requires_sensitive_authorization() {
                    AuthorizationLevel::Sensitive
                } else {
                    AuthorizationLevel::Database
                },
                application_error_code: "DATABASE_OBJECT_COMMAND_FAILED",
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
            Self::Persistence(command) => CommandMetadata {
                authorization: command.authorization(),
                application_error_code: "PREFERENCE_COMMAND_FAILED",
                application_error_status: StatusCode::CONFLICT,
            },
            Self::Productivity(_) => CommandMetadata {
                authorization: AuthorizationLevel::Database,
                application_error_code: "PRODUCTIVITY_COMMAND_FAILED",
                application_error_status: StatusCode::CONFLICT,
            },
            Self::Notebook(_) => CommandMetadata {
                authorization: AuthorizationLevel::Database,
                application_error_code: "NOTEBOOK_COMMAND_FAILED",
                application_error_status: StatusCode::CONFLICT,
            },
            Self::Plugin(_) => CommandMetadata {
                authorization: AuthorizationLevel::LocalAdmin,
                application_error_code: "PLUGIN_COMMAND_FAILED",
                application_error_status: StatusCode::CONFLICT,
            },
            Self::Operational(command) => CommandMetadata {
                authorization: command.authorization(),
                application_error_code: "OPERATIONAL_COMMAND_FAILED",
                application_error_status: StatusCode::CONFLICT,
            },
            Self::McpHost(_) => CommandMetadata {
                authorization: AuthorizationLevel::LocalAdmin,
                application_error_code: "MCP_HOST_CONFIGURATION_FAILED",
                application_error_status: StatusCode::CONFLICT,
            },
        }
    }
}

impl McpHostRpcCommand {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "get_mcp_status" => Self::GetStatus,
            "install_mcp_config" => Self::InstallConfig,
            _ => return None,
        })
    }
}

impl OperationalRpcCommand {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "get_logs" => Self::GetLogs,
            "clear_logs" => Self::ClearLogs,
            "get_log_settings" => Self::GetLogSettings,
            "set_log_enabled" => Self::SetLogEnabled,
            "set_log_max_size" => Self::SetLogMaxSize,
            "get_process_list" => Self::GetProcessList,
            "get_system_stats" => Self::GetSystemStats,
            "get_tabularis_children" => Self::GetTabularisChildren,
            _ => return None,
        })
    }

    fn authorization(self) -> AuthorizationLevel {
        match self {
            Self::GetLogs
            | Self::GetLogSettings
            | Self::GetProcessList
            | Self::GetSystemStats
            | Self::GetTabularisChildren => AuthorizationLevel::Sensitive,
            Self::ClearLogs | Self::SetLogEnabled | Self::SetLogMaxSize => {
                AuthorizationLevel::LocalAdmin
            }
        }
    }
}

impl PluginRpcCommand {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "fetch_plugin_registry" => Self::FetchRegistry,
            "fetch_tabularium_plugin_preview" => Self::FetchPreview,
            "fetch_plugin_readme" => Self::FetchReadme,
            "install_plugin" => Self::Install,
            "cancel_plugin_install" => Self::CancelInstall,
            "uninstall_plugin" => Self::Uninstall,
            "get_installed_plugins" => Self::GetInstalled,
            "disable_plugin" => Self::Disable,
            "enable_plugin" => Self::Enable,
            "get_plugin_manifest" => Self::GetManifest,
            "get_plugin_startup_errors" => Self::GetStartupErrors,
            "kill_plugin_process" => Self::KillProcess,
            "restart_plugin_process" => Self::RestartProcess,
            _ => return None,
        })
    }
}

impl AiRpcCommand {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "set_ai_key" => Self::SetKey,
            "delete_ai_key" => Self::DeleteKey,
            "check_ai_key" => Self::CheckKey,
            "check_ai_key_status" => Self::CheckKeyStatus,
            "get_ai_models" => Self::GetModels,
            "generate_ai_query" => Self::GenerateQuery,
            "explain_ai_query" => Self::ExplainQuery,
            "analyze_ai_explain_plan" => Self::AnalyzeExplainPlan,
            "generate_cell_name" => Self::GenerateCellName,
            "generate_tab_rename" => Self::GenerateTabRename,
            "suggest_table_name" => Self::SuggestTableName,
            "get_ai_schema_context" => Self::GetSchemaContext,
            "get_ai_activity" => Self::GetActivity,
            "get_ai_sessions" => Self::GetSessions,
            "get_ai_session_events" => Self::GetSessionEvents,
            "clear_ai_activity" => Self::ClearActivity,
            "list_pending_approvals" => Self::ListPendingApprovals,
            "decide_pending_approval" => Self::DecidePendingApproval,
            _ => return None,
        })
    }
}

impl DatabaseTransferRpcCommand {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "dump_database" => Self::Dump,
            "cancel_dump" => Self::CancelDump,
            "import_database" => Self::Import,
            "cancel_import" => Self::CancelImport,
            _ => return None,
        })
    }
}

impl GenericExportRpcCommand {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "export_query_to_file" => Self::ExportQuery,
            "cancel_export" => Self::CancelExport,
            "export_ai_activity_json" => Self::ExportAiActivityJson,
            "export_ai_activity_csv" => Self::ExportAiActivityCsv,
            "export_ai_session_as_notebook" => Self::ExportAiSessionAsNotebook,
            "export_logs" => Self::ExportLogs,
            _ => return None,
        })
    }

    fn authorization(self) -> AuthorizationLevel {
        match self {
            Self::ExportQuery | Self::CancelExport => AuthorizationLevel::Database,
            Self::ExportAiActivityJson
            | Self::ExportAiActivityCsv
            | Self::ExportAiSessionAsNotebook
            | Self::ExportLogs => AuthorizationLevel::Sensitive,
        }
    }
}

impl ConnectionFilesRpcCommand {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "export_connections_file" => Self::Export,
            "list_connection_import_sources" => Self::ListImportSources,
            "preview_connection_import" => Self::PreviewForeignImport,
            "apply_connection_import" => Self::ApplyForeignImport,
            "preview_tabularis_import_file" => Self::PreviewTabularisImport,
            "apply_prepared_tabularis_import" => Self::ApplyPreparedTabularisImport,
            "get_connections_backup_status" => Self::GetBackupStatus,
            "set_connections_backup_password" => Self::SetBackupPassword,
            "set_connections_backup_target_password" => Self::SetBackupTargetPassword,
            "run_connections_backup" => Self::RunBackup,
            _ => return None,
        })
    }

    fn authorization(self) -> AuthorizationLevel {
        match self {
            Self::ListImportSources
            | Self::PreviewForeignImport
            | Self::ApplyForeignImport
            | Self::GetBackupStatus => AuthorizationLevel::LocalAdmin,
            Self::Export
            | Self::PreviewTabularisImport
            | Self::ApplyPreparedTabularisImport
            | Self::SetBackupPassword
            | Self::SetBackupTargetPassword
            | Self::RunBackup => AuthorizationLevel::Sensitive,
        }
    }
}

impl NotebookRpcCommand {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "create_notebook" => Self::Create,
            "save_notebook" => Self::Save,
            "load_notebook" => Self::Load,
            "delete_notebook" => Self::Delete,
            "rename_notebook" => Self::Rename,
            "list_notebooks" => Self::List,
            _ => return None,
        })
    }
}

impl ProductivityRpcCommand {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "get_saved_queries" => Self::GetSavedQueries,
            "save_query" => Self::SaveQuery,
            "update_saved_query" => Self::UpdateSavedQuery,
            "delete_saved_query" => Self::DeleteSavedQuery,
            "get_query_history" => Self::GetQueryHistory,
            "add_query_history_entry" => Self::AddQueryHistoryEntry,
            "delete_query_history_entry" => Self::DeleteQueryHistoryEntry,
            "clear_query_history" => Self::ClearQueryHistory,
            _ => return None,
        })
    }
}

impl PersistenceRpcCommand {
    fn parse(name: &str) -> Option<Self> {
        use crate::application::persistence::PromptKind;
        Some(match name {
            "get_config" => Self::GetConfig,
            "save_config" => Self::SaveConfig,
            "get_config_json" => Self::GetConfigJson,
            "save_config_json" => Self::SaveConfigJson,
            "get_keybindings" => Self::GetKeybindings,
            "save_keybindings" => Self::SaveKeybindings,
            "get_all_themes" => Self::GetAllThemes,
            "save_custom_theme" => Self::SaveCustomTheme,
            "delete_custom_theme" => Self::DeleteCustomTheme,
            "get_system_prompt" => Self::GetPrompt(PromptKind::System),
            "save_system_prompt" => Self::SavePrompt(PromptKind::System),
            "reset_system_prompt" => Self::ResetPrompt(PromptKind::System),
            "get_explain_prompt" => Self::GetPrompt(PromptKind::Explain),
            "save_explain_prompt" => Self::SavePrompt(PromptKind::Explain),
            "reset_explain_prompt" => Self::ResetPrompt(PromptKind::Explain),
            "get_explainplan_prompt" => Self::GetPrompt(PromptKind::ExplainPlan),
            "save_explainplan_prompt" => Self::SavePrompt(PromptKind::ExplainPlan),
            "reset_explainplan_prompt" => Self::ResetPrompt(PromptKind::ExplainPlan),
            "get_cellname_prompt" => Self::GetPrompt(PromptKind::CellName),
            "save_cellname_prompt" => Self::SavePrompt(PromptKind::CellName),
            "reset_cellname_prompt" => Self::ResetPrompt(PromptKind::CellName),
            "get_tabrename_prompt" => Self::GetPrompt(PromptKind::TabRename),
            "save_tabrename_prompt" => Self::SavePrompt(PromptKind::TabRename),
            "reset_tabrename_prompt" => Self::ResetPrompt(PromptKind::TabRename),
            "load_editor_preferences" => Self::LoadEditorPreferences,
            "save_editor_preferences" => Self::SaveEditorPreferences,
            "delete_editor_preferences" => Self::DeleteEditorPreferences,
            "get_last_active_connection" => Self::GetLastActiveConnection,
            "set_last_active_connection" => Self::SetLastActiveConnection,
            "get_last_open_connections" => Self::GetLastOpenConnections,
            "set_last_open_connections" => Self::SetLastOpenConnections,
            _ => return None,
        })
    }

    fn authorization(self) -> AuthorizationLevel {
        match self {
            Self::LoadEditorPreferences
            | Self::SaveEditorPreferences
            | Self::DeleteEditorPreferences => AuthorizationLevel::Database,
            Self::GetLastActiveConnection
            | Self::SetLastActiveConnection
            | Self::GetLastOpenConnections
            | Self::SetLastOpenConnections => AuthorizationLevel::Session,
            _ => AuthorizationLevel::LocalAdmin,
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

impl RecordRpcCommand {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "delete_record" => Self::Delete,
            "update_record" => Self::Update,
            "insert_record" => Self::Insert,
            "fetch_blob" => Self::FetchBlob,
            "detect_blob_mime" => Self::DetectBlobMime,
            "detect_mime_type" => Self::DetectMimeType,
            _ => return None,
        })
    }
}

impl DatabaseObjectRpcCommand {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "get_view_definition" => Self::GetViewDefinition,
            "create_view" => Self::CreateView,
            "alter_view" => Self::AlterView,
            "drop_view" => Self::DropView,
            "refresh_materialized_view" => Self::RefreshMaterializedView,
            "get_routine_parameters" => Self::GetRoutineParameters,
            "get_routine_definition" => Self::GetRoutineDefinition,
            "build_routine_call_sql" => Self::BuildRoutineCallSql,
            "get_routine_create_template" => Self::GetRoutineCreateTemplate,
            "get_routine_edit_script" => Self::GetRoutineEditScript,
            "drop_routine" => Self::DropRoutine,
            "get_trigger_definition" => Self::GetTriggerDefinition,
            "create_trigger" => Self::CreateTrigger,
            "drop_trigger" => Self::DropTrigger,
            "get_create_table_sql" => Self::GetCreateTableSql,
            "get_add_column_sql" => Self::GetAddColumnSql,
            "get_alter_column_sql" => Self::GetAlterColumnSql,
            "get_create_index_sql" => Self::GetCreateIndexSql,
            "get_create_foreign_key_sql" => Self::GetCreateForeignKeySql,
            "drop_index_action" => Self::DropIndex,
            "drop_foreign_key_action" => Self::DropForeignKey,
            "get_db_privilege_catalog" => Self::GetDbPrivilegeCatalog,
            "get_db_users" => Self::GetDbUsers,
            "get_db_user_grants" => Self::GetDbUserGrants,
            "get_db_user_privileges" => Self::GetDbUserPrivileges,
            "create_db_user" => Self::CreateDbUser,
            "drop_db_user" => Self::DropDbUser,
            "set_db_user_password" => Self::SetDbUserPassword,
            "apply_db_user_privileges" => Self::ApplyDbUserPrivileges,
            _ => return None,
        })
    }

    fn requires_sensitive_authorization(self) -> bool {
        matches!(
            self,
            Self::GetDbPrivilegeCatalog
                | Self::GetDbUsers
                | Self::GetDbUserGrants
                | Self::GetDbUserPrivileges
                | Self::CreateDbUser
                | Self::DropDbUser
                | Self::SetDbUserPassword
                | Self::ApplyDbUserPrivileges
        )
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

fn decode_ai_command(command: AiRpcCommand, body: &[u8]) -> Result<AiCommand, String> {
    Ok(match command {
        AiRpcCommand::SetKey => {
            let request: SetAiKeyRequest = decode_payload(body)?;
            AiCommand::SetKey {
                provider: request.provider,
                key: request.key,
            }
        }
        AiRpcCommand::DeleteKey | AiRpcCommand::CheckKey | AiRpcCommand::CheckKeyStatus => {
            let request: AiProviderRequest = decode_payload(body)?;
            match command {
                AiRpcCommand::DeleteKey => AiCommand::DeleteKey {
                    provider: request.provider,
                },
                AiRpcCommand::CheckKey => AiCommand::CheckKey {
                    provider: request.provider,
                },
                AiRpcCommand::CheckKeyStatus => AiCommand::CheckKeyStatus {
                    provider: request.provider,
                },
                _ => unreachable!(),
            }
        }
        AiRpcCommand::GetModels => {
            let request: Option<AiModelsRequest> = decode_payload(body)?;
            AiCommand::GetModels {
                force_refresh: request.is_some_and(|request| request.force_refresh),
            }
        }
        AiRpcCommand::GenerateQuery => {
            let request: AiRequest<crate::ai::AiGenerateRequest> = decode_payload(body)?;
            AiCommand::GenerateQuery(request.req)
        }
        AiRpcCommand::ExplainQuery => {
            let request: AiRequest<crate::ai::AiExplainRequest> = decode_payload(body)?;
            AiCommand::ExplainQuery(request.req)
        }
        AiRpcCommand::AnalyzeExplainPlan => {
            let request: AiRequest<crate::ai::AiExplainRequest> = decode_payload(body)?;
            AiCommand::AnalyzeExplainPlan(request.req)
        }
        AiRpcCommand::GenerateCellName => {
            let request: AiRequest<crate::ai::AiCellNameRequest> = decode_payload(body)?;
            AiCommand::GenerateCellName(request.req)
        }
        AiRpcCommand::GenerateTabRename => {
            let request: AiRequest<crate::ai::AiTabRenameRequest> = decode_payload(body)?;
            AiCommand::GenerateTabRename(request.req)
        }
        AiRpcCommand::SuggestTableName => {
            let request: AiRequest<crate::ai::AiSuggestTableNameRequest> = decode_payload(body)?;
            AiCommand::SuggestTableName(request.req)
        }
        AiRpcCommand::GetSchemaContext => {
            let request: AiSchemaContextRequest = decode_payload(body)?;
            AiCommand::GetSchemaContext {
                connection_id: request.connection_id,
                schema: request.schema,
            }
        }
        AiRpcCommand::GetActivity => {
            let request: Option<AiActivityRequest> = decode_payload(body)?;
            AiCommand::GetActivity {
                filter: request.and_then(|request| request.filter),
            }
        }
        AiRpcCommand::GetSessions => {
            decode_empty_payload(body)?;
            AiCommand::GetSessions
        }
        AiRpcCommand::GetSessionEvents => {
            let request: AiSessionRequest = decode_payload(body)?;
            AiCommand::GetSessionEvents {
                session_id: request.session_id,
            }
        }
        AiRpcCommand::ClearActivity => {
            decode_empty_payload(body)?;
            AiCommand::ClearActivity
        }
        AiRpcCommand::ListPendingApprovals => {
            decode_empty_payload(body)?;
            AiCommand::ListPendingApprovals
        }
        AiRpcCommand::DecidePendingApproval => {
            let request: AiApprovalDecisionRequest = decode_payload(body)?;
            AiCommand::DecidePendingApproval {
                approval_id: request.approval_id,
                decision: request.decision,
                reason: request.reason,
                edited_query: request.edited_query,
            }
        }
    })
}

fn decode_database_transfer_command(
    command: DatabaseTransferRpcCommand,
    body: &[u8],
) -> Result<DatabaseTransferCommand, String> {
    Ok(match command {
        DatabaseTransferRpcCommand::Dump => {
            let request: DumpDatabaseRequest = decode_payload(body)?;
            DatabaseTransferCommand::Dump {
                connection_id: request.connection_id,
                options: request.options,
                schema: request.schema,
                database: request.database,
            }
        }
        DatabaseTransferRpcCommand::CancelDump => {
            let request: ConnectionIdRequest = decode_payload(body)?;
            DatabaseTransferCommand::CancelDump {
                connection_id: request.connection_id,
            }
        }
        DatabaseTransferRpcCommand::Import => {
            let request: ImportDatabaseRequest = decode_payload(body)?;
            DatabaseTransferCommand::Import {
                connection_id: request.connection_id,
                upload_token: request.upload_token,
                schema: request.schema,
                database: request.database,
            }
        }
        DatabaseTransferRpcCommand::CancelImport => {
            let request: ConnectionIdRequest = decode_payload(body)?;
            DatabaseTransferCommand::CancelImport {
                connection_id: request.connection_id,
            }
        }
    })
}

fn decode_generic_export_command(
    command: GenericExportRpcCommand,
    body: &[u8],
) -> Result<GenericExportCommand, String> {
    Ok(match command {
        GenericExportRpcCommand::ExportQuery => {
            let request: QueryExportRequest = decode_payload(body)?;
            GenericExportCommand::ExportQuery {
                connection_id: request.connection_id,
                query: request.query,
                format: request.format,
                csv_delimiter: request.csv_delimiter,
                database: request.database,
            }
        }
        GenericExportRpcCommand::CancelExport => {
            let request: ConnectionIdRequest = decode_payload(body)?;
            GenericExportCommand::CancelExport {
                connection_id: request.connection_id,
            }
        }
        GenericExportRpcCommand::ExportAiActivityJson => {
            decode_empty_payload(body)?;
            GenericExportCommand::ExportAiActivityJson
        }
        GenericExportRpcCommand::ExportAiActivityCsv => {
            decode_empty_payload(body)?;
            GenericExportCommand::ExportAiActivityCsv
        }
        GenericExportRpcCommand::ExportAiSessionAsNotebook => {
            let request: AiSessionExportRequest = decode_payload(body)?;
            GenericExportCommand::ExportAiSessionAsNotebook {
                session_id: request.session_id,
            }
        }
        GenericExportRpcCommand::ExportLogs => {
            decode_empty_payload(body)?;
            GenericExportCommand::ExportLogs
        }
    })
}

fn decode_connection_files_command(
    command: ConnectionFilesRpcCommand,
    body: &[u8],
) -> Result<ConnectionFilesCommand, String> {
    Ok(match command {
        ConnectionFilesRpcCommand::Export => {
            let request: ExportConnectionsFileRequest = decode_payload(body)?;
            ConnectionFilesCommand::Export {
                mode: request.mode,
                password: request.password,
                connection_ids: request.connection_ids,
            }
        }
        ConnectionFilesRpcCommand::ListImportSources => {
            decode_empty_payload(body)?;
            ConnectionFilesCommand::ListImportSources
        }
        ConnectionFilesRpcCommand::PreviewForeignImport => {
            let request: PreviewConnectionImportRequest = decode_payload(body)?;
            ConnectionFilesCommand::PreviewForeignImport {
                source_id: request.source_id,
                include_passwords: request.include_passwords,
                file: request.file,
            }
        }
        ConnectionFilesRpcCommand::ApplyForeignImport => {
            let request: ApplyConnectionImportRequest = decode_payload(body)?;
            ConnectionFilesCommand::ApplyForeignImport {
                source_id: request.source_id,
                resolutions: request.resolutions,
            }
        }
        ConnectionFilesRpcCommand::PreviewTabularisImport => {
            let request: PreviewTabularisImportRequest = decode_payload(body)?;
            ConnectionFilesCommand::PreviewTabularisImport {
                file: request.file,
                password: request.password,
            }
        }
        ConnectionFilesRpcCommand::ApplyPreparedTabularisImport => {
            let request: ApplyPreparedImportRequest = decode_payload(body)?;
            ConnectionFilesCommand::ApplyPreparedTabularisImport {
                resolutions: request.resolutions,
            }
        }
        ConnectionFilesRpcCommand::GetBackupStatus => {
            decode_empty_payload(body)?;
            ConnectionFilesCommand::GetBackupStatus
        }
        ConnectionFilesRpcCommand::SetBackupPassword => {
            let request: SetBackupPasswordRequest = decode_payload(body)?;
            ConnectionFilesCommand::SetBackupPassword {
                password: request.password,
            }
        }
        ConnectionFilesRpcCommand::SetBackupTargetPassword => {
            let request: SetBackupTargetPasswordRequest = decode_payload(body)?;
            ConnectionFilesCommand::SetBackupTargetPassword {
                target_id: request.target_id,
                password: request.password,
            }
        }
        ConnectionFilesRpcCommand::RunBackup => {
            decode_empty_payload(body)?;
            ConnectionFilesCommand::RunBackup
        }
    })
}

fn decode_notebook_command(
    command: NotebookRpcCommand,
    body: &[u8],
) -> Result<NotebookCommand, String> {
    Ok(match command {
        NotebookRpcCommand::Create | NotebookRpcCommand::Save => {
            let request: NotebookContentRequest = decode_payload(body)?;
            if command == NotebookRpcCommand::Create {
                NotebookCommand::Create {
                    connection_id: request.connection_id,
                    notebook_id: request.notebook_id,
                    content: request.content,
                }
            } else {
                NotebookCommand::Save {
                    connection_id: request.connection_id,
                    notebook_id: request.notebook_id,
                    content: request.content,
                }
            }
        }
        NotebookRpcCommand::Load | NotebookRpcCommand::Delete => {
            let request: NotebookTargetRequest = decode_payload(body)?;
            if command == NotebookRpcCommand::Load {
                NotebookCommand::Load {
                    connection_id: request.connection_id,
                    notebook_id: request.notebook_id,
                }
            } else {
                NotebookCommand::Delete {
                    connection_id: request.connection_id,
                    notebook_id: request.notebook_id,
                }
            }
        }
        NotebookRpcCommand::Rename => {
            let request: RenameNotebookRequest = decode_payload(body)?;
            NotebookCommand::Rename {
                connection_id: request.connection_id,
                notebook_id: request.notebook_id,
                title: request.title,
            }
        }
        NotebookRpcCommand::List => {
            let request: ConnectionIdRequest = decode_payload(body)?;
            NotebookCommand::List {
                connection_id: request.connection_id,
            }
        }
    })
}

fn decode_operational_command(
    command: OperationalRpcCommand,
    body: &[u8],
) -> Result<OperationalCommand, String> {
    Ok(match command {
        OperationalRpcCommand::GetLogs => {
            let request: GetLogsRpcRequest = decode_payload(body)?;
            OperationalCommand::GetLogs(request.request)
        }
        OperationalRpcCommand::ClearLogs => {
            decode_empty_payload(body)?;
            OperationalCommand::ClearLogs
        }
        OperationalRpcCommand::GetLogSettings => {
            decode_empty_payload(body)?;
            OperationalCommand::GetLogSettings
        }
        OperationalRpcCommand::SetLogEnabled => {
            let request: SetLogEnabledRequest = decode_payload(body)?;
            OperationalCommand::SetLogEnabled {
                enabled: request.enabled,
            }
        }
        OperationalRpcCommand::SetLogMaxSize => {
            let request: SetLogMaxSizeRequest = decode_payload(body)?;
            OperationalCommand::SetLogMaxSize {
                max_size: request.max_size,
            }
        }
        OperationalRpcCommand::GetProcessList => {
            decode_empty_payload(body)?;
            OperationalCommand::GetProcessList
        }
        OperationalRpcCommand::GetSystemStats => {
            decode_empty_payload(body)?;
            OperationalCommand::GetSystemStats
        }
        OperationalRpcCommand::GetTabularisChildren => {
            decode_empty_payload(body)?;
            OperationalCommand::GetTabularisChildren
        }
    })
}

fn decode_mcp_host_command(
    command: McpHostRpcCommand,
    body: &[u8],
) -> Result<McpHostCommand, String> {
    Ok(match command {
        McpHostRpcCommand::GetStatus => {
            decode_empty_payload(body)?;
            McpHostCommand::GetStatus
        }
        McpHostRpcCommand::InstallConfig => {
            let request: McpClientRequest = decode_payload(body)?;
            McpHostCommand::InstallConfig {
                client_id: request.client_id,
            }
        }
    })
}

fn decode_plugin_command(command: PluginRpcCommand, body: &[u8]) -> Result<PluginCommand, String> {
    Ok(match command {
        PluginRpcCommand::FetchRegistry => {
            decode_empty_payload(body)?;
            PluginCommand::FetchRegistry
        }
        PluginRpcCommand::FetchPreview => {
            let request: PluginPreviewRequest = decode_payload(body)?;
            PluginCommand::FetchPreview {
                slug: request.slug,
                registry_url: request.registry_url,
                version: request.version,
            }
        }
        PluginRpcCommand::FetchReadme => {
            let request: PluginReadmeRequest = decode_payload(body)?;
            PluginCommand::FetchReadme {
                slug: request.slug,
                locale: request.locale,
                registry_url: request.registry_url,
            }
        }
        PluginRpcCommand::Install => {
            let request: InstallPluginRequest = decode_payload(body)?;
            PluginCommand::Install {
                plugin_id: request.plugin_id,
                version: request.version,
                registry_url: request.registry_url,
            }
        }
        PluginRpcCommand::CancelInstall => {
            let request: PluginIdRequest = decode_payload(body)?;
            PluginCommand::CancelInstall {
                plugin_id: request.plugin_id,
            }
        }
        PluginRpcCommand::Uninstall => {
            let request: PluginIdRequest = decode_payload(body)?;
            PluginCommand::Uninstall {
                plugin_id: request.plugin_id,
            }
        }
        PluginRpcCommand::GetInstalled => {
            decode_empty_payload(body)?;
            PluginCommand::GetInstalled
        }
        PluginRpcCommand::Disable => {
            let request: PluginIdRequest = decode_payload(body)?;
            PluginCommand::Disable {
                plugin_id: request.plugin_id,
            }
        }
        PluginRpcCommand::Enable => {
            let request: PluginIdRequest = decode_payload(body)?;
            PluginCommand::Enable {
                plugin_id: request.plugin_id,
            }
        }
        PluginRpcCommand::GetManifest => {
            let request: PluginIdRequest = decode_payload(body)?;
            PluginCommand::GetManifest {
                plugin_id: request.plugin_id,
            }
        }
        PluginRpcCommand::GetStartupErrors => {
            decode_empty_payload(body)?;
            PluginCommand::GetStartupErrors
        }
        PluginRpcCommand::KillProcess => {
            let request: PluginIdRequest = decode_payload(body)?;
            PluginCommand::KillProcess {
                plugin_id: request.plugin_id,
            }
        }
        PluginRpcCommand::RestartProcess => {
            let request: PluginIdRequest = decode_payload(body)?;
            PluginCommand::RestartProcess {
                plugin_id: request.plugin_id,
            }
        }
    })
}

fn decode_productivity_command(
    command: ProductivityRpcCommand,
    body: &[u8],
) -> Result<ProductivityCommand, String> {
    Ok(match command {
        ProductivityRpcCommand::GetSavedQueries => {
            let request: ConnectionIdRequest = decode_payload(body)?;
            ProductivityCommand::GetSavedQueries {
                connection_id: request.connection_id,
            }
        }
        ProductivityRpcCommand::SaveQuery => {
            let request: SaveQueryRequest = decode_payload(body)?;
            ProductivityCommand::SaveQuery {
                connection_id: request.connection_id,
                name: request.name,
                sql: request.sql,
                database: request.database,
            }
        }
        ProductivityRpcCommand::UpdateSavedQuery => {
            let request: UpdateSavedQueryRequest = decode_payload(body)?;
            ProductivityCommand::UpdateSavedQuery {
                connection_id: Some(request.connection_id),
                id: request.id,
                name: request.name,
                sql: request.sql,
                database: request.database,
            }
        }
        ProductivityRpcCommand::DeleteSavedQuery => {
            let request: ConnectionItemRequest = decode_payload(body)?;
            ProductivityCommand::DeleteSavedQuery {
                connection_id: Some(request.connection_id),
                id: request.id,
            }
        }
        ProductivityRpcCommand::GetQueryHistory => {
            let request: ConnectionIdRequest = decode_payload(body)?;
            ProductivityCommand::GetQueryHistory {
                connection_id: request.connection_id,
            }
        }
        ProductivityRpcCommand::AddQueryHistoryEntry => {
            let request: AddQueryHistoryEntryRequest = decode_payload(body)?;
            ProductivityCommand::AddQueryHistoryEntry {
                connection_id: request.connection_id,
                sql: request.sql,
                executed_at: request.executed_at,
                execution_time_ms: request.execution_time_ms,
                status: request.status.into_string(),
                rows_affected: request.rows_affected,
                error: request.error,
                database: request.database,
            }
        }
        ProductivityRpcCommand::DeleteQueryHistoryEntry => {
            let request: ConnectionItemRequest = decode_payload(body)?;
            ProductivityCommand::DeleteQueryHistoryEntry {
                connection_id: request.connection_id,
                id: request.id,
            }
        }
        ProductivityRpcCommand::ClearQueryHistory => {
            let request: ConnectionIdRequest = decode_payload(body)?;
            ProductivityCommand::ClearQueryHistory {
                connection_id: request.connection_id,
            }
        }
    })
}

fn decode_persistence_command(
    command: PersistenceRpcCommand,
    body: &[u8],
) -> Result<PersistenceCommand, String> {
    Ok(match command {
        PersistenceRpcCommand::GetConfig => {
            decode_empty_payload(body)?;
            PersistenceCommand::GetConfig
        }
        PersistenceRpcCommand::SaveConfig => {
            let request: SaveConfigRequest = decode_payload(body)?;
            PersistenceCommand::SaveConfig(request.config)
        }
        PersistenceRpcCommand::GetConfigJson => {
            decode_empty_payload(body)?;
            PersistenceCommand::GetConfigJson
        }
        PersistenceRpcCommand::SaveConfigJson => {
            let request: SaveConfigJsonRequest = decode_payload(body)?;
            PersistenceCommand::SaveConfigJson(request.json)
        }
        PersistenceRpcCommand::GetKeybindings => {
            decode_empty_payload(body)?;
            PersistenceCommand::GetKeybindings
        }
        PersistenceRpcCommand::SaveKeybindings => {
            let request: SaveKeybindingsRequest = decode_payload(body)?;
            PersistenceCommand::SaveKeybindings(request.keybindings)
        }
        PersistenceRpcCommand::GetAllThemes => {
            decode_empty_payload(body)?;
            PersistenceCommand::GetAllThemes
        }
        PersistenceRpcCommand::SaveCustomTheme => {
            let request: SaveThemeRequest = decode_payload(body)?;
            PersistenceCommand::SaveCustomTheme(request.theme)
        }
        PersistenceRpcCommand::DeleteCustomTheme => {
            let request: ThemeIdRequest = decode_payload(body)?;
            PersistenceCommand::DeleteCustomTheme(request.theme_id)
        }
        PersistenceRpcCommand::GetPrompt(kind) => {
            decode_empty_payload(body)?;
            PersistenceCommand::GetPrompt(kind)
        }
        PersistenceRpcCommand::SavePrompt(kind) => {
            let request: SavePromptRequest = decode_payload(body)?;
            PersistenceCommand::SavePrompt(kind, request.prompt)
        }
        PersistenceRpcCommand::ResetPrompt(kind) => {
            decode_empty_payload(body)?;
            PersistenceCommand::ResetPrompt(kind)
        }
        PersistenceRpcCommand::LoadEditorPreferences => {
            let request: ConnectionIdRequest = decode_payload(body)?;
            PersistenceCommand::LoadEditorPreferences(request.connection_id)
        }
        PersistenceRpcCommand::SaveEditorPreferences => {
            let request: SaveEditorPreferencesRequest = decode_payload(body)?;
            PersistenceCommand::SaveEditorPreferences(request.connection_id, request.preferences)
        }
        PersistenceRpcCommand::DeleteEditorPreferences => {
            let request: ConnectionIdRequest = decode_payload(body)?;
            PersistenceCommand::DeleteEditorPreferences(request.connection_id)
        }
        PersistenceRpcCommand::GetLastActiveConnection => {
            decode_empty_payload(body)?;
            PersistenceCommand::GetLastActiveConnection
        }
        PersistenceRpcCommand::SetLastActiveConnection => {
            let request: SetLastActiveConnectionRequest = decode_payload(body)?;
            PersistenceCommand::SetLastActiveConnection(request.connection_id)
        }
        PersistenceRpcCommand::GetLastOpenConnections => {
            decode_empty_payload(body)?;
            PersistenceCommand::GetLastOpenConnections
        }
        PersistenceRpcCommand::SetLastOpenConnections => {
            let request: SetLastOpenConnectionsRequest = decode_payload(body)?;
            PersistenceCommand::SetLastOpenConnections(request.connection_ids)
        }
    })
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

fn decode_record_command(command: RecordRpcCommand, body: &[u8]) -> Result<RecordCommand, String> {
    Ok(match command {
        RecordRpcCommand::Delete => {
            let request: RecordIdentityRequest = decode_payload(body)?;
            RecordCommand::Delete {
                connection_id: request.connection_id,
                table: request.table,
                pk_map: request.pk_map,
                schema: request.schema,
                database: request.database,
            }
        }
        RecordRpcCommand::Update => {
            let request: UpdateRecordRequest = decode_payload(body)?;
            RecordCommand::Update {
                connection_id: request.connection_id,
                table: request.table,
                pk_map: request.pk_map,
                col_name: request.col_name,
                new_val: request.new_val,
                schema: request.schema,
                database: request.database,
            }
        }
        RecordRpcCommand::Insert => {
            let request: InsertRecordRequest = decode_payload(body)?;
            RecordCommand::Insert {
                connection_id: request.connection_id,
                table: request.table,
                data: request.data,
                schema: request.schema,
                database: request.database,
            }
        }
        RecordRpcCommand::FetchBlob => {
            let request: BlobColumnRequest = decode_payload(body)?;
            RecordCommand::FetchBlob {
                connection_id: request.connection_id,
                table: request.table,
                col_name: request.col_name,
                pk_map: request.pk_map,
                schema: request.schema,
                database: request.database,
            }
        }
        RecordRpcCommand::DetectBlobMime => {
            let request: DetectBlobMimeRequest = decode_payload(body)?;
            RecordCommand::DetectBlobMime {
                base64_data: request.base64_data,
            }
        }
        RecordRpcCommand::DetectMimeType => {
            let request: DetectMimeTypeRequest = decode_payload(body)?;
            RecordCommand::DetectMimeType {
                header_base64: request.header_base64,
            }
        }
    })
}

fn decode_database_object_command(
    command: DatabaseObjectRpcCommand,
    body: &[u8],
) -> Result<DatabaseObjectCommand, String> {
    Ok(match command {
        DatabaseObjectRpcCommand::GetViewDefinition
        | DatabaseObjectRpcCommand::DropView
        | DatabaseObjectRpcCommand::RefreshMaterializedView => {
            let request: ViewMetadataRequest = decode_payload(body)?;
            match command {
                DatabaseObjectRpcCommand::GetViewDefinition => {
                    DatabaseObjectCommand::GetViewDefinition {
                        connection_id: request.connection_id,
                        view_name: request.view_name,
                        schema: request.schema,
                    }
                }
                DatabaseObjectRpcCommand::DropView => DatabaseObjectCommand::DropView {
                    connection_id: request.connection_id,
                    view_name: request.view_name,
                    schema: request.schema,
                },
                DatabaseObjectRpcCommand::RefreshMaterializedView => {
                    DatabaseObjectCommand::RefreshMaterializedView {
                        connection_id: request.connection_id,
                        view_name: request.view_name,
                        schema: request.schema,
                    }
                }
                _ => unreachable!(),
            }
        }
        DatabaseObjectRpcCommand::CreateView | DatabaseObjectRpcCommand::AlterView => {
            let request: ViewDefinitionRequest = decode_payload(body)?;
            if command == DatabaseObjectRpcCommand::CreateView {
                DatabaseObjectCommand::CreateView {
                    connection_id: request.connection_id,
                    view_name: request.view_name,
                    definition: request.definition,
                    schema: request.schema,
                }
            } else {
                DatabaseObjectCommand::AlterView {
                    connection_id: request.connection_id,
                    view_name: request.view_name,
                    definition: request.definition,
                    schema: request.schema,
                }
            }
        }
        DatabaseObjectRpcCommand::GetRoutineParameters => {
            let request: RoutineNameRequest = decode_payload(body)?;
            DatabaseObjectCommand::GetRoutineParameters {
                connection_id: request.connection_id,
                routine_name: request.routine_name,
                schema: request.schema,
            }
        }
        DatabaseObjectRpcCommand::GetRoutineDefinition
        | DatabaseObjectRpcCommand::GetRoutineEditScript
        | DatabaseObjectRpcCommand::DropRoutine => {
            let request: RoutineTargetRequest = decode_payload(body)?;
            match command {
                DatabaseObjectRpcCommand::GetRoutineDefinition => {
                    DatabaseObjectCommand::GetRoutineDefinition {
                        connection_id: request.connection_id,
                        routine_name: request.routine_name,
                        routine_type: request.routine_type,
                        schema: request.schema,
                    }
                }
                DatabaseObjectRpcCommand::GetRoutineEditScript => {
                    DatabaseObjectCommand::GetRoutineEditScript {
                        connection_id: request.connection_id,
                        routine_name: request.routine_name,
                        routine_type: request.routine_type,
                        schema: request.schema,
                    }
                }
                DatabaseObjectRpcCommand::DropRoutine => DatabaseObjectCommand::DropRoutine {
                    connection_id: request.connection_id,
                    routine_name: request.routine_name,
                    routine_type: request.routine_type,
                    schema: request.schema,
                },
                _ => unreachable!(),
            }
        }
        DatabaseObjectRpcCommand::BuildRoutineCallSql => {
            let request: RoutineCallRequest = decode_payload(body)?;
            DatabaseObjectCommand::BuildRoutineCallSql {
                connection_id: request.connection_id,
                routine_name: request.routine_name,
                routine_type: request.routine_type,
                args: request.args,
                schema: request.schema,
            }
        }
        DatabaseObjectRpcCommand::GetRoutineCreateTemplate => {
            let request: RoutineTemplateRequest = decode_payload(body)?;
            DatabaseObjectCommand::GetRoutineCreateTemplate {
                connection_id: request.connection_id,
                routine_type: request.routine_type,
                schema: request.schema,
            }
        }
        DatabaseObjectRpcCommand::GetTriggerDefinition | DatabaseObjectRpcCommand::DropTrigger => {
            let request: TriggerTargetRequest = decode_payload(body)?;
            if command == DatabaseObjectRpcCommand::GetTriggerDefinition {
                DatabaseObjectCommand::GetTriggerDefinition {
                    connection_id: request.connection_id,
                    trigger_name: request.trigger_name,
                    table_name: request.table_name,
                    schema: request.schema,
                }
            } else {
                DatabaseObjectCommand::DropTrigger {
                    connection_id: request.connection_id,
                    trigger_name: request.trigger_name,
                    table_name: request.table_name,
                    schema: request.schema,
                }
            }
        }
        DatabaseObjectRpcCommand::CreateTrigger => {
            let request: CreateTriggerRequest = decode_payload(body)?;
            DatabaseObjectCommand::CreateTrigger {
                connection_id: request.connection_id,
                trigger_sql: request.trigger_sql,
                schema: request.schema,
            }
        }
        DatabaseObjectRpcCommand::GetCreateTableSql => {
            let request: CreateTableSqlRequest = decode_payload(body)?;
            DatabaseObjectCommand::GetCreateTableSql {
                connection_id: request.connection_id,
                table_name: request.table_name,
                columns: request.columns,
                schema: request.schema,
            }
        }
        DatabaseObjectRpcCommand::GetAddColumnSql => {
            let request: AddColumnSqlRequest = decode_payload(body)?;
            DatabaseObjectCommand::GetAddColumnSql {
                connection_id: request.connection_id,
                table: request.table,
                column: request.column,
                schema: request.schema,
            }
        }
        DatabaseObjectRpcCommand::GetAlterColumnSql => {
            let request: AlterColumnSqlRequest = decode_payload(body)?;
            DatabaseObjectCommand::GetAlterColumnSql {
                connection_id: request.connection_id,
                table: request.table,
                old_column: request.old_column,
                new_column: request.new_column,
                schema: request.schema,
            }
        }
        DatabaseObjectRpcCommand::GetCreateIndexSql => {
            let request: CreateIndexSqlRequest = decode_payload(body)?;
            DatabaseObjectCommand::GetCreateIndexSql {
                connection_id: request.connection_id,
                table: request.table,
                index_name: request.index_name,
                columns: request.columns,
                is_unique: request.is_unique,
                schema: request.schema,
            }
        }
        DatabaseObjectRpcCommand::GetCreateForeignKeySql => {
            let request: CreateForeignKeySqlRequest = decode_payload(body)?;
            DatabaseObjectCommand::GetCreateForeignKeySql {
                connection_id: request.connection_id,
                table: request.table,
                fk_name: request.fk_name,
                column: request.column,
                ref_table: request.ref_table,
                ref_column: request.ref_column,
                on_delete: request.on_delete,
                on_update: request.on_update,
                schema: request.schema,
            }
        }
        DatabaseObjectRpcCommand::DropIndex => {
            let request: DropIndexRequest = decode_payload(body)?;
            DatabaseObjectCommand::DropIndex {
                connection_id: request.connection_id,
                table: request.table,
                index_name: request.index_name,
                schema: request.schema,
            }
        }
        DatabaseObjectRpcCommand::DropForeignKey => {
            let request: DropForeignKeyRequest = decode_payload(body)?;
            DatabaseObjectCommand::DropForeignKey {
                connection_id: request.connection_id,
                table: request.table,
                fk_name: request.fk_name,
                schema: request.schema,
            }
        }
        DatabaseObjectRpcCommand::GetDbPrivilegeCatalog => {
            let request: ConnectionIdRequest = decode_payload(body)?;
            DatabaseObjectCommand::GetDbPrivilegeCatalog {
                connection_id: request.connection_id,
            }
        }
        DatabaseObjectRpcCommand::GetDbUsers => {
            let request: ConnectionIdRequest = decode_payload(body)?;
            DatabaseObjectCommand::GetDbUsers {
                connection_id: request.connection_id,
            }
        }
        DatabaseObjectRpcCommand::GetDbUserGrants
        | DatabaseObjectRpcCommand::GetDbUserPrivileges
        | DatabaseObjectRpcCommand::DropDbUser => {
            let request: DbUserTargetRequest = decode_payload(body)?;
            match command {
                DatabaseObjectRpcCommand::GetDbUserGrants => {
                    DatabaseObjectCommand::GetDbUserGrants {
                        connection_id: request.connection_id,
                        user: request.user,
                        host: request.host,
                    }
                }
                DatabaseObjectRpcCommand::GetDbUserPrivileges => {
                    DatabaseObjectCommand::GetDbUserPrivileges {
                        connection_id: request.connection_id,
                        user: request.user,
                        host: request.host,
                    }
                }
                DatabaseObjectRpcCommand::DropDbUser => DatabaseObjectCommand::DropDbUser {
                    connection_id: request.connection_id,
                    user: request.user,
                    host: request.host,
                },
                _ => unreachable!(),
            }
        }
        DatabaseObjectRpcCommand::CreateDbUser | DatabaseObjectRpcCommand::SetDbUserPassword => {
            let request: DbUserPasswordRequest = decode_payload(body)?;
            if command == DatabaseObjectRpcCommand::CreateDbUser {
                DatabaseObjectCommand::CreateDbUser {
                    connection_id: request.connection_id,
                    user: request.user,
                    host: request.host,
                    password: request.password,
                }
            } else {
                DatabaseObjectCommand::SetDbUserPassword {
                    connection_id: request.connection_id,
                    user: request.user,
                    host: request.host,
                    password: request.password,
                }
            }
        }
        DatabaseObjectRpcCommand::ApplyDbUserPrivileges => {
            let request: ApplyDbUserPrivilegesRequest = decode_payload(body)?;
            DatabaseObjectCommand::ApplyDbUserPrivileges {
                connection_id: request.connection_id,
                user: request.user,
                host: request.host,
                database: request.database,
                table: request.table,
                privileges: request.privileges,
                grant: request.grant,
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
