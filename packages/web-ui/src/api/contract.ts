import type {
  ConnectionAppearance,
  ConnectionGroup,
  ConnectionsFile,
  RoutineInfo,
  SavedConnection,
  TableInfo,
  TriggerInfo,
  ViewInfo,
} from "../contexts/DatabaseContext";
import type {
  InstalledPluginInfo,
  PluginLoadError,
  PluginManifest,
  PluginReadme,
  RegistryPluginWithStatus,
} from "../types/plugins";
import type { ConnectionTag } from "../types/tags";
import type { ExplainQueryOutput } from "@tabularis/explain";
import type {
  BatchStatementResult,
  EditorPreferences,
  QueryResult,
  TableColumn,
  TableSchema,
} from "../types/editor";
import type { ForeignKey, Index } from "../types/schema";
import type { Theme } from "../types/theme";
import type { Settings } from "../contexts/SettingsContext";
import type { SavedQuery } from "../contexts/SavedQueriesContext";
import type {
  QueryHistoryEntry,
  QueryHistoryResponse,
} from "../types/queryHistory";
import type { UserOverrides } from "../utils/keybindings";
import type { NotebookMetadata } from "../types/notebook";
import type {
  AiActivityEvent,
  AiEventFilter,
  AiExplainRequest,
  AiGenerateRequest,
  AiKeyStatus,
  AiNameRequest,
  AiNotebookExport,
  AiProviderModels,
  AiSessionSummary,
  AiTableNameRequest,
  ApprovalDecisionPayload,
  PendingApproval,
} from "../types/ai";
import type {
  ImportPreview,
  ImportResolution,
  ImportSourceInfo,
} from "../types/connectionImport";
import type { RequestId } from "./errors";
import type {
  LogEntry,
  LogSettings,
  ProcessInfo,
  SystemStats,
  TabularisChildProcess,
} from "../types/operations";
import type { McpClientStatus } from "../types/mcp";

export type AuthorizationLevel =
  | "session"
  | "database"
  | "sensitive"
  | "local-admin";

export interface CommandDefinition<
  Request,
  Response,
  Authorization extends AuthorizationLevel,
> {
  readonly request: Request;
  readonly response: Response;
  readonly authorization: Authorization;
}

export interface ConnectionParameters {
  driver: string;
  database: string | string[];
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  connection_uri?: string;
  connection_uri_in_keychain?: boolean;
  ssl_mode?: string;
  ssl_ca?: string;
  ssl_cert?: string;
  ssl_key?: string;
  enable_cleartext_plugin?: boolean;
  pipes_as_concat?: boolean;
  use_iam_auth?: boolean;
  ssh_enabled?: boolean;
  ssh_connection_id?: string;
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  ssh_password?: string;
  ssh_key_file?: string;
  ssh_key_passphrase?: string;
  ssh_allow_passphrase_prompt?: boolean;
  save_in_keychain?: boolean;
  k8s_enabled?: boolean;
  k8s_connection_id?: string;
  k8s_context?: string;
  k8s_namespace?: string;
  k8s_resource_type?: string;
  k8s_resource_name?: string;
  k8s_port?: number;
  k8s_kubectl_path?: string;
  k8s_kubeconfig_path?: string;
  startup_script?: string;
  extra?: Record<string, string>;
  connection_id?: string;
}

export interface TestConnectionRequest {
  params: ConnectionParameters;
  connection_id?: string;
  progress_id?: string;
}

export interface SshConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  auth_type?: "password" | "ssh_key";
  password?: string;
  key_file?: string;
  key_passphrase?: string;
  allow_passphrase_prompt?: boolean;
  save_in_keychain?: boolean;
}

export type SshConnectionInput = Partial<Omit<SshConnection, "id" | "name">>;

export interface SshTestRequest extends Partial<SshConnection> {
  connection_id?: string;
  db_connection_id?: string;
  progress_id?: string;
}

export interface K8sConnection {
  id: string;
  name: string;
  context: string;
  namespace: string;
  resource_type: "service" | "pod";
  resource_name: string;
  port: number;
  kubectl_path?: string;
  kubeconfig_path?: string;
}

export interface K8sConnectionInput {
  name: string;
  context: string;
  namespace: string;
  resource_type: string;
  resource_name: string;
  port: number;
  kubectl_path?: string;
  kubeconfig_path?: string;
}

export interface K8sCommandOptions {
  kubectl_path?: string;
  kubeconfig_path?: string;
}

