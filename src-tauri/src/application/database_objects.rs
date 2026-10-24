use crate::drivers::driver_trait::DatabaseDriver;
use crate::models::{
    ColumnDefinition, ConnectionParams, DbPrivilegeCatalog, DbUserGrantSet, DbUserInfo,
    RoutineCallArg, RoutineParameter,
};
use crate::runtime::RuntimeContext;
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug)]
pub enum DatabaseObjectCommand {
    GetTableQueryTemplate {
        connection_id: String,
        request: crate::models::TableQueryTemplateRequest,
        database: Option<String>,
    },
    GetColumnStats {
        connection_id: String,
        request: crate::models::ColumnStatsRequest,
        database: Option<String>,
    },
    GetDropTableSql {
        connection_id: String,
        table: String,
        schema: Option<String>,
        database: Option<String>,
    },
    GetDataTypes {
        driver: String,
    },
    MapInferredColumnTypes {
        driver: String,
        kinds: Vec<String>,
        connection_id: Option<String>,
    },
    ExecuteClipboardImport {
        req: crate::clipboard_import::ClipboardImportRequest,
    },
    GetViewDefinition {
        connection_id: String,
        view_name: String,
        schema: Option<String>,
        database: Option<String>,
    },
    CreateView {
        connection_id: String,
        view_name: String,
        definition: String,
        schema: Option<String>,
        database: Option<String>,
    },
    AlterView {
        connection_id: String,
        view_name: String,
        definition: String,
        schema: Option<String>,
        database: Option<String>,
    },
    DropView {
        connection_id: String,
        view_name: String,
        schema: Option<String>,
        database: Option<String>,
    },
    RefreshMaterializedView {
        connection_id: String,
        view_name: String,
        schema: Option<String>,
        database: Option<String>,
    },
    GetRoutineParameters {
        connection_id: String,
        routine_name: String,
        schema: Option<String>,
        database: Option<String>,
        identity_args: Option<String>,
    },
    GetRoutineDefinition {
        connection_id: String,
        routine_name: String,
        routine_type: String,
        schema: Option<String>,
        database: Option<String>,
        identity_args: Option<String>,
    },
    BuildRoutineCallSql {
        connection_id: String,
        routine_name: String,
        routine_type: String,
        args: Vec<RoutineCallArg>,
        schema: Option<String>,
    },
    GetRoutineCreateTemplate {
        connection_id: String,
        routine_type: String,
        schema: Option<String>,
        database: Option<String>,
    },
    GetRoutineEditScript {
        connection_id: String,
        routine_name: String,
        routine_type: String,
        schema: Option<String>,
        database: Option<String>,
        identity_args: Option<String>,
    },
    DropRoutine {
        connection_id: String,
        routine_name: String,
        routine_type: String,
        schema: Option<String>,
        database: Option<String>,
        identity_args: Option<String>,
    },
    GetTriggerDefinition {
        connection_id: String,
        trigger_name: String,
        table_name: String,
        schema: Option<String>,
        database: Option<String>,
    },
    CreateTrigger {
        connection_id: String,
        trigger_sql: String,
        schema: Option<String>,
        database: Option<String>,
    },
    DropTrigger {
        connection_id: String,
        trigger_name: String,
        table_name: String,
        schema: Option<String>,
        database: Option<String>,
    },
    GetCreateTableSql {
        connection_id: String,
        table_name: String,
        columns: Vec<ColumnDefinition>,
        schema: Option<String>,
        database: Option<String>,
    },
    GetAddColumnSql {
        connection_id: String,
        table: String,
        column: ColumnDefinition,
        schema: Option<String>,
        database: Option<String>,
    },
    GetAlterColumnSql {
        connection_id: String,
        table: String,
        old_column: ColumnDefinition,
        new_column: ColumnDefinition,
        schema: Option<String>,
        database: Option<String>,
    },
    GetCreateIndexSql {
        connection_id: String,
        table: String,
        index_name: String,
        columns: Vec<String>,
        is_unique: bool,
        schema: Option<String>,
        database: Option<String>,
    },
    GetCreateForeignKeySql {
        connection_id: String,
        table: String,
        fk_name: String,
        column: String,
        ref_table: String,
        ref_column: String,
        on_delete: Option<String>,
        on_update: Option<String>,
        schema: Option<String>,
        database: Option<String>,
    },
    DropIndex {
        connection_id: String,
        table: String,
        index_name: String,
        schema: Option<String>,
        database: Option<String>,
    },
    DropForeignKey {
        connection_id: String,
        table: String,
        fk_name: String,
        schema: Option<String>,
        database: Option<String>,
    },
    GetDbPrivilegeCatalog {
        connection_id: String,
    },
    GetDbUsers {
        connection_id: String,
    },
    GetDbUserGrants {
        connection_id: String,
        user: String,
        host: String,
    },
    GetDbUserPrivileges {
        connection_id: String,
        user: String,
        host: String,
    },
    CreateDbUser {
        connection_id: String,
        user: String,
        host: String,
        password: String,
    },
    DropDbUser {
        connection_id: String,
        user: String,
        host: String,
    },
    SetDbUserPassword {
        connection_id: String,
        user: String,
        host: String,
        password: String,
    },
    ApplyDbUserPrivileges {
        connection_id: String,
        user: String,
        host: String,
        database: Option<String>,
        table: Option<String>,
        privileges: Vec<String>,
        grant: bool,
    },
}

