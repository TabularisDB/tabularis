import type {
  ConnectionAppearance,
  ConnectionGroup,
  ConnectionsFile,
  SavedConnection,
  TableInfo,
} from "../contexts/DatabaseContext";
import type { PluginManifest } from "../types/plugins";
import type { ConnectionTag } from "../types/tags";
import type {
  BatchStatementResult,
  QueryResult,
  TableColumn,
  TableSchema,
} from "../types/editor";
import type { Index } from "../types/schema";
import type { RequestId } from "./errors";

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

interface MetadataRequest extends ConnectionIdRequest {
  schema?: string;
}

interface TableMetadataRequest extends MetadataRequest {
  tableName: string;
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

export interface CommandMap {
  is_debug_mode: CommandDefinition<undefined, boolean, "local-admin">;
  get_installation_source: CommandDefinition<
    undefined,
    string | null,
    "local-admin"
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

  test_connection: CommandDefinition<
    { request: TestConnectionRequest },
    string,
    "database"
  >;
  disconnect_connection: CommandDefinition<ConnectionIdRequest, void, "database">;

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
  get_indexes: CommandDefinition<TableMetadataRequest, Index[], "database">;
  get_schema_snapshot: CommandDefinition<
    MetadataRequest,
    TableSchema[],
    "database"
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
  cancel_query: CommandDefinition<ConnectionIdRequest, void, "database">;
  get_server_now: CommandDefinition<ConnectionIdRequest, string, "database">;
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