export interface K8sCommandRequest {
  kubectlPath?: string;
  kubeconfigPath?: string;
}

export interface SaveConnectionRequest {
  name: string;
  params: ConnectionParameters;
  detectJsonInTextColumns?: boolean;
  environment?: string;
}

export interface UpdateConnectionRequest extends SaveConnectionRequest {
  id: string;
}

interface ConnectionIdRequest {
  connectionId: string;
}

interface NotebookTargetRequest extends ConnectionIdRequest {
  notebookId: string;
}

interface NotebookContentRequest extends NotebookTargetRequest {
  content: string;
}

interface MetadataRequest extends ConnectionIdRequest {
  schema?: string;
}

interface TableMetadataRequest extends MetadataRequest {
  tableName: string;
}

interface ViewMetadataRequest extends MetadataRequest {
  viewName: string;
}

export interface ExecuteQueryRequest extends MetadataRequest {
  query: string;
  limit?: number;
  page?: number;
}

export interface ExecuteQueryBatchRequest extends MetadataRequest {
  queries: string[];
  limit?: number;
  page?: number;
  batchId?: string;
}

export interface ExplainQueryRequest extends MetadataRequest {
  query: string;
  analyze: boolean;
}

export interface CancelQueryRequest extends ConnectionIdRequest {
  queryRequestId?: RequestId;
}

export interface RecordLocator extends MetadataRequest {
  table: string;
  database?: string;
}

export interface RecordIdentityRequest extends RecordLocator {
  pkMap: Record<string, unknown>;
}

export interface BlobColumnRequest extends RecordIdentityRequest {
  colName: string;
}

export interface ColumnDefinition {
  name: string;
  data_type: string;
  is_nullable: boolean;
  is_pk: boolean;
  is_auto_increment: boolean;
  default_value: string | null;
}

export interface RoutineParameterInfo {
  name: string;
  data_type: string;
  mode: string;
  ordinal_position: number;
}

export interface RoutineCallArg {
  name: string;
  mode: string;
  value: string | null;
  is_raw: boolean;
}

export interface DbUserInfo {
  user: string;
  host: string;
  locked: boolean;
}

export interface DbPrivilegeCatalog {
  database: string[];
  global: string[];
  table: string[];
}

export interface DbUserGrantSet {
  database: string | null;
  table: string | null;
  privileges: string[];
}

interface RoutineTargetRequest extends MetadataRequest {
  routineName: string;
  routineType: string;
}

interface TriggerTargetRequest extends MetadataRequest {
  triggerName: string;
  tableName: string;
}

interface DbUserTargetRequest extends ConnectionIdRequest {
  user: string;
  host: string;
}

export type BlobFetchResponse =
  | {
      kind: "inline";
      wireValue: string;
    }
  | {
      kind: "download";
      token: string;
      size: number;
      mimeType: string;
    };

export type ConnectionExportMode = "encrypted" | "noSecrets" | "plaintext";

export type GeneratedFile =
  | {
      kind: "inline";
      fileName: string;
      mimeType: string;
      contents: string;
    }
  | {
      kind: "download";
      fileName: string;
      mimeType: string;
      token: string;
      size: number;
    };

export type ConnectionImportFile =
  | { kind: "serverPath"; path: string }
  | { kind: "upload"; token: string };

export type TabularisImportPreviewResult =
  | { kind: "passwordRequired" }
  | { kind: "preview"; preview: ImportPreview };

export interface BackupStatus {
  passwordSet: boolean;
  targetPasswordSet: boolean;
  lastBackupAt: string | null;
  targetKind: "serverDirectory" | "webdav";
  targetDisplay: string | null;
}

export interface BackupRunResult {
  serverLocation: string;
  targetKind: "serverDirectory" | "webdav";
  download: GeneratedFile | null;
}

export interface DumpOptions {
  structure: boolean;
  data: boolean;
  tables?: string[] | null;
}

export interface DatabaseDumpRequest extends ConnectionIdRequest {
  options: DumpOptions;
  schema?: string;
  database?: string;
  /** Desktop-only save path. Browser requests omit this and receive a download. */
  filePath?: string;
}

export interface DatabaseImportRequest extends ConnectionIdRequest {
  schema?: string;
  database?: string;
  /** Desktop-only source path. */
  filePath?: string;
  /** Browser-only opaque upload token. */
  uploadToken?: string;
}