pub async fn execute(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    command: DatabaseObjectCommand,
) -> Result<Value, String> {
    match command {
        DatabaseObjectCommand::GetTableQueryTemplate {
            connection_id,
            request,
            database,
        } => json(
            get_table_query_template(runtime, session_id, &connection_id, request, database)
                .await?,
        ),
        DatabaseObjectCommand::GetColumnStats {
            connection_id,
            request,
            database,
        } => json(get_column_stats(runtime, session_id, &connection_id, request, database).await?),
        DatabaseObjectCommand::GetDropTableSql {
            connection_id,
            table,
            schema,
            database,
        } => json(get_drop_table_sql(runtime, &connection_id, table, schema, database).await?),
        DatabaseObjectCommand::GetDataTypes { driver } => {
            json(crate::commands::get_data_types(driver).await?)
        }
        DatabaseObjectCommand::MapInferredColumnTypes {
            driver,
            kinds,
            connection_id,
        } => json(
            map_inferred_column_types(runtime, session_id, driver, kinds, connection_id).await?,
        ),
        DatabaseObjectCommand::ExecuteClipboardImport { req } => {
            json(crate::clipboard_import::import_with_runtime(runtime, session_id, req).await?)
        }
        DatabaseObjectCommand::GetViewDefinition {
            connection_id,
            view_name,
            schema,
            database,
        } => json(
            get_view_definition(
                runtime,
                session_id,
                &connection_id,
                view_name,
                schema,
                database,
            )
            .await?,
        ),
        DatabaseObjectCommand::CreateView {
            connection_id,
            view_name,
            definition,
            schema,
            database,
        } => {
            create_view(
                runtime,
                session_id,
                &connection_id,
                view_name,
                definition,
                schema,
                database,
            )
            .await?;
            Ok(Value::Null)
        }
        DatabaseObjectCommand::AlterView {
            connection_id,
            view_name,
            definition,
            schema,
            database,
        } => {
            alter_view(
                runtime,
                session_id,
                &connection_id,
                view_name,
                definition,
                schema,
                database,
            )
            .await?;
            Ok(Value::Null)
        }
        DatabaseObjectCommand::DropView {
            connection_id,
            view_name,
            schema,
            database,
        } => {
            drop_view(
                runtime,
                session_id,
                &connection_id,
                view_name,
                schema,
                database,
            )
            .await?;
            Ok(Value::Null)
        }
        DatabaseObjectCommand::RefreshMaterializedView {
            connection_id,
            view_name,
            schema,
            database,
        } => {
            refresh_materialized_view(
                runtime,
                session_id,
                &connection_id,
                view_name,
                schema,
                database,
            )
            .await?;
            Ok(Value::Null)
        }
        DatabaseObjectCommand::GetRoutineParameters {
            connection_id,
            routine_name,
            schema,
            database,
            identity_args,
        } => json(
            get_routine_parameters(
                runtime,
                session_id,
                &connection_id,
                routine_name,
                schema,
                database,
                identity_args,
            )
            .await?,
        ),
        DatabaseObjectCommand::GetRoutineDefinition {
            connection_id,
            routine_name,
            routine_type,
            schema,
            database,
            identity_args,
        } => json(
            get_routine_definition(
                runtime,
                session_id,
                &connection_id,
                routine_name,
                routine_type,
                schema,
                database,
                identity_args,
            )
            .await?,
        ),
        DatabaseObjectCommand::BuildRoutineCallSql {
            connection_id,
            routine_name,
            routine_type,
            args,
            schema,
        } => json(
            build_routine_call_sql(
                runtime,
                session_id,
                &connection_id,
                routine_name,
                routine_type,
                args,
                schema,
            )
            .await?,
        ),
        DatabaseObjectCommand::GetRoutineCreateTemplate {
            connection_id,
            routine_type,
            schema,
            database,
        } => json(
            get_routine_create_template(runtime, &connection_id, routine_type, schema, database)
                .await?,
        ),
        DatabaseObjectCommand::GetRoutineEditScript {
            connection_id,
            routine_name,
            routine_type,
            schema,
            database,
            identity_args,
        } => json(
            get_routine_edit_script(
                runtime,
                session_id,
                &connection_id,
                routine_name,
                routine_type,
                schema,
                database,
                identity_args,
            )
            .await?,
        ),
        DatabaseObjectCommand::DropRoutine {
            connection_id,
            routine_name,
            routine_type,
            schema,
            database,
            identity_args,
        } => {
            drop_routine(
                runtime,
                session_id,
                &connection_id,
                routine_name,
                routine_type,
                schema,
                database,
                identity_args,
            )
            .await?;
            Ok(Value::Null)
        }
        DatabaseObjectCommand::GetTriggerDefinition {
            connection_id,
            trigger_name,
            table_name,
            schema,
            database,
        } => json(
            get_trigger_definition(
                runtime,
                session_id,
                &connection_id,
                trigger_name,
                table_name,
                schema,
                database,
            )
            .await?,
        ),
        DatabaseObjectCommand::CreateTrigger {
            connection_id,
            trigger_sql,
            schema,
            database,
        } => {
            create_trigger(
                runtime,
                session_id,
                &connection_id,
                trigger_sql,
                schema,
                database,
            )
            .await?;
            Ok(Value::Null)
        }
        DatabaseObjectCommand::DropTrigger {
            connection_id,
            trigger_name,
            table_name,
            schema,
            database,
        } => {
            drop_trigger(
                runtime,
                session_id,
                &connection_id,
                trigger_name,
                table_name,
                schema,
                database,
            )
            .await?;
            Ok(Value::Null)
        }
        DatabaseObjectCommand::GetCreateTableSql {
            connection_id,
            table_name,
            columns,
            schema,
            database,
        } => json(
            get_create_table_sql(runtime, &connection_id, table_name, columns, schema, database)
                .await?,
        ),
        DatabaseObjectCommand::GetAddColumnSql {
            connection_id,
            table,
            column,
            schema,
            database,
        } => json(
            get_add_column_sql(runtime, &connection_id, table, column, schema, database).await?,
        ),
        DatabaseObjectCommand::GetAlterColumnSql {
            connection_id,
            table,
            old_column,
            new_column,
            schema,
            database,
        } => json(
            get_alter_column_sql(
                runtime,
                &connection_id,
                table,
                old_column,
                new_column,
                schema,
                database,
            )
            .await?,
        ),
        DatabaseObjectCommand::GetCreateIndexSql {
            connection_id,
            table,
            index_name,
            columns,
            is_unique,
            schema,
            database,
        } => json(
            get_create_index_sql(
                runtime,
                &connection_id,
                table,
                index_name,
                columns,
                is_unique,
                schema,
                database,
            )
            .await?,
        ),
        DatabaseObjectCommand::GetCreateForeignKeySql {
            connection_id,
            table,
            fk_name,
            column,
            ref_table,
            ref_column,
            on_delete,
            on_update,
            schema,
            database,
        } => json(
            get_create_foreign_key_sql(
                runtime,
                &connection_id,
                table,
                fk_name,
                column,
                ref_table,
                ref_column,
                on_delete,
                on_update,
                schema,
                database,
            )
            .await?,
        ),
        DatabaseObjectCommand::DropIndex {
            connection_id,
            table,
            index_name,
            schema,
            database,
        } => {
            drop_index(
                runtime,
                session_id,
                &connection_id,
                table,
                index_name,
                schema,
                database,
            )
            .await?;
            Ok(Value::Null)
        }
        DatabaseObjectCommand::DropForeignKey {
            connection_id,
            table,
            fk_name,
            schema,
            database,
        } => {
            drop_foreign_key(
                runtime,
                session_id,
                &connection_id,
                table,
                fk_name,
                schema,
                database,
            )
            .await?;
            Ok(Value::Null)
        }
        DatabaseObjectCommand::GetDbPrivilegeCatalog { connection_id } => {
            json(get_db_privilege_catalog(runtime, &connection_id).await?)
        }
        DatabaseObjectCommand::GetDbUsers { connection_id } => {
            json(get_db_users(runtime, session_id, &connection_id).await?)
        }
        DatabaseObjectCommand::GetDbUserGrants {
            connection_id,
            user,
            host,
        } => json(get_db_user_grants(runtime, session_id, &connection_id, user, host).await?),
        DatabaseObjectCommand::GetDbUserPrivileges {
            connection_id,
            user,
            host,
        } => json(get_db_user_privileges(runtime, session_id, &connection_id, user, host).await?),
        DatabaseObjectCommand::CreateDbUser {
            connection_id,
            user,
            host,
            password,
        } => {
            create_db_user(runtime, session_id, &connection_id, user, host, password).await?;
            Ok(Value::Null)
        }
        DatabaseObjectCommand::DropDbUser {
            connection_id,
            user,
            host,
        } => {
            drop_db_user(runtime, session_id, &connection_id, user, host).await?;
            Ok(Value::Null)
        }
        DatabaseObjectCommand::SetDbUserPassword {
            connection_id,
            user,
            host,
            password,
        } => {
            set_db_user_password(runtime, session_id, &connection_id, user, host, password).await?;
            Ok(Value::Null)
        }
        DatabaseObjectCommand::ApplyDbUserPrivileges {
            connection_id,
            user,
            host,
            database,
            table,
            privileges,
            grant,
        } => {
            apply_db_user_privileges(
                runtime,
                session_id,
                &connection_id,
                user,
                host,
                database,
                table,
                privileges,
                grant,
            )
            .await?;
            Ok(Value::Null)
        }
    }
}

