use super::*;
use async_trait::async_trait;
use axum::body::to_bytes;
use axum::http::header::CONTENT_TYPE;
use axum::http::HeaderValue;
use uuid::Uuid;

struct FixtureApplication {
    delay: Duration,
    contexts: Arc<Mutex<Vec<ApplicationRequestContext>>>,
}

impl FixtureApplication {
    fn new(delay: Duration) -> Self {
        Self {
            delay,
            contexts: Arc::new(Mutex::new(Vec::new())),
        }
    }

    async fn record(&self, context: ApplicationRequestContext) {
        self.contexts
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push(context);
        tokio::time::sleep(self.delay).await;
    }
}

#[async_trait]
impl ApplicationApi for FixtureApplication {
    fn clear_session(&self, _session_id: uuid::Uuid) {}

    async fn is_debug_mode(
        &self,
        context: ApplicationRequestContext,
    ) -> Result<bool, ApplicationError> {
        self.record(context).await;
        Ok(true)
    }

    async fn get_connections(
        &self,
        context: ApplicationRequestContext,
    ) -> Result<Vec<crate::models::SavedConnection>, ApplicationError> {
        self.record(context).await;
        Ok(Vec::new())
    }

    async fn cancel_query(
        &self,
        context: ApplicationRequestContext,
        _connection_id: String,
        query_request_id: Option<String>,
    ) -> Result<(), ApplicationError> {
        self.record(context).await;
        if query_request_id.is_some() {
            Ok(())
        } else {
            Err(ApplicationError::new("No running query found"))
        }
    }

    async fn execute_query_command(
        &self,
        context: ApplicationRequestContext,
        _command: QueryCommand,
    ) -> Result<Value, ApplicationError> {
        self.record(context).await;
        Ok(Value::Null)
    }

    async fn execute_connection_command(
        &self,
        context: ApplicationRequestContext,
        _command: ConnectionCommand,
    ) -> Result<Value, ApplicationError> {
        self.record(context).await;
        Ok(Value::Null)
    }

    async fn execute_connection_files_command(
        &self,
        context: ApplicationRequestContext,
        command: crate::application::connection_files::ConnectionFilesCommand,
    ) -> Result<Value, ApplicationError> {
        self.record(context).await;
        Ok(match command {
            crate::application::connection_files::ConnectionFilesCommand::ListImportSources => {
                serde_json::json!([])
            }
            crate::application::connection_files::ConnectionFilesCommand::GetBackupStatus => {
                serde_json::json!({
                    "passwordSet": true,
                    "targetPasswordSet": true,
                    "lastBackupAt": null,
                    "targetKind": "serverDirectory",
                    "targetDisplay": "/srv/tabularis/backups"
                })
            }
            _ => Value::Null,
        })
    }

    async fn execute_database_transfer_command(
        &self,
        context: ApplicationRequestContext,
        command: crate::application::database_transfers::DatabaseTransferCommand,
    ) -> Result<Value, ApplicationError> {
        self.record(context).await;
        Ok(match command {
            crate::application::database_transfers::DatabaseTransferCommand::Dump { .. } => {
                serde_json::json!({
                    "kind": "download",
                    "fileName": "fixture.sql",
                    "mimeType": "application/sql",
                    "token": "fixture-download-token",
                    "size": 128
                })
            }
            _ => Value::Null,
        })
    }

    async fn execute_metadata_command(
        &self,
        context: ApplicationRequestContext,
        _command: MetadataCommand,
    ) -> Result<Value, ApplicationError> {
        self.record(context).await;
        Ok(Value::Null)
    }

    async fn execute_database_object_command(
        &self,
        context: ApplicationRequestContext,
        _command: DatabaseObjectCommand,
    ) -> Result<Value, ApplicationError> {
        self.record(context).await;
        Ok(Value::Null)
    }

    async fn execute_record_command(
        &self,
        context: ApplicationRequestContext,
        command: RecordCommand,
    ) -> Result<Value, ApplicationError> {
        self.record(context).await;
        Ok(match command {
            RecordCommand::Insert { .. }
            | RecordCommand::Update { .. }
            | RecordCommand::Delete { .. } => serde_json::json!(1),
            RecordCommand::FetchBlob { .. } => serde_json::json!({
                "kind": "inline",
                "wireValue": "BLOB:4:application/octet-stream:AAECAw=="
            }),
            RecordCommand::DetectBlobMime { .. } => {
                serde_json::json!("BLOB:4:application/octet-stream:AAECAw==")
            }
            RecordCommand::DetectMimeType { .. } => {
                serde_json::json!("application/octet-stream")
            }
        })
    }