export interface QueryExportRequest extends ConnectionIdRequest {
  query: string;
  format: "csv" | "json" | "markdown";
  csvDelimiter?: string;
  database?: string;
  /** Desktop-only save path. Browser requests omit this and receive a download. */
  filePath?: string;
}

export interface PersistedConfig extends Partial<Settings> {
  theme?: string;
  checkForUpdates?: boolean;
  lastDismissedVersion?: string;
  lastActiveConnectionId?: string;
  lastOpenConnectionIds?: string[];
}

export interface CommandMap {
  is_debug_mode: CommandDefinition<undefined, boolean, "local-admin">;
  get_installation_source: CommandDefinition<
    undefined,
    string | null,
    "local-admin"
  >;
  // MCP client status and installation operate on host configuration files or
  // local client CLIs, so browsers may use them only in local-admin Web mode.
  get_mcp_status: CommandDefinition<undefined, McpClientStatus[], "local-admin">;
  install_mcp_config: CommandDefinition<
    { clientId: string },
    string,
    "local-admin"
  >;

  get_logs: CommandDefinition<
    {
      request: {
        limit?: number | null;
        level_filter?: string | null;
      };
    },
    LogEntry[],
    "sensitive"
  >;
  clear_logs: CommandDefinition<undefined, void, "local-admin">;
  get_log_settings: CommandDefinition<undefined, LogSettings, "sensitive">;
  set_log_enabled: CommandDefinition<{ enabled: boolean }, void, "local-admin">;
  set_log_max_size: CommandDefinition<{ maxSize: number }, void, "local-admin">;
  get_process_list: CommandDefinition<undefined, ProcessInfo[], "sensitive">;
  get_system_stats: CommandDefinition<undefined, SystemStats, "sensitive">;
  get_tabularis_children: CommandDefinition<
    undefined,
    TabularisChildProcess[],
    "sensitive"
  >;

  get_connections: CommandDefinition<undefined, SavedConnection[], "database">;
  get_connection_by_id: CommandDefinition<
    { id: string },
    SavedConnection,
    "database"
  >;
  get_connections_with_groups: CommandDefinition<
    undefined,
    ConnectionsFile,
    "database"
  >;
  get_active_connections: CommandDefinition<undefined, string[], "database">;
  register_active_connection: CommandDefinition<ConnectionIdRequest, void, "database">;
  save_connection: CommandDefinition<SaveConnectionRequest, SavedConnection, "database">;
  update_connection: CommandDefinition<UpdateConnectionRequest, SavedConnection, "database">;
  delete_connection: CommandDefinition<{ id: string }, void, "database">;
  duplicate_connection: CommandDefinition<{ id: string }, SavedConnection, "database">;
  set_connection_appearance: CommandDefinition<
    { id: string; appearance?: ConnectionAppearance },
    void,
    "database"
  >;
  save_connection_icon: CommandDefinition<
    { connectionId: string; uploadToken: string },
    string,
    "database"
  >;
  delete_connection_icon: CommandDefinition<{ relativePath: string }, void, "database">;

  get_connection_groups: CommandDefinition<undefined, ConnectionGroup[], "database">;
  create_connection_group: CommandDefinition<
    { name: string; parentId?: string | null },
    ConnectionGroup,
    "database"
  >;
  create_group_path: CommandDefinition<
    { path: string; parentId?: string | null },
    ConnectionGroup,
    "database"
  >;
  update_connection_group: CommandDefinition<
    { id: string; name?: string; collapsed?: boolean; sortOrder?: number },
    ConnectionGroup,
    "database"
  >;
  move_group_to_parent: CommandDefinition<
    { id: string; parentId: string | null },
    ConnectionGroup,
    "database"
  >;
  delete_connection_group: CommandDefinition<{ id: string }, void, "database">;
  move_connection_to_group: CommandDefinition<
    { connectionId: string; groupId: string | null; sortOrder?: number },
    SavedConnection,
    "database"
  >;
  reorder_groups: CommandDefinition<
    { groupOrders: Array<[string, number]> },
    void,
    "database"
  >;
  reorder_connections_in_group: CommandDefinition<
    { connectionOrders: Array<[string, number]> },
    void,
    "database"
  >;

  list_connection_tags: CommandDefinition<undefined, ConnectionTag[], "database">;
  create_connection_tag: CommandDefinition<
    { name: string; color: string },
    ConnectionTag,
    "database"
  >;
  update_connection_tag: CommandDefinition<
    { id: string; name: string; color: string },
    void,
    "database"
  >;
  delete_connection_tag: CommandDefinition<{ id: string }, void, "database">;
  set_connection_tags: CommandDefinition<
    { connectionId: string; tagIds: string[] },
    void,
    "database"
  >;