async fn saved_driver_and_params(
    runtime: &RuntimeContext,
    connection_id: &str,
) -> Result<(Arc<dyn DatabaseDriver>, ConnectionParams), String> {
    let saved =
        crate::application::connections::load_connections(&runtime.paths.connections_file())?
            .into_iter()
            .find(|connection| connection.id == connection_id)
            .ok_or_else(|| "Connection not found".to_string())?;
    let driver = driver_for(&saved.params.driver).await?;
    // Pure SQL builders still need no credentials for static drivers. Only
    // discovery-enabled plugins resolve credentials and tunnels here.
    if !driver.has_connection_metadata() {
        return Ok((driver, saved.params));
    }
    let runtime_for_resolution = runtime.clone();
    let connection_id_for_resolution = connection_id.to_string();
    let (_, params) = tokio::task::spawn_blocking(move || {
        crate::application::connections::resolve_saved_connection_params(
            &runtime_for_resolution,
            None,
            &connection_id_for_resolution,
        )
    })
    .await
    .map_err(|error| error.to_string())??;
    let driver = crate::drivers::registry::get_connection_driver(&params).await?;
    Ok((driver, saved.params))
}

/// Driver and params for the SQL-preview builders. Built-in drivers build SQL
/// without credentials, so they keep the registered instance and the saved
/// params. Plugin drivers get the saved params (secrets read leniently, the
/// browsed `database` applied) bound to a driver snapshot. No tunnel is
/// opened, so a preview works while the server is unreachable.
async fn sql_builder_driver_and_params(
    runtime: &RuntimeContext,
    connection_id: &str,
    database: Option<String>,
) -> Result<(Arc<dyn DatabaseDriver>, ConnectionParams), String> {
    let mut saved =
        crate::application::connections::load_connections(&runtime.paths.connections_file())?
            .into_iter()
            .find(|connection| connection.id == connection_id)
            .ok_or_else(|| "Connection not found".to_string())?;
    let driver = driver_for(&saved.params.driver).await?;
    if driver.manifest().is_builtin {
        return Ok((driver, saved.params));
    }
    crate::application::connections::bind_sql_builder_secrets(runtime, &mut saved)?;
    let params = crate::commands::sql_builder_params(&saved, database);
    let driver = driver.bind_connection_params(&params).unwrap_or(driver);
    Ok((driver, params))
}