    async fn execute_tunnel_command(
        &self,
        context: ApplicationRequestContext,
        _command: TunnelCommand,
    ) -> Result<Value, ApplicationError> {
        self.record(context).await;
        Ok(Value::Null)
    }

    async fn execute_persistence_command(
        &self,
        context: ApplicationRequestContext,
        command: crate::application::persistence::PersistenceCommand,
    ) -> Result<Value, ApplicationError> {
        self.record(context).await;
        Ok(match command {
            crate::application::persistence::PersistenceCommand::GetConfig => {
                serde_json::json!({"theme": "tabularis-dark"})
            }
            crate::application::persistence::PersistenceCommand::GetKeybindings => {
                serde_json::json!({})
            }
            crate::application::persistence::PersistenceCommand::GetAllThemes => {
                serde_json::json!([])
            }
            crate::application::persistence::PersistenceCommand::GetPrompt(_)
            | crate::application::persistence::PersistenceCommand::ResetPrompt(_) => {
                serde_json::json!("Generate SQL only")
            }
            crate::application::persistence::PersistenceCommand::LoadEditorPreferences(_) => {
                Value::Null
            }
            crate::application::persistence::PersistenceCommand::GetLastActiveConnection => {
                Value::Null
            }
            crate::application::persistence::PersistenceCommand::GetLastOpenConnections => {
                serde_json::json!([])
            }
            _ => Value::Null,
        })
    }

    async fn execute_productivity_command(
        &self,
        context: ApplicationRequestContext,
        _command: crate::application::productivity::ProductivityCommand,
    ) -> Result<Value, ApplicationError> {
        self.record(context).await;
        Ok(Value::Null)
    }

    async fn execute_notebook_command(
        &self,
        context: ApplicationRequestContext,
        command: crate::application::notebooks::NotebookCommand,
    ) -> Result<Value, ApplicationError> {
        self.record(context).await;
        Ok(match command {
            crate::application::notebooks::NotebookCommand::Load { .. } => {
                serde_json::json!("{}")
            }
            crate::application::notebooks::NotebookCommand::List { .. } => {
                serde_json::json!([])
            }
            _ => Value::Null,
        })
    }
}

fn json_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers
}

async fn response_json(response: Response) -> Value {
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&body).unwrap()
}

#[tokio::test]
async fn preserves_shared_serialization_fixture_in_success_envelopes() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../../packages/web-ui/tests/fixtures/transportSerialization.json"
    ))
    .unwrap();

    let body = response_json(success(fixture.clone())).await;

    assert_eq!(body, serde_json::json!({ "ok": true, "data": fixture }));
    assert_eq!(
        body["data"]["rows"][0][1],
        "BLOB:4:application/octet-stream:AAECAw=="
    );
    assert_eq!(body["data"]["rows"][0][2], "12345678901234567890.123456789");
    assert_eq!(body["data"]["rows"][0][3], "2026-08-21T19:20:21.123Z");
    assert!(body["data"]["rows"][0][4].is_null());
}