  get_registered_drivers: CommandDefinition<undefined, PluginManifest[], "database">;
  get_driver_manifest: CommandDefinition<
    { driverId: string },
    PluginManifest | null,
    "database"
  >;

  // Plugin lifecycle commands are local-admin operations because they can
  // access configured registries, mutate the server plugin directory, and
  // start or stop subprocesses. Raw plugin paths and files are intentionally
  // excluded from the browser RPC contract.
  fetch_plugin_registry: CommandDefinition<
    undefined,
    RegistryPluginWithStatus[],
    "local-admin"
  >;
  fetch_tabularium_plugin_preview: CommandDefinition<
    {
      slug: string;
      registryUrl?: string | null;
      version?: string | null;
    },
    RegistryPluginWithStatus,
    "local-admin"
  >;
  fetch_plugin_readme: CommandDefinition<
    {
      slug: string;
      locale?: string | null;
      registryUrl?: string | null;
    },
    PluginReadme,
    "local-admin"
  >;
  install_plugin: CommandDefinition<
    { pluginId: string; version?: string | null },
    void,
    "local-admin"
  >;
  cancel_plugin_install: CommandDefinition<
    { pluginId: string },
    boolean,
    "local-admin"
  >;
  uninstall_plugin: CommandDefinition<{ pluginId: string }, void, "local-admin">;
  get_installed_plugins: CommandDefinition<
    undefined,
    InstalledPluginInfo[],
    "local-admin"
  >;
  disable_plugin: CommandDefinition<{ pluginId: string }, void, "local-admin">;
  enable_plugin: CommandDefinition<{ pluginId: string }, void, "local-admin">;
  get_plugin_manifest: CommandDefinition<
    { pluginId: string },
    PluginManifest,
    "local-admin"
  >;
  get_plugin_startup_errors: CommandDefinition<
    undefined,
    PluginLoadError[],
    "local-admin"
  >;
  kill_plugin_process: CommandDefinition<
    { pluginId: string },
    void,
    "local-admin"
  >;
  restart_plugin_process: CommandDefinition<
    { pluginId: string },
    void,
    "local-admin"
  >;

  test_connection: CommandDefinition<
    { request: TestConnectionRequest },
    string,
    "database"
  >;
  disconnect_connection: CommandDefinition<ConnectionIdRequest, void, "database">;

  export_connections_file: CommandDefinition<
    {
      mode: ConnectionExportMode;
      password?: string;
      connectionIds?: string[] | null;
    },
    GeneratedFile,
    "sensitive"
  >;
  list_connection_import_sources: CommandDefinition<
    undefined,
    ImportSourceInfo[],
    "local-admin"
  >;
  preview_connection_import: CommandDefinition<
    {
      sourceId: string;
      includePasswords: boolean;
      file?: ConnectionImportFile | null;
    },
    ImportPreview,
    "local-admin"
  >;
  apply_connection_import: CommandDefinition<
    { sourceId: string; resolutions: ImportResolution[] },
    void,
    "local-admin"
  >;
  preview_tabularis_import_file: CommandDefinition<
    { file: ConnectionImportFile; password?: string },
    TabularisImportPreviewResult,
    "sensitive"
  >;
  apply_prepared_tabularis_import: CommandDefinition<
    { resolutions: ImportResolution[] },
    void,
    "sensitive"
  >;
  get_connections_backup_status: CommandDefinition<
    undefined,
    BackupStatus,
    "local-admin"
  >;
  set_connections_backup_password: CommandDefinition<
    { password: string },
    void,
    "sensitive"
  >;
  set_connections_backup_target_password: CommandDefinition<
    { targetId: string; password: string },
    void,
    "sensitive"
  >;
  run_connections_backup: CommandDefinition<
    undefined,
    string | BackupRunResult,
    "sensitive"
  >;

  dump_database: CommandDefinition<
    DatabaseDumpRequest,
    GeneratedFile | null,
    "sensitive"
  >;
  cancel_dump: CommandDefinition<ConnectionIdRequest, void, "sensitive">;
  import_database: CommandDefinition<DatabaseImportRequest, void, "sensitive">;
  cancel_import: CommandDefinition<ConnectionIdRequest, void, "sensitive">;

