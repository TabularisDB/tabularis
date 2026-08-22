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
    GetViewDefinition {
        connection_id: String,
        view_name: String,
        schema: Option<String>,
    },
    CreateView {
        connection_id: String,
        view_name: String,
        definition: String,
        schema: Option<String>,
    },
    AlterView {
        connection_id: String,
        view_name: String,
        definition: String,
        schema: Option<String>,
    },
    DropView {
        connection_id: String,
        view_name: String,
        schema: Option<String>,
    },
    RefreshMaterializedView {
        connection_id: String,
        view_name: String,
        schema: Option<String>,
    },
    GetRoutineParameters {
        connection_id: String,
        routine_name: String,
        schema: Option<String>,
    },
    GetRoutineDefinition {
        connection_id: String,
        routine_name: String,
        routine_type: String,
        schema: Option<String>,
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
    },
    GetRoutineEditScript {
        connection_id: String,
        routine_name: String,
        routine_type: String,
        schema: Option<String>,
    },
    DropRoutine {
        connection_id: String,
        routine_name: String,
        routine_type: String,
        schema: Option<String>,
    },
    GetTriggerDefinition {
        connection_id: String,
        trigger_name: String,
        table_name: String,
        schema: Option<String>,
    },
    CreateTrigger {
        connection_id: String,
        trigger_sql: String,
        schema: Option<String>,
    },
    DropTrigger {
        connection_id: String,
        trigger_name: String,
        table_name: String,
        schema: Option<String>,
    },
    GetCreateTableSql {
        connection_id: String,
        table_name: String,
        columns: Vec<ColumnDefinition>,
        schema: Option<String>,
    },
    GetAddColumnSql {
        connection_id: String,
        table: String,
        column: ColumnDefinition,
        schema: Option<String>,
    },
    GetAlterColumnSql {
        connection_id: String,
        table: String,
        old_column: ColumnDefinition,
        new_column: ColumnDefinition,
        schema: Option<String>,
    },
    GetCreateIndexSql {
        connection_id: String,
        table: String,
        index_name: String,
        columns: Vec<String>,
        is_unique: bool,
        schema: Option<String>,
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
    },
    DropIndex {
        connection_id: String,
        table: String,
        index_name: String,
        schema: Option<String>,
    },
    DropForeignKey {
        connection_id: String,
        table: String,
        fk_name: String,
        schema: Option<String>,
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
        DatabaseObjectCommand::GetViewDefinition {
            connection_id,
            view_name,
            schema,
        } => {
            json(get_view_definition(runtime, session_id, &connection_id, view_name, schema).await?)
        }
        DatabaseObjectCommand::CreateView {
            connection_id,
            view_name,
            definition,
            schema,
        } => {
            create_view(
                runtime,
                session_id,
                &connection_id,
                view_name,
                definition,
                schema,
            )
            .await?;
            Ok(Value::Null)
        }
        DatabaseObjectCommand::AlterView {
            connection_id,
            view_name,
            definition,
            schema,
        } => {
            alter_view(
                runtime,
                session_id,
                &connection_id,
                view_name,
                definition,
                schema,
            )
            .await?;
            Ok(Value::Null)
        }
        DatabaseObjectCommand::DropView {
            connection_id,
            view_name,
            schema,
        } => {
            drop_view(runtime, session_id, &connection_id, view_name, schema).await?;
            Ok(Value::Null)
        }
        DatabaseObjectCommand::RefreshMaterializedView {
            connection_id,
            view_name,
            schema,
        } => {
            refresh_materialized_view(runtime, session_id, &connection_id, view_name, schema)
                .await?;
            Ok(Value::Null)
        }
        DatabaseObjectCommand::GetRoutineParameters {
            connection_id,
            routine_name,
            schema,
        } => json(
            get_routine_parameters(runtime, session_id, &connection_id, routine_name, schema)
                .await?,
        ),
        DatabaseObjectCommand::GetRoutineDefinition {
            connection_id,
            routine_name,
            routine_type,
            schema,
        } => json(
            get_routine_definition(
                runtime,
                session_id,
                &connection_id,
                routine_name,
                routine_type,
                schema,
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
        } => {
            json(get_routine_create_template(runtime, &connection_id, routine_type, schema).await?)
        }
        DatabaseObjectCommand::GetRoutineEditScript {
            connection_id,
            routine_name,
            routine_type,
            schema,
        } => json(
            get_routine_edit_script(
                runtime,
                session_id,
                &connection_id,
                routine_name,
                routine_type,
                schema,
            )
            .await?,
        ),
        DatabaseObjectCommand::DropRoutine {
            connection_id,
            routine_name,
            routine_type,
            schema,
        } => {
            drop_routine(
                runtime,
                session_id,
                &connection_id,
                routine_name,
                routine_type,
                schema,
            )
            .await?;
            Ok(Value::Null)
        }
        DatabaseObjectCommand::GetTriggerDefinition {
            connection_id,
            trigger_name,
            table_name,
            schema,
        } => json(
            get_trigger_definition(
                runtime,
                session_id,
                &connection_id,
                trigger_name,
                table_name,
                schema,
            )
            .await?,
        ),
        DatabaseObjectCommand::CreateTrigger {
            connection_id,
            trigger_sql,
            schema,
        } => {
            create_trigger(runtime, session_id, &connection_id, trigger_sql, schema).await?;
            Ok(Value::Null)
        }
        DatabaseObjectCommand::DropTrigger {
            connection_id,
            trigger_name,
            table_name,
            schema,
        } => {
            drop_trigger(
                runtime,
                session_id,
                &connection_id,
                trigger_name,
                table_name,
                schema,
            )
            .await?;
            Ok(Value::Null)
        }
        DatabaseObjectCommand::GetCreateTableSql {
            connection_id,
            table_name,
            columns,
            schema,
        } => {
            json(get_create_table_sql(runtime, &connection_id, table_name, columns, schema).await?)
        }
        DatabaseObjectCommand::GetAddColumnSql {
            connection_id,
            table,
            column,
            schema,
        } => json(get_add_column_sql(runtime, &connection_id, table, column, schema).await?),
        DatabaseObjectCommand::GetAlterColumnSql {
            connection_id,
            table,
            old_column,
            new_column,
            schema,
        } => json(
            get_alter_column_sql(
                runtime,
                &connection_id,
                table,
                old_column,
                new_column,
                schema,
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
        } => json(
            get_create_index_sql(
                runtime,
                &connection_id,
                table,
                index_name,
                columns,
                is_unique,
                schema,
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
            )
            .await?,
        ),
        DatabaseObjectCommand::DropIndex {
            connection_id,
            table,
            index_name,
            schema,
        } => {
            drop_index(
                runtime,
                session_id,
                &connection_id,
                table,
                index_name,
                schema,
            )
            .await?;
            Ok(Value::Null)
        }
        DatabaseObjectCommand::DropForeignKey {
            connection_id,
            table,
            fk_name,
            schema,
        } => {
            drop_foreign_key(runtime, session_id, &connection_id, table, fk_name, schema).await?;
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
    Ok((driver, saved.params))
}

async fn connected_driver_and_params(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
) -> Result<(Arc<dyn DatabaseDriver>, ConnectionParams), String> {
    let (driver_id, params) = crate::application::connections::resolve_saved_connection_params(
        runtime,
        session_id,
        connection_id,
    )?;
    Ok((driver_for(&driver_id).await?, params))
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
) -> Result<String, String> {
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
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
) -> Result<(), String> {
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
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
) -> Result<(), String> {
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
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
) -> Result<(), String> {
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
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
) -> Result<(), String> {
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
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
) -> Result<Vec<RoutineParameter>, String> {
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
    driver
        .get_routine_parameters(&params, &routine_name, schema.as_deref())
        .await
}

pub async fn get_routine_definition(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    routine_name: String,
    routine_type: String,
    schema: Option<String>,
) -> Result<String, String> {
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
    driver
        .get_routine_definition(&params, &routine_name, &routine_type, schema.as_deref())
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
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
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
) -> Result<String, String> {
    let (driver, _) = saved_driver_and_params(runtime, connection_id).await?;
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
) -> Result<String, String> {
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
    driver
        .get_routine_edit_script(&params, &routine_name, &routine_type, schema.as_deref())
        .await
}

pub async fn drop_routine(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    routine_name: String,
    routine_type: String,
    schema: Option<String>,
) -> Result<(), String> {
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
    driver
        .drop_routine(&params, &routine_name, &routine_type, schema.as_deref())
        .await
}

pub async fn get_trigger_definition(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    trigger_name: String,
    table_name: String,
    schema: Option<String>,
) -> Result<String, String> {
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
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
) -> Result<(), String> {
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
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
) -> Result<(), String> {
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
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
) -> Result<Vec<String>, String> {
    let (driver, _) = saved_driver_and_params(runtime, connection_id).await?;
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
) -> Result<Vec<String>, String> {
    let (driver, _) = saved_driver_and_params(runtime, connection_id).await?;
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
) -> Result<Vec<String>, String> {
    let (driver, _) = saved_driver_and_params(runtime, connection_id).await?;
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
) -> Result<Vec<String>, String> {
    let (driver, _) = saved_driver_and_params(runtime, connection_id).await?;
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
) -> Result<Vec<String>, String> {
    let (driver, params) = saved_driver_and_params(runtime, connection_id).await?;
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
) -> Result<(), String> {
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
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
) -> Result<(), String> {
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
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
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
    driver.get_db_users(&params).await
}

pub async fn get_db_user_grants(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    user: String,
    host: String,
) -> Result<Vec<String>, String> {
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
    driver.get_db_user_grants(&params, &user, &host).await
}

pub async fn get_db_user_privileges(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    user: String,
    host: String,
) -> Result<Vec<DbUserGrantSet>, String> {
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
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
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
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
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
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
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
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
    let (driver, params) = connected_driver_and_params(runtime, session_id, connection_id).await?;
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