#[test]
fn declares_authorization_for_each_registered_command() {
    assert_eq!(
        RpcCommand::IsDebugMode.metadata().authorization,
        AuthorizationLevel::LocalAdmin
    );
    assert_eq!(
        RpcCommand::GetConnections.metadata().authorization,
        AuthorizationLevel::Database
    );
    assert_eq!(
        RpcCommand::CancelQuery.metadata().authorization,
        AuthorizationLevel::Database
    );
    for command in [
        ConnectionFilesRpcCommand::Export,
        ConnectionFilesRpcCommand::PreviewTabularisImport,
        ConnectionFilesRpcCommand::ApplyPreparedTabularisImport,
        ConnectionFilesRpcCommand::SetBackupPassword,
        ConnectionFilesRpcCommand::SetBackupTargetPassword,
        ConnectionFilesRpcCommand::RunBackup,
    ] {
        assert_eq!(
            RpcCommand::ConnectionFiles(command)
                .metadata()
                .authorization,
            AuthorizationLevel::Sensitive,
            "{command:?}",
        );
    }
    for command in [
        ConnectionFilesRpcCommand::ListImportSources,
        ConnectionFilesRpcCommand::PreviewForeignImport,
        ConnectionFilesRpcCommand::ApplyForeignImport,
        ConnectionFilesRpcCommand::GetBackupStatus,
    ] {
        assert_eq!(
            RpcCommand::ConnectionFiles(command)
                .metadata()
                .authorization,
            AuthorizationLevel::LocalAdmin,
            "{command:?}",
        );
    }
    for command in [
        DatabaseTransferRpcCommand::Dump,
        DatabaseTransferRpcCommand::CancelDump,
        DatabaseTransferRpcCommand::Import,
        DatabaseTransferRpcCommand::CancelImport,
    ] {
        assert_eq!(
            RpcCommand::DatabaseTransfer(command)
                .metadata()
                .authorization,
            AuthorizationLevel::Sensitive,
            "{command:?}",
        );
    }
    assert_eq!(
        RpcCommand::Metadata(MetadataRpcCommand::GetTables)
            .metadata()
            .authorization,
        AuthorizationLevel::Database
    );
    assert_eq!(
        RpcCommand::Query(QueryRpcCommand::Execute)
            .metadata()
            .authorization,
        AuthorizationLevel::Database
    );
    assert_eq!(
        RpcCommand::Record(RecordRpcCommand::Update)
            .metadata()
            .authorization,
        AuthorizationLevel::Database
    );
    assert_eq!(
        RpcCommand::Record(RecordRpcCommand::DetectMimeType)
            .metadata()
            .authorization,
        AuthorizationLevel::Sensitive
    );
    assert_eq!(
        RpcCommand::DatabaseObject(DatabaseObjectRpcCommand::CreateView)
            .metadata()
            .authorization,
        AuthorizationLevel::Database
    );
    for command in [
        DatabaseObjectRpcCommand::GetDbPrivilegeCatalog,
        DatabaseObjectRpcCommand::GetDbUsers,
        DatabaseObjectRpcCommand::GetDbUserGrants,
        DatabaseObjectRpcCommand::GetDbUserPrivileges,
        DatabaseObjectRpcCommand::CreateDbUser,
        DatabaseObjectRpcCommand::DropDbUser,
        DatabaseObjectRpcCommand::SetDbUserPassword,
        DatabaseObjectRpcCommand::ApplyDbUserPrivileges,
    ] {
        assert_eq!(
            RpcCommand::DatabaseObject(command).metadata().authorization,
            AuthorizationLevel::Sensitive,
            "{command:?}",
        );
    }
    assert_eq!(
        RpcCommand::Tunnel(TunnelRpcCommand::GetSshConnections)
            .metadata()
            .authorization,
        AuthorizationLevel::LocalAdmin
    );
    assert_eq!(
        RpcCommand::Tunnel(TunnelRpcCommand::RespondSshAskpass)
            .metadata()
            .authorization,
        AuthorizationLevel::Sensitive
    );
}

#[test]
fn registers_notebook_commands_with_database_authorization() {
    for name in [
        "create_notebook",
        "save_notebook",
        "load_notebook",
        "delete_notebook",
        "rename_notebook",
        "list_notebooks",
    ] {
        let command = RpcCommand::parse(name).unwrap_or_else(|| panic!("missing {name}"));
        assert_eq!(
            command.metadata().authorization,
            AuthorizationLevel::Database,
            "{name}",
        );
    }
}

#[test]
fn registers_saved_query_and_history_commands_with_database_authorization() {
    for name in [
        "get_saved_queries",
        "save_query",
        "update_saved_query",
        "delete_saved_query",
        "get_query_history",
        "add_query_history_entry",
        "delete_query_history_entry",
        "clear_query_history",
    ] {
        let command = RpcCommand::parse(name).unwrap_or_else(|| panic!("missing {name}"));
        assert_eq!(
            command.metadata().authorization,
            AuthorizationLevel::Database,
            "{name}",
        );
    }
}