  get_ssh_connections: CommandDefinition<undefined, SshConnection[], "local-admin">;
  save_ssh_connection: CommandDefinition<
    { name: string; ssh: SshConnectionInput },
    SshConnection,
    "local-admin"
  >;
  update_ssh_connection: CommandDefinition<
    { id: string; name: string; ssh: SshConnectionInput },
    SshConnection,
    "local-admin"
  >;
  delete_ssh_connection: CommandDefinition<{ id: string }, void, "local-admin">;
  test_ssh_connection: CommandDefinition<
    { ssh: SshTestRequest },
    string,
    "local-admin"
  >;
  respond_ssh_askpass: CommandDefinition<
    { id: number; response: string | null },
    void,
    "sensitive"
  >;

  get_k8s_connections: CommandDefinition<undefined, K8sConnection[], "local-admin">;
  save_k8s_connection: CommandDefinition<
    { k8s: K8sConnectionInput },
    K8sConnection,
    "local-admin"
  >;
  update_k8s_connection: CommandDefinition<
    { id: string; k8s: K8sConnectionInput },
    K8sConnection,
    "local-admin"
  >;
  delete_k8s_connection: CommandDefinition<{ id: string }, void, "local-admin">;
  test_k8s_connection_cmd: CommandDefinition<
    { context: string; namespace: string } & K8sCommandRequest,
    string,
    "local-admin"
  >;
  get_k8s_contexts_cmd: CommandDefinition<
    K8sCommandRequest | undefined,
    string[],
    "local-admin"
  >;
  get_k8s_namespaces_cmd: CommandDefinition<
    { context: string } & K8sCommandRequest,
    string[],
    "local-admin"
  >;
  get_k8s_resources_cmd: CommandDefinition<
    { context: string; namespace: string; resourceType: string } & K8sCommandRequest,
    string[],
    "local-admin"
  >;
  get_k8s_resource_ports_cmd: CommandDefinition<
    {
      context: string;
      namespace: string;
      resourceType: string;
      resourceName: string;
    } & K8sCommandRequest,
    number[],
    "local-admin"
  >;
  validate_k8s_path_cmd: CommandDefinition<
    { path: string; kind: "kubectl" | "kubeconfig" },
    void,
    "local-admin"
  >;

  get_available_databases: CommandDefinition<
    ConnectionIdRequest,
    string[],
    "database"
  >;
  list_databases: CommandDefinition<
    { request: TestConnectionRequest },
    string[],
    "database"
  >;
  get_schemas: CommandDefinition<ConnectionIdRequest, string[], "database">;
  get_tables: CommandDefinition<MetadataRequest, TableInfo[], "database">;
  get_columns: CommandDefinition<TableMetadataRequest, TableColumn[], "database">;
  get_foreign_keys: CommandDefinition<TableMetadataRequest, ForeignKey[], "database">;
  get_indexes: CommandDefinition<TableMetadataRequest, Index[], "database">;
  get_views: CommandDefinition<MetadataRequest, ViewInfo[], "database">;
  get_view_columns: CommandDefinition<ViewMetadataRequest, TableColumn[], "database">;
  get_materialized_views: CommandDefinition<MetadataRequest, ViewInfo[], "database">;
  get_materialized_view_columns: CommandDefinition<
    ViewMetadataRequest,
    TableColumn[],
    "database"
  >;
  get_materialized_view_definition: CommandDefinition<
    ViewMetadataRequest,
    string,
    "database"
  >;
  get_routines: CommandDefinition<MetadataRequest, RoutineInfo[], "database">;
  get_triggers: CommandDefinition<MetadataRequest, TriggerInfo[], "database">;
  get_schema_snapshot: CommandDefinition<
    MetadataRequest,
    TableSchema[],
    "database"
  >;
  get_selected_schemas: CommandDefinition<ConnectionIdRequest, string[], "database">;
  set_selected_schemas: CommandDefinition<
    ConnectionIdRequest & { schemas: string[] },
    void,
    "database"
  >;
  get_schema_preference: CommandDefinition<
    ConnectionIdRequest,
    string | null,
    "database"
  >;
  set_schema_preference: CommandDefinition<
    ConnectionIdRequest & { schema: string },
    void,
    "database"
  >;

  get_view_definition: CommandDefinition<ViewMetadataRequest, string, "database">;
  create_view: CommandDefinition<
    ViewMetadataRequest & { definition: string },
    void,
    "database"
  >;
  alter_view: CommandDefinition<
    ViewMetadataRequest & { definition: string },
    void,
    "database"
  >;
  drop_view: CommandDefinition<ViewMetadataRequest, void, "database">;
  refresh_materialized_view: CommandDefinition<ViewMetadataRequest, void, "database">;