async fn connected_driver_and_params(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    database: Option<String>,
) -> Result<(Arc<dyn DatabaseDriver>, ConnectionParams), String> {
    let (_driver_id, mut params) =
        crate::application::connections::resolve_saved_connection_params(
            runtime,
            session_id,
            connection_id,
        )?;
    if let Some(db) = database.filter(|db| !db.is_empty()) {
        params.database = crate::models::DatabaseSelection::Single(db);
    }
    Ok((
        crate::drivers::registry::get_connection_driver(&params).await?,
        params,
    ))
}

async fn driver_for(driver_id: &str) -> Result<Arc<dyn DatabaseDriver>, String> {
    crate::drivers::registry::get_driver(driver_id)
        .await
        .ok_or_else(|| format!("Driver not found: {driver_id}"))
}

pub async fn get_view_definition(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    view_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<String, String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, database).await?;

    driver
        .get_view_definition(&params, &view_name, schema.as_deref())
        .await
}

pub async fn create_view(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    view_name: String,
    definition: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<(), String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, database).await?;

    driver
        .create_view(&params, &view_name, &definition, schema.as_deref())
        .await
}

pub async fn alter_view(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    view_name: String,
    definition: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<(), String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, database).await?;

    driver
        .alter_view(&params, &view_name, &definition, schema.as_deref())
        .await
}