#[test]
fn registers_every_settings_and_preference_command_with_explicit_authorization() {
    let local_admin_commands = [
        "get_config",
        "save_config",
        "get_config_json",
        "save_config_json",
        "get_keybindings",
        "save_keybindings",
        "get_all_themes",
        "save_custom_theme",
        "delete_custom_theme",
        "get_system_prompt",
        "save_system_prompt",
        "reset_system_prompt",
        "get_explain_prompt",
        "save_explain_prompt",
        "reset_explain_prompt",
        "get_explainplan_prompt",
        "save_explainplan_prompt",
        "reset_explainplan_prompt",
        "get_cellname_prompt",
        "save_cellname_prompt",
        "reset_cellname_prompt",
        "get_tabrename_prompt",
        "save_tabrename_prompt",
        "reset_tabrename_prompt",
    ];
    for name in local_admin_commands {
        let command = RpcCommand::parse(name).unwrap_or_else(|| panic!("missing {name}"));
        assert_eq!(
            command.metadata().authorization,
            AuthorizationLevel::LocalAdmin
        );
    }

    for name in [
        "load_editor_preferences",
        "save_editor_preferences",
        "delete_editor_preferences",
    ] {
        let command = RpcCommand::parse(name).unwrap_or_else(|| panic!("missing {name}"));
        assert_eq!(
            command.metadata().authorization,
            AuthorizationLevel::Database
        );
    }

    for name in [
        "get_last_active_connection",
        "set_last_active_connection",
        "get_last_open_connections",
        "set_last_open_connections",
    ] {
        let command = RpcCommand::parse(name).unwrap_or_else(|| panic!("missing {name}"));
        assert_eq!(
            command.metadata().authorization,
            AuthorizationLevel::Session
        );
    }
}

#[tokio::test]
async fn routes_connection_file_commands_through_the_shared_application_api() {
    let dispatcher = RpcDispatcher::new(Arc::new(FixtureApplication::new(Duration::ZERO)));
    let resolution = serde_json::json!({"index": 0, "action": "import", "groupId": ""});
    let file = serde_json::json!({"kind": "upload", "token": Uuid::new_v4().to_string()});
    let commands = [
        (
            "export_connections_file",
            serde_json::json!({"mode": "encrypted", "password": "secret"}),
        ),
        ("list_connection_import_sources", Value::Null),
        (
            "preview_connection_import",
            serde_json::json!({
                "sourceId": "dbeaver",
                "includePasswords": false,
                "file": file.clone()
            }),
        ),
        (
            "apply_connection_import",
            serde_json::json!({"sourceId": "dbeaver", "resolutions": [resolution.clone()]}),
        ),
        (
            "preview_tabularis_import_file",
            serde_json::json!({"file": file, "password": "secret"}),
        ),
        (
            "apply_prepared_tabularis_import",
            serde_json::json!({"resolutions": [resolution]}),
        ),
        ("get_connections_backup_status", Value::Null),
        (
            "set_connections_backup_password",
            serde_json::json!({"password": "secret"}),
        ),
        (
            "set_connections_backup_target_password",
            serde_json::json!({"targetId": "webdav", "password": "secret"}),
        ),
        ("run_connections_backup", Value::Null),
    ];

    for (command, payload) in commands {
        let response = dispatcher
            .dispatch(
                command,
                RequestId(format!("request-{command}")),
                &json_headers(),
                Bytes::from(serde_json::to_vec(&payload).unwrap()),
                Some(Uuid::new_v4()),
            )
            .await;
        assert_eq!(response.status(), StatusCode::OK, "{command}");
    }
}