  get_routine_parameters: CommandDefinition<
    MetadataRequest & { routineName: string },
    RoutineParameterInfo[],
    "database"
  >;
  get_routine_definition: CommandDefinition<RoutineTargetRequest, string, "database">;
  build_routine_call_sql: CommandDefinition<
    RoutineTargetRequest & { args: RoutineCallArg[] },
    string,
    "database"
  >;
  get_routine_create_template: CommandDefinition<
    MetadataRequest & { routineType: string },
    string,
    "database"
  >;
  get_routine_edit_script: CommandDefinition<RoutineTargetRequest, string, "database">;
  drop_routine: CommandDefinition<RoutineTargetRequest, void, "database">;

  get_trigger_definition: CommandDefinition<TriggerTargetRequest, string, "database">;
  create_trigger: CommandDefinition<
    MetadataRequest & { triggerSql: string },
    void,
    "database"
  >;
  drop_trigger: CommandDefinition<TriggerTargetRequest, void, "database">;

  get_create_table_sql: CommandDefinition<
    MetadataRequest & { tableName: string; columns: ColumnDefinition[] },
    string[],
    "database"
  >;
  get_add_column_sql: CommandDefinition<
    MetadataRequest & { table: string; column: ColumnDefinition },
    string[],
    "database"
  >;
  get_alter_column_sql: CommandDefinition<
    MetadataRequest & {
      table: string;
      oldColumn: ColumnDefinition;
      newColumn: ColumnDefinition;
    },
    string[],
    "database"
  >;
  get_create_index_sql: CommandDefinition<
    MetadataRequest & {
      table: string;
      indexName: string;
      columns: string[];
      isUnique: boolean;
    },
    string[],
    "database"
  >;
  get_create_foreign_key_sql: CommandDefinition<
    MetadataRequest & {
      table: string;
      fkName: string;
      column: string;
      refTable: string;
      refColumn: string;
      onDelete?: string | null;
      onUpdate?: string | null;
    },
    string[],
    "database"
  >;
  drop_index_action: CommandDefinition<
    MetadataRequest & { table: string; indexName: string },
    void,
    "database"
  >;
  drop_foreign_key_action: CommandDefinition<
    MetadataRequest & { table: string; fkName: string },
    void,
    "database"
  >;

  get_db_privilege_catalog: CommandDefinition<
    ConnectionIdRequest,
    DbPrivilegeCatalog,
    "sensitive"
  >;
  get_db_users: CommandDefinition<ConnectionIdRequest, DbUserInfo[], "sensitive">;
  get_db_user_grants: CommandDefinition<DbUserTargetRequest, string[], "sensitive">;
  get_db_user_privileges: CommandDefinition<
    DbUserTargetRequest,
    DbUserGrantSet[],
    "sensitive"
  >;
  create_db_user: CommandDefinition<
    DbUserTargetRequest & { password: string },
    void,
    "sensitive"
  >;
  drop_db_user: CommandDefinition<DbUserTargetRequest, void, "sensitive">;
  set_db_user_password: CommandDefinition<
    DbUserTargetRequest & { password: string },
    void,
    "sensitive"
  >;
  apply_db_user_privileges: CommandDefinition<
    DbUserTargetRequest & {
      database: string | null;
      table: string | null;
      privileges: string[];
      grant: boolean;
    },
    void,
    "sensitive"
  >;

  execute_query: CommandDefinition<ExecuteQueryRequest, QueryResult, "database">;
  execute_query_batch: CommandDefinition<
    ExecuteQueryBatchRequest,
    BatchStatementResult[],
    "database"
  >;
  count_query: CommandDefinition<
    MetadataRequest & { query: string },
    number,
    "database"
  >;
  explain_query_plan: CommandDefinition<
    ExplainQueryRequest,
    ExplainQueryOutput,
    "database"
  >;
  cancel_query: CommandDefinition<CancelQueryRequest, void, "database">;
  get_server_now: CommandDefinition<ConnectionIdRequest, string, "database">;