pub async fn drop_view(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    view_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<(), String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, database).await?;

    driver
        .drop_view(&params, &view_name, schema.as_deref())
        .await
}

pub async fn refresh_materialized_view(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    view_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<(), String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, database).await?;

    driver
        .refresh_materialized_view(&params, &view_name, schema.as_deref())
        .await
}

pub async fn get_routine_parameters(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    routine_name: String,
    schema: Option<String>,
    database: Option<String>,
    identity_args: Option<String>,
) -> Result<Vec<RoutineParameter>, String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, database).await?;

    driver
        .get_routine_parameters(
            &params,
            &routine_name,
            schema.as_deref(),
            identity_args.as_deref(),
        )
        .await
}

pub async fn get_routine_definition(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    routine_name: String,
    routine_type: String,
    schema: Option<String>,
    database: Option<String>,
    identity_args: Option<String>,
) -> Result<String, String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, database).await?;

    driver
        .get_routine_definition(
            &params,
            &routine_name,
            &routine_type,
            schema.as_deref(),
            identity_args.as_deref(),
        )
        .await
}

pub async fn build_routine_call_sql(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    routine_name: String,
    routine_type: String,
    args: Vec<RoutineCallArg>,
    schema: Option<String>,
) -> Result<String, String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, None).await?;
    driver
        .build_routine_call_sql(
            &params,
            &routine_name,
            &routine_type,
            &args,
            schema.as_deref(),
        )
        .await
}