#[tokio::test]
async fn routes_database_transfer_jobs_through_the_shared_application_api() {
    let dispatcher = RpcDispatcher::new(Arc::new(FixtureApplication::new(Duration::ZERO)));
    let session_id = Some(Uuid::new_v4());
    let commands = [
        (
            "dump_database",
            serde_json::json!({
                "connectionId": "connection-1",
                "options": {"structure": true, "data": true, "tables": ["users"]},
                "schema": "public"
            }),
        ),
        (
            "import_database",
            serde_json::json!({
                "connectionId": "connection-1",
                "uploadToken": Uuid::new_v4().to_string(),
                "schema": "public"
            }),
        ),
        (
            "cancel_dump",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
        (
            "cancel_import",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
    ];

    for (command, payload) in commands {
        let response = dispatcher
            .dispatch(
                command,
                RequestId(format!("request-{command}")),
                &json_headers(),
                Bytes::from(serde_json::to_vec(&payload).unwrap()),
                session_id,
            )
            .await;
        assert_eq!(response.status(), StatusCode::OK, "{command}");
    }
}

#[tokio::test]
async fn routes_all_metadata_commands_through_the_shared_application_api() {
    let dispatcher = RpcDispatcher::new(Arc::new(FixtureApplication::new(Duration::ZERO)));
    let commands = [
        (
            "get_available_databases",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
        (
            "get_schemas",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
        (
            "get_tables",
            serde_json::json!({"connectionId": "connection-1", "schema": "public"}),
        ),
        (
            "get_columns",
            serde_json::json!({"connectionId": "connection-1", "tableName": "users"}),
        ),
        (
            "get_foreign_keys",
            serde_json::json!({"connectionId": "connection-1", "tableName": "users"}),
        ),
        (
            "get_indexes",
            serde_json::json!({"connectionId": "connection-1", "tableName": "users"}),
        ),
        (
            "get_views",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
        (
            "get_view_columns",
            serde_json::json!({"connectionId": "connection-1", "viewName": "users_view"}),
        ),
        (
            "get_materialized_views",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
        (
            "get_materialized_view_columns",
            serde_json::json!({"connectionId": "connection-1", "viewName": "users_view"}),
        ),
        (
            "get_materialized_view_definition",
            serde_json::json!({"connectionId": "connection-1", "viewName": "users_view"}),
        ),
        (
            "get_routines",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
        (
            "get_triggers",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
        (
            "get_schema_snapshot",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
        (
            "get_selected_schemas",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
        (
            "set_selected_schemas",
            serde_json::json!({"connectionId": "connection-1", "schemas": ["public"]}),
        ),
        (
            "get_schema_preference",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
        (
            "set_schema_preference",
            serde_json::json!({"connectionId": "connection-1", "schema": "public"}),
        ),
    ];

    for (command, payload) in commands {
        let response = dispatcher
            .dispatch(
                command,
                RequestId(format!("request-{command}")),
                &json_headers(),
                Bytes::from(serde_json::to_vec(&payload).unwrap()),
                None,
            )
            .await;
        assert_eq!(response.status(), StatusCode::OK, "{command}");
    }
}

#[tokio::test]
async fn routes_database_object_commands_through_the_shared_application_api() {
    let dispatcher = RpcDispatcher::new(Arc::new(FixtureApplication::new(Duration::ZERO)));
    let connection = "connection-1";
    let user = serde_json::json!({"connectionId": connection, "user": "app", "host": "%"});
    let commands = [
        (
            "get_view_definition",
            serde_json::json!({"connectionId": connection, "viewName": "active_users"}),
        ),
        (
            "create_view",
            serde_json::json!({"connectionId": connection, "viewName": "active_users", "definition": "SELECT 1"}),
        ),
        (
            "alter_view",
            serde_json::json!({"connectionId": connection, "viewName": "active_users", "definition": "SELECT 2"}),
        ),
        (
            "drop_view",
            serde_json::json!({"connectionId": connection, "viewName": "active_users"}),
        ),
        (
            "refresh_materialized_view",
            serde_json::json!({"connectionId": connection, "viewName": "active_users"}),
        ),
        (
            "get_routine_parameters",
            serde_json::json!({"connectionId": connection, "routineName": "refresh_users"}),
        ),
        (
            "get_routine_definition",
            serde_json::json!({"connectionId": connection, "routineName": "refresh_users", "routineType": "FUNCTION"}),
        ),
        (
            "build_routine_call_sql",
            serde_json::json!({"connectionId": connection, "routineName": "refresh_users", "routineType": "FUNCTION", "args": []}),
        ),
        (
            "get_routine_create_template",
            serde_json::json!({"connectionId": connection, "routineType": "FUNCTION"}),
        ),
        (
            "get_routine_edit_script",
            serde_json::json!({"connectionId": connection, "routineName": "refresh_users", "routineType": "FUNCTION"}),
        ),
        (
            "drop_routine",
            serde_json::json!({"connectionId": connection, "routineName": "refresh_users", "routineType": "FUNCTION"}),
        ),
        (
            "get_trigger_definition",
            serde_json::json!({"connectionId": connection, "triggerName": "audit_users", "tableName": "users"}),
        ),
        (
            "create_trigger",
            serde_json::json!({"connectionId": connection, "triggerSql": "CREATE TRIGGER audit_users"}),
        ),
        (
            "drop_trigger",
            serde_json::json!({"connectionId": connection, "triggerName": "audit_users", "tableName": "users"}),
        ),
        (
            "get_create_table_sql",
            serde_json::json!({"connectionId": connection, "tableName": "users", "columns": []}),
        ),
        (
            "get_add_column_sql",
            serde_json::json!({"connectionId": connection, "table": "users", "column": column_fixture("email")}),
        ),
        (
            "get_alter_column_sql",
            serde_json::json!({"connectionId": connection, "table": "users", "oldColumn": column_fixture("email"), "newColumn": column_fixture("address")}),
        ),
        (
            "get_create_index_sql",
            serde_json::json!({"connectionId": connection, "table": "users", "indexName": "idx_users", "columns": ["email"], "isUnique": true}),
        ),
        (
            "get_create_foreign_key_sql",
            serde_json::json!({"connectionId": connection, "table": "users", "fkName": "fk_users_org", "column": "org_id", "refTable": "orgs", "refColumn": "id"}),
        ),
        (
            "drop_index_action",
            serde_json::json!({"connectionId": connection, "table": "users", "indexName": "idx_users"}),
        ),
        (
            "drop_foreign_key_action",
            serde_json::json!({"connectionId": connection, "table": "users", "fkName": "fk_users_org"}),
        ),
        (
            "get_db_privilege_catalog",
            serde_json::json!({"connectionId": connection}),
        ),
        (
            "get_db_users",
            serde_json::json!({"connectionId": connection}),
        ),
        ("get_db_user_grants", user.clone()),
        ("get_db_user_privileges", user.clone()),
        (
            "create_db_user",
            serde_json::json!({"connectionId": connection, "user": "app", "host": "%", "password": "secret"}),
        ),
        ("drop_db_user", user.clone()),
        (
            "set_db_user_password",
            serde_json::json!({"connectionId": connection, "user": "app", "host": "%", "password": "secret"}),
        ),
        (
            "apply_db_user_privileges",
            serde_json::json!({"connectionId": connection, "user": "app", "host": "%", "database": "app_db", "table": null, "privileges": ["SELECT"], "grant": true}),
        ),
    ];

    for (command, payload) in commands {
        let response = dispatcher
            .dispatch(
                command,
                RequestId(format!("request-{command}")),
                &json_headers(),
                Bytes::from(serde_json::to_vec(&payload).unwrap()),
                Some(uuid::Uuid::new_v4()),
            )
            .await;
        assert_eq!(response.status(), StatusCode::OK, "{command}");
    }
}

fn column_fixture(name: &str) -> Value {
    serde_json::json!({
        "name": name,
        "data_type": "TEXT",
        "is_nullable": true,
        "is_pk": false,
        "is_auto_increment": false,
        "default_value": null
    })
}

#[tokio::test]
async fn routes_query_execution_commands_through_the_shared_application_api() {
    let dispatcher = RpcDispatcher::new(Arc::new(FixtureApplication::new(Duration::ZERO)));
    let commands = [
        (
            "execute_query",
            serde_json::json!({
                "connectionId": "connection-1",
                "query": "SELECT 1",
                "limit": 100,
                "page": 1
            }),
        ),
        (
            "execute_query_batch",
            serde_json::json!({
                "connectionId": "connection-1",
                "queries": ["SELECT 1"],
                "limit": 100,
                "page": 1,
                "batchId": "batch-1"
            }),
        ),
        (
            "count_query",
            serde_json::json!({"connectionId": "connection-1", "query": "SELECT 1"}),
        ),
        (
            "explain_query_plan",
            serde_json::json!({
                "connectionId": "connection-1",
                "query": "SELECT 1",
                "analyze": false
            }),
        ),
        (
            "get_server_now",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
    ];

    for (command, payload) in commands {
        let response = dispatcher
            .dispatch(
                command,
                RequestId(format!("request-{command}")),
                &json_headers(),
                Bytes::from(serde_json::to_vec(&payload).unwrap()),
                Some(uuid::Uuid::new_v4()),
            )
            .await;
        assert_eq!(response.status(), StatusCode::OK, "{command}");
    }
}

#[tokio::test]
async fn routes_notebook_commands_through_the_shared_application_api() {
    let dispatcher = RpcDispatcher::new(Arc::new(FixtureApplication::new(Duration::ZERO)));
    let target = serde_json::json!({
        "connectionId": "connection-1",
        "notebookId": "notebook-1"
    });
    let commands = [
        (
            "create_notebook",
            serde_json::json!({
                "connectionId": "connection-1",
                "notebookId": "notebook-1",
                "content": "{}"
            }),
        ),
        (
            "save_notebook",
            serde_json::json!({
                "connectionId": "connection-1",
                "notebookId": "notebook-1",
                "content": "{}"
            }),
        ),
        ("load_notebook", target.clone()),
        ("delete_notebook", target),
        (
            "rename_notebook",
            serde_json::json!({
                "connectionId": "connection-1",
                "notebookId": "notebook-1",
                "title": "Renamed"
            }),
        ),
        (
            "list_notebooks",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
    ];

    for (command, payload) in commands {
        let response = dispatcher
            .dispatch(
                command,
                RequestId(format!("request-{command}")),
                &json_headers(),
                Bytes::from(serde_json::to_vec(&payload).unwrap()),
                Some(uuid::Uuid::new_v4()),
            )
            .await;
        assert_eq!(response.status(), StatusCode::OK, "{command}");
    }
}

#[tokio::test]
async fn routes_data_editing_and_blob_commands_through_the_shared_application_api() {
    let dispatcher = RpcDispatcher::new(Arc::new(FixtureApplication::new(Duration::ZERO)));
    let session_id = uuid::Uuid::new_v4();
    let commands = [
        (
            "insert_record",
            serde_json::json!({
                "connectionId": "connection-1",
                "table": "files",
                "data": {"id": 1, "payload": null}
            }),
        ),
        (
            "update_record",
            serde_json::json!({
                "connectionId": "connection-1",
                "table": "files",
                "pkMap": {"id": 1},
                "colName": "payload",
                "newVal": "BLOB_UPLOAD_REF:4:application/octet-stream:00000000-0000-4000-8000-000000000000"
            }),
        ),
        (
            "delete_record",
            serde_json::json!({
                "connectionId": "connection-1",
                "table": "files",
                "pkMap": {"id": 1}
            }),
        ),
        (
            "fetch_blob",
            serde_json::json!({
                "connectionId": "connection-1",
                "table": "files",
                "pkMap": {"id": 1},
                "colName": "payload"
            }),
        ),
        (
            "detect_blob_mime",
            serde_json::json!({"base64Data": "AAECAw=="}),
        ),
        (
            "detect_mime_type",
            serde_json::json!({"headerBase64": "AAECAw=="}),
        ),
    ];

    for (command, payload) in commands {
        let response = dispatcher
            .dispatch(
                command,
                RequestId(format!("request-{command}")),
                &json_headers(),
                Bytes::from(serde_json::to_vec(&payload).unwrap()),
                Some(session_id),
            )
            .await;
        assert_eq!(response.status(), StatusCode::OK, "{command}");
    }
}

#[tokio::test]
async fn routes_settings_and_preferences_through_the_shared_application_api() {
    let dispatcher = RpcDispatcher::new(Arc::new(FixtureApplication::new(Duration::ZERO)));
    let commands = [
        ("get_config", serde_json::Value::Null),
        (
            "save_config",
            serde_json::json!({"config": {"language": "en", "resultPageSize": 250}}),
        ),
        ("get_keybindings", serde_json::Value::Null),
        (
            "save_keybindings",
            serde_json::json!({"keybindings": {"editor.run": {}}}),
        ),
        ("get_all_themes", serde_json::Value::Null),
        ("get_system_prompt", serde_json::Value::Null),
        (
            "save_system_prompt",
            serde_json::json!({"prompt": "Generate safe SQL"}),
        ),
        ("reset_system_prompt", serde_json::Value::Null),
        (
            "load_editor_preferences",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
        (
            "save_editor_preferences",
            serde_json::json!({
                "connectionId": "connection-1",
                "preferences": {"tabs": [], "active_tab_id": null}
            }),
        ),
        ("get_last_open_connections", serde_json::Value::Null),
        (
            "set_last_active_connection",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
    ];

    for (command, payload) in commands {
        let response = dispatcher
            .dispatch(
                command,
                RequestId(format!("request-{command}")),
                &json_headers(),
                Bytes::from(serde_json::to_vec(&payload).unwrap()),
                Some(uuid::Uuid::new_v4()),
            )
            .await;
        assert_eq!(response.status(), StatusCode::OK, "{command}");
    }
}

#[tokio::test]
async fn rejects_invalid_payloads_with_a_stable_error_envelope() {
    let dispatcher = RpcDispatcher::new(Arc::new(FixtureApplication::new(Duration::ZERO)));
    let response = dispatcher
        .dispatch(
            "cancel_query",
            RequestId("request-invalid".to_string()),
            &json_headers(),
            Bytes::from_static(br#"{"unknown":true}"#),
            None,
        )
        .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = response_json(response).await;
    assert_eq!(body["ok"], false);
    assert_eq!(body["error"]["code"], "INVALID_REQUEST");
    assert_eq!(body["error"]["details"], Value::Null);
    assert_eq!(body["error"]["requestId"], "request-invalid");
    assert!(body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("unknown field `unknown`"));
}

#[tokio::test]
async fn enforces_deadlines_and_releases_cancellation_identifiers() {
    let application = Arc::new(FixtureApplication::new(Duration::from_millis(40)));
    let dispatcher = RpcDispatcher::new(application.clone());
    let mut deadline_headers = json_headers();
    deadline_headers.insert(RPC_DEADLINE_HEADER_NAME, HeaderValue::from_static("1"));
    deadline_headers.insert(
        RPC_CANCELLATION_HEADER_NAME,
        HeaderValue::from_static("query-1"),
    );

    let timeout = dispatcher
        .dispatch(
            "is_debug_mode",
            RequestId("request-timeout".to_string()),
            &deadline_headers,
            Bytes::from_static(b"null"),
            None,
        )
        .await;
    assert_eq!(timeout.status(), StatusCode::GATEWAY_TIMEOUT);
    assert_eq!(
        response_json(timeout).await["error"]["code"],
        "DEADLINE_EXCEEDED"
    );

    let retry = dispatcher
        .dispatch(
            "is_debug_mode",
            RequestId("request-retry".to_string()),
            &json_headers_with_cancellation("query-1"),
            Bytes::from_static(b"null"),
            None,
        )
        .await;
    assert_eq!(retry.status(), StatusCode::OK);

    let contexts = application
        .contexts
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    assert_eq!(contexts.len(), 2);
    assert_eq!(contexts[0].request_id, "request-timeout");
    assert_eq!(contexts[0].cancellation_id.as_deref(), Some("query-1"));
    assert_eq!(contexts[0].authorization, AuthorizationLevel::LocalAdmin);
    assert!(contexts[0].deadline <= Instant::now());
}

#[tokio::test]
async fn rejects_duplicate_active_cancellation_identifiers() {
    let dispatcher =
        RpcDispatcher::new(Arc::new(FixtureApplication::new(Duration::from_millis(40))));
    let first_dispatcher = dispatcher.clone();
    let first = tokio::spawn(async move {
        first_dispatcher
            .dispatch(
                "is_debug_mode",
                RequestId("request-first".to_string()),
                &json_headers_with_cancellation("shared"),
                Bytes::from_static(b"null"),
                None,
            )
            .await
    });
    tokio::time::sleep(Duration::from_millis(5)).await;

    let duplicate = dispatcher
        .dispatch(
            "is_debug_mode",
            RequestId("request-duplicate".to_string()),
            &json_headers_with_cancellation("shared"),
            Bytes::from_static(b"null"),
            None,
        )
        .await;
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(duplicate).await["error"]["code"],
        "CANCELLATION_ID_IN_USE"
    );
    assert_eq!(first.await.unwrap().status(), StatusCode::OK);
}

#[tokio::test]
async fn scopes_active_cancellation_identifiers_to_browser_sessions() {
    let dispatcher =
        RpcDispatcher::new(Arc::new(FixtureApplication::new(Duration::from_millis(20))));
    let session_a = uuid::Uuid::new_v4();
    let session_b = uuid::Uuid::new_v4();
    let first_dispatcher = dispatcher.clone();
    let first = tokio::spawn(async move {
        first_dispatcher
            .dispatch(
                "is_debug_mode",
                RequestId("request-session-a".to_string()),
                &json_headers_with_cancellation("shared"),
                Bytes::from_static(b"null"),
                Some(session_a),
            )
            .await
    });
    tokio::time::sleep(Duration::from_millis(5)).await;

    let second = dispatcher
        .dispatch(
            "is_debug_mode",
            RequestId("request-session-b".to_string()),
            &json_headers_with_cancellation("shared"),
            Bytes::from_static(b"null"),
            Some(session_b),
        )
        .await;

    assert_eq!(second.status(), StatusCode::OK);
    assert_eq!(first.await.unwrap().status(), StatusCode::OK);
}

fn json_headers_with_cancellation(id: &str) -> HeaderMap {
    let mut headers = json_headers();
    headers.insert(
        RPC_CANCELLATION_HEADER_NAME,
        HeaderValue::from_str(id).unwrap(),
    );
    headers
}