  get_saved_queries: CommandDefinition<ConnectionIdRequest, SavedQuery[], "database">;
  save_query: CommandDefinition<
    ConnectionIdRequest & {
      name: string;
      sql: string;
      database: string | null;
    },
    SavedQuery,
    "database"
  >;
  update_saved_query: CommandDefinition<
    ConnectionIdRequest & {
      id: string;
      name: string;
      sql: string;
      database: string | null;
    },
    SavedQuery,
    "database"
  >;
  delete_saved_query: CommandDefinition<
    ConnectionIdRequest & { id: string },
    void,
    "database"
  >;
  get_query_history: CommandDefinition<
    ConnectionIdRequest,
    QueryHistoryResponse,
    "database"
  >;
  add_query_history_entry: CommandDefinition<
    ConnectionIdRequest & {
      sql: string;
      executedAt: string;
      executionTimeMs: number | null;
      status: "success" | "error";
      rowsAffected: number | null;
      error: string | null;
      database: string | null;
    },
    QueryHistoryEntry,
    "database"
  >;
  delete_query_history_entry: CommandDefinition<
    ConnectionIdRequest & { id: string },
    void,
    "database"
  >;
  clear_query_history: CommandDefinition<ConnectionIdRequest, void, "database">;

  create_notebook: CommandDefinition<NotebookContentRequest, void, "database">;
  save_notebook: CommandDefinition<NotebookContentRequest, void, "database">;
  load_notebook: CommandDefinition<NotebookTargetRequest, string | null, "database">;
  delete_notebook: CommandDefinition<NotebookTargetRequest, void, "database">;
  rename_notebook: CommandDefinition<
    NotebookTargetRequest & { title: string },
    void,
    "database"
  >;
  list_notebooks: CommandDefinition<
    ConnectionIdRequest,
    NotebookMetadata[],
    "database"
  >;

  delete_record: CommandDefinition<RecordIdentityRequest, number, "database">;
  update_record: CommandDefinition<
    RecordIdentityRequest & { colName: string; newVal: unknown },
    number,
    "database"
  >;
  insert_record: CommandDefinition<
    RecordLocator & { data: Record<string, unknown> },
    number,
    "database"
  >;
  fetch_blob: CommandDefinition<BlobColumnRequest, BlobFetchResponse, "database">;
  detect_blob_mime: CommandDefinition<{ base64Data: string }, string, "sensitive">;
  detect_mime_type: CommandDefinition<{ headerBase64: string }, string, "sensitive">;

  cancel_export: CommandDefinition<ConnectionIdRequest, void, "database">;
  export_query_to_file: CommandDefinition<
    QueryExportRequest,
    GeneratedFile | null,
    "database"
  >;
  export_ai_activity_json: CommandDefinition<undefined, string, "sensitive">;
  export_ai_activity_csv: CommandDefinition<undefined, string, "sensitive">;
  export_ai_session_as_notebook: CommandDefinition<
    { sessionId: string },
    AiNotebookExport,
    "sensitive"
  >;
  export_logs: CommandDefinition<
    { filePath?: string },
    GeneratedFile | null,
    "sensitive"
  >;

  set_ai_key: CommandDefinition<
    { provider: string; key: string },
    void,
    "sensitive"
  >;
  delete_ai_key: CommandDefinition<{ provider: string }, void, "sensitive">;
  check_ai_key: CommandDefinition<{ provider: string }, boolean, "sensitive">;
  check_ai_key_status: CommandDefinition<
    { provider: string },
    AiKeyStatus,
    "sensitive"
  >;
  get_ai_models: CommandDefinition<
    { forceRefresh?: boolean } | undefined,
    AiProviderModels,
    "sensitive"
  >;
  generate_ai_query: CommandDefinition<{ req: AiGenerateRequest }, string, "sensitive">;
  explain_ai_query: CommandDefinition<{ req: AiExplainRequest }, string, "sensitive">;
  analyze_ai_explain_plan: CommandDefinition<
    { req: AiExplainRequest },
    string,
    "sensitive"
  >;
  generate_cell_name: CommandDefinition<{ req: AiNameRequest }, string, "sensitive">;
  generate_tab_rename: CommandDefinition<{ req: AiNameRequest }, string, "sensitive">;
  suggest_table_name: CommandDefinition<
    { req: AiTableNameRequest },
    string,
    "sensitive"
  >;
  get_ai_schema_context: CommandDefinition<
    { connectionId: string; schema?: string },
    string,
    "database"
  >;
  get_ai_activity: CommandDefinition<
    { filter?: AiEventFilter } | undefined,
    AiActivityEvent[],
    "sensitive"
  >;
  get_ai_sessions: CommandDefinition<undefined, AiSessionSummary[], "sensitive">;
  get_ai_session_events: CommandDefinition<
    { sessionId: string },
    AiActivityEvent[],
    "sensitive"
  >;
  clear_ai_activity: CommandDefinition<undefined, void, "sensitive">;
  list_pending_approvals: CommandDefinition<
    undefined,
    PendingApproval[],
    "sensitive"
  >;
  decide_pending_approval: CommandDefinition<
    ApprovalDecisionPayload,
    void,
    "sensitive"
  >;