pub async fn get_routine_create_template(
    runtime: &RuntimeContext,
    connection_id: &str,
    routine_type: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<String, String> {
    let (driver, _) = sql_builder_driver_and_params(runtime, connection_id, database).await?;
    driver
        .routine_create_template(&routine_type, schema.as_deref())
        .await
}

pub async fn get_routine_edit_script(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    routine_name: String,
    routine_type: String,
    schema: Option<String>,
    database: Option<String>,
    identity_args: Option<String>,
) -> Result<String, String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, database).await?;

    driver
        .get_routine_edit_script(
            &params,
            &routine_name,
            &routine_type,
            schema.as_deref(),
            identity_args.as_deref(),
        )
        .await
}

pub async fn drop_routine(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    routine_name: String,
    routine_type: String,
    schema: Option<String>,
    database: Option<String>,
    identity_args: Option<String>,
) -> Result<(), String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, database).await?;

    driver
        .drop_routine(
            &params,
            &routine_name,
            &routine_type,
            schema.as_deref(),
            identity_args.as_deref(),
        )
        .await
}

pub async fn get_trigger_definition(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    trigger_name: String,
    table_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<String, String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, database).await?;

    driver
        .get_trigger_definition(&params, &trigger_name, &table_name, schema.as_deref())
        .await
}

pub async fn create_trigger(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    trigger_sql: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<(), String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, database).await?;

    driver
        .create_trigger(&params, &trigger_sql, schema.as_deref())
        .await
}

pub async fn drop_trigger(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    trigger_name: String,
    table_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<(), String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, database).await?;

    driver
        .drop_trigger(&params, &trigger_name, &table_name, schema.as_deref())
        .await
}

pub async fn get_create_table_sql(
    runtime: &RuntimeContext,
    connection_id: &str,
    table_name: String,
    columns: Vec<ColumnDefinition>,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<String>, String> {
    let (driver, _) = sql_builder_driver_and_params(runtime, connection_id, database).await?;
    driver
        .get_create_table_sql(&table_name, columns, schema.as_deref())
        .await
}

pub async fn get_add_column_sql(
    runtime: &RuntimeContext,
    connection_id: &str,
    table: String,
    column: ColumnDefinition,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<String>, String> {
    let (driver, _) = sql_builder_driver_and_params(runtime, connection_id, database).await?;
    driver
        .get_add_column_sql(&table, column, schema.as_deref())
        .await
}

pub async fn get_alter_column_sql(
    runtime: &RuntimeContext,
    connection_id: &str,
    table: String,
    old_column: ColumnDefinition,
    new_column: ColumnDefinition,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<String>, String> {
    let (driver, _) = sql_builder_driver_and_params(runtime, connection_id, database).await?;
    driver
        .get_alter_column_sql(&table, old_column, new_column, schema.as_deref())
        .await
}

pub async fn get_create_index_sql(
    runtime: &RuntimeContext,
    connection_id: &str,
    table: String,
    index_name: String,
    columns: Vec<String>,
    is_unique: bool,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<String>, String> {
    let (driver, _) = sql_builder_driver_and_params(runtime, connection_id, database).await?;
    driver
        .get_create_index_sql(&table, &index_name, columns, is_unique, schema.as_deref())
        .await
}

#[allow(clippy::too_many_arguments)]
pub async fn get_create_foreign_key_sql(
    runtime: &RuntimeContext,
    connection_id: &str,
    table: String,
    fk_name: String,
    column: String,
    ref_table: String,
    ref_column: String,
    on_delete: Option<String>,
    on_update: Option<String>,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<String>, String> {
    let (driver, params) = sql_builder_driver_and_params(runtime, connection_id, database).await?;
    driver
        .get_create_foreign_key_sql(
            &params,
            &table,
            &fk_name,
            &column,
            &ref_table,
            &ref_column,
            on_delete.as_deref(),
            on_update.as_deref(),
            schema.as_deref(),
        )
        .await
}

pub async fn drop_index(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    table: String,
    index_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<(), String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, database).await?;

    driver
        .drop_index(&params, &table, &index_name, schema.as_deref())
        .await
}

pub async fn drop_foreign_key(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    table: String,
    fk_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<(), String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, database).await?;

    driver
        .drop_foreign_key(&params, &table, &fk_name, schema.as_deref())
        .await
}

pub async fn get_db_privilege_catalog(
    runtime: &RuntimeContext,
    connection_id: &str,
) -> Result<DbPrivilegeCatalog, String> {
    let (driver, _) = saved_driver_and_params(runtime, connection_id).await?;
    driver.get_db_privilege_catalog().await
}

pub async fn get_db_users(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
) -> Result<Vec<DbUserInfo>, String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, None).await?;
    driver.get_db_users(&params).await
}

pub async fn get_db_user_grants(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    user: String,
    host: String,
) -> Result<Vec<String>, String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, None).await?;
    driver.get_db_user_grants(&params, &user, &host).await
}

pub async fn get_db_user_privileges(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    user: String,
    host: String,
) -> Result<Vec<DbUserGrantSet>, String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, None).await?;
    driver.get_db_user_privileges(&params, &user, &host).await
}

pub async fn create_db_user(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    user: String,
    host: String,
    password: String,
) -> Result<(), String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, None).await?;
    driver
        .create_db_user(&params, &user, &host, &password)
        .await
}

pub async fn drop_db_user(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    user: String,
    host: String,
) -> Result<(), String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, None).await?;
    driver.drop_db_user(&params, &user, &host).await
}

pub async fn set_db_user_password(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    user: String,
    host: String,
    password: String,
) -> Result<(), String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, None).await?;
    driver
        .set_db_user_password(&params, &user, &host, &password)
        .await
}

#[allow(clippy::too_many_arguments)]
pub async fn apply_db_user_privileges(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    user: String,
    host: String,
    database: Option<String>,
    table: Option<String>,
    privileges: Vec<String>,
    grant: bool,
) -> Result<(), String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, None).await?;
    driver
        .apply_db_user_privileges(
            &params,
            &user,
            &host,
            database.as_deref(),
            table.as_deref(),
            &privileges,
            grant,
        )
        .await
}

fn json(value: impl Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

/// Column statistics through the optional plugin RPC. `None` means the driver
/// doesn't provide them; the frontend then falls back to its generic SQL.
pub async fn get_column_stats(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    request: crate::models::ColumnStatsRequest,
    database: Option<String>,
) -> Result<Option<crate::models::ColumnStatsResult>, String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, database).await?;
    driver.get_column_stats(&params, &request).await
}

/// Plugin-provided statement for dropping a table, or `None` to let the
/// explorer build its generic `DROP TABLE`. Only plugins declaring
/// `capabilities.drop_table_sql` are asked.
pub async fn get_drop_table_sql(
    runtime: &RuntimeContext,
    connection_id: &str,
    table: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Option<String>, String> {
    let driver_id = crate::application::connections::saved_connection_driver(runtime, connection_id)?;
    let driver = driver_for(&driver_id).await?;
    if driver.manifest().is_builtin || !driver.manifest().capabilities.drop_table_sql {
        return Ok(None);
    }
    let (driver, params) = sql_builder_driver_and_params(runtime, connection_id, database).await?;
    driver
        .get_drop_table_sql(&params, &table, schema.as_deref())
        .await
}

pub async fn get_table_query_template(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    request: crate::models::TableQueryTemplateRequest,
    database: Option<String>,
) -> Result<Option<String>, String> {
    let (driver, params) =
        connected_driver_and_params(runtime, session_id, connection_id, database).await?;

    driver.get_table_query_template(&params, &request).await
}

pub async fn map_inferred_column_types(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    driver: String,
    kinds: Vec<String>,
    connection_id: Option<String>,
) -> Result<Vec<String>, String> {
    let drv = if let Some(id) = connection_id {
        let saved_driver = super::connections::saved_connection_driver(runtime, &id)?;
        if saved_driver != driver {
            return Err("Connection driver does not match the requested driver".into());
        }
        let drv = driver_for(&driver).await?;
        if drv.has_connection_metadata() {
            connected_driver_and_params(runtime, session_id, &id, None)
                .await?
                .0
        } else {
            drv
        }
    } else {
        crate::drivers::registry::get_driver(&driver)
            .await
            .ok_or_else(|| format!("Unsupported driver: {driver}"))?
    };
    Ok(kinds
        .iter()
        .map(|kind| drv.map_inferred_type(kind))
        .collect())
}