  get_config: CommandDefinition<undefined, PersistedConfig, "local-admin">;
  save_config: CommandDefinition<{ config: PersistedConfig }, void, "local-admin">;
  get_config_json: CommandDefinition<undefined, string, "local-admin">;
  save_config_json: CommandDefinition<{ json: string }, void, "local-admin">;

  get_keybindings: CommandDefinition<undefined, UserOverrides, "local-admin">;
  save_keybindings: CommandDefinition<
    { keybindings: UserOverrides },
    void,
    "local-admin"
  >;

  get_all_themes: CommandDefinition<undefined, Theme[], "local-admin">;
  save_custom_theme: CommandDefinition<{ theme: Theme }, void, "local-admin">;
  delete_custom_theme: CommandDefinition<{ themeId: string }, void, "local-admin">;

  get_system_prompt: CommandDefinition<undefined, string, "local-admin">;
  save_system_prompt: CommandDefinition<{ prompt: string }, void, "local-admin">;
  reset_system_prompt: CommandDefinition<undefined, string, "local-admin">;
  get_explain_prompt: CommandDefinition<undefined, string, "local-admin">;
  save_explain_prompt: CommandDefinition<{ prompt: string }, void, "local-admin">;
  reset_explain_prompt: CommandDefinition<undefined, string, "local-admin">;
  get_explainplan_prompt: CommandDefinition<undefined, string, "local-admin">;
  save_explainplan_prompt: CommandDefinition<{ prompt: string }, void, "local-admin">;
  reset_explainplan_prompt: CommandDefinition<undefined, string, "local-admin">;
  get_cellname_prompt: CommandDefinition<undefined, string, "local-admin">;
  save_cellname_prompt: CommandDefinition<{ prompt: string }, void, "local-admin">;
  reset_cellname_prompt: CommandDefinition<undefined, string, "local-admin">;
  get_tabrename_prompt: CommandDefinition<undefined, string, "local-admin">;
  save_tabrename_prompt: CommandDefinition<{ prompt: string }, void, "local-admin">;
  reset_tabrename_prompt: CommandDefinition<undefined, string, "local-admin">;

  load_editor_preferences: CommandDefinition<
    ConnectionIdRequest,
    EditorPreferences | null,
    "database"
  >;
  save_editor_preferences: CommandDefinition<
    ConnectionIdRequest & { preferences: EditorPreferences },
    void,
    "database"
  >;
  delete_editor_preferences: CommandDefinition<ConnectionIdRequest, void, "database">;

  get_last_active_connection: CommandDefinition<undefined, string | null, "session">;
  set_last_active_connection: CommandDefinition<
    { connectionId: string | null },
    void,
    "session"
  >;
  get_last_open_connections: CommandDefinition<undefined, string[], "session">;
  set_last_open_connections: CommandDefinition<
    { connectionIds: string[] },
    void,
    "session"
  >;
}

export type CommandName = keyof CommandMap;
export type CommandRequest<K extends CommandName> = CommandMap[K]["request"];
export type CommandResponse<K extends CommandName> = CommandMap[K]["response"];
export type CommandAuthorization<K extends CommandName> =
  CommandMap[K]["authorization"];

export interface CommandCallOptions {
  requestId?: RequestId;
  deadlineMs?: number;
  cancellationId?: string;
}

export interface UnmigratedCommandTracking {
  task: `WEB-${number}`;
  callSite: `${string}:${number}`;
  reason: string;
}

export interface TypedCommandCaller {
  call<K extends CommandName>(
    command: K,
    request: CommandRequest<K>,
    options?: CommandCallOptions,
  ): Promise<CommandResponse<K>>;

  /**
   * Temporary escape hatch for commands that are not in CommandMap yet.
   * The unknown result must be narrowed by the caller, and mandatory metadata
   * keeps every use searchable until its owning migration task removes it.
   */
  callUnmigrated<K extends string>(
    command: K extends CommandName ? never : K,
    request: unknown,
    tracking: UnmigratedCommandTracking,
    options?: CommandCallOptions,
  ): Promise<unknown>;
}
