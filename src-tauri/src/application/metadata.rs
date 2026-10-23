use crate::drivers::driver_trait::DatabaseDriver;
use crate::models::{
    ConnectionParams, ForeignKey, Index, RoutineInfo, TableColumn, TableInfo, TableSchema,
    TriggerInfo, ViewInfo,
};
use crate::runtime::RuntimeContext;
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug)]
pub enum MetadataCommand {
    GetConnectionMetadata {
        connection_id: String,
    },
    GetAvailableDatabases {
        connection_id: String,
    },
    GetSchemas {
        connection_id: String,
        database: Option<String>,
    },
    GetTables {
        connection_id: String,
        schema: Option<String>,
        database: Option<String>,
    },
    GetColumns {
        connection_id: String,
        table_name: String,
        schema: Option<String>,
        database: Option<String>,
    },
    GetForeignKeys {
        connection_id: String,
        table_name: String,
        schema: Option<String>,
        database: Option<String>,
    },
    GetIndexes {
        connection_id: String,
        table_name: String,
        schema: Option<String>,
        database: Option<String>,
    },
    GetViews {
        connection_id: String,
        schema: Option<String>,
        database: Option<String>,
    },
    GetViewColumns {
        connection_id: String,
        view_name: String,
        schema: Option<String>,
        database: Option<String>,
    },
    GetMaterializedViews {
        connection_id: String,
        schema: Option<String>,
        database: Option<String>,
    },
    GetMaterializedViewColumns {
        connection_id: String,
        view_name: String,
        schema: Option<String>,
        database: Option<String>,
    },
    GetMaterializedViewDefinition {
        connection_id: String,
        view_name: String,
        schema: Option<String>,
        database: Option<String>,
    },
    GetRoutines {
        connection_id: String,
        schema: Option<String>,
        database: Option<String>,
    },
    GetTriggers {
        connection_id: String,
        schema: Option<String>,
        database: Option<String>,
    },
    GetSchemaSnapshot {
        connection_id: String,
        schema: Option<String>,
        database: Option<String>,
    },
    GetSelectedSchemas {
        connection_id: String,
        database: Option<String>,
    },
    SetSelectedSchemas {
        connection_id: String,
        schemas: Vec<String>,
        database: Option<String>,
    },
    GetSchemaPreference {
        connection_id: String,
        database: Option<String>,
    },
    SetSchemaPreference {
        connection_id: String,
        schema: String,
        database: Option<String>,
    },
}

pub async fn execute(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    command: MetadataCommand,
) -> Result<Value, String> {
    match command {
        MetadataCommand::GetConnectionMetadata { connection_id } => {
            json(get_connection_metadata(runtime, session_id, &connection_id).await?)
        }
        MetadataCommand::GetAvailableDatabases { connection_id } => {
            json(get_available_databases(runtime, session_id, &connection_id).await?)
        }
        MetadataCommand::GetSchemas {
            connection_id,
            database,
        } => json(get_schemas(runtime, session_id, &connection_id, database).await?),
        MetadataCommand::GetTables {
            connection_id,
            schema,
            database,
        } => json(get_tables(runtime, session_id, &connection_id, schema, database).await?),
        MetadataCommand::GetColumns {
            connection_id,
            table_name,
            schema,
            database,
        } => json(
            get_columns(
                runtime,
                session_id,
                &connection_id,
                table_name,
                schema,
                database,
            )
            .await?,
        ),
        MetadataCommand::GetForeignKeys {
            connection_id,
            table_name,
            schema,
            database,
        } => json(
            get_foreign_keys(
                runtime,
                session_id,
                &connection_id,
                table_name,
                schema,
                database,
            )
            .await?,
        ),
        MetadataCommand::GetIndexes {
            connection_id,
            table_name,
            schema,
            database,
        } => json(
            get_indexes(
                runtime,
                session_id,
                &connection_id,
                table_name,
                schema,
                database,
            )
            .await?,
        ),
        MetadataCommand::GetViews {
            connection_id,
            schema,
            database,
        } => json(get_views(runtime, session_id, &connection_id, schema, database).await?),
        MetadataCommand::GetViewColumns {
            connection_id,
            view_name,
            schema,
            database,
        } => json(
            get_view_columns(
                runtime,
                session_id,
                &connection_id,
                view_name,
                schema,
                database,
            )
            .await?,
        ),
        MetadataCommand::GetMaterializedViews {
            connection_id,
            schema,
            database,
        } => json(
            get_materialized_views(runtime, session_id, &connection_id, schema, database).await?,
        ),
        MetadataCommand::GetMaterializedViewColumns {
            connection_id,
            view_name,
            schema,
            database,
        } => json(
            get_materialized_view_columns(
                runtime,
                session_id,
                &connection_id,
                view_name,
                schema,
                database,
            )
            .await?,
        ),
        MetadataCommand::GetMaterializedViewDefinition {
            connection_id,
            view_name,
            schema,
            database,
        } => json(
            get_materialized_view_definition(
                runtime,
                session_id,
                &connection_id,
                view_name,
                schema,
                database,
            )
            .await?,
        ),
        MetadataCommand::GetRoutines {
            connection_id,
            schema,
            database,
        } => json(get_routines(runtime, session_id, &connection_id, schema, database).await?),
        MetadataCommand::GetTriggers {
            connection_id,
            schema,
            database,
        } => json(get_triggers(runtime, session_id, &connection_id, schema, database).await?),
        MetadataCommand::GetSchemaSnapshot {
            connection_id,
            schema,
            database,
        } => {
            json(get_schema_snapshot(runtime, session_id, &connection_id, schema, database).await?)
        }
        MetadataCommand::GetSelectedSchemas {
            connection_id,
            database,
        } => json(get_selected_schemas(runtime, &connection_id, database)),
        MetadataCommand::SetSelectedSchemas {
            connection_id,
            schemas,
            database,
        } => {
            set_selected_schemas(runtime, connection_id, schemas, database)?;
            Ok(Value::Null)
        }
        MetadataCommand::GetSchemaPreference {
            connection_id,
            database,
        } => json(get_schema_preference(runtime, &connection_id, database)),
        MetadataCommand::SetSchemaPreference {
            connection_id,
            schema,
            database,
        } => {
            set_schema_preference(runtime, connection_id, schema, database)?;
            Ok(Value::Null)
        }
    }
}

async fn driver_and_params(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    database: Option<String>,
) -> Result<(Arc<dyn DatabaseDriver>, ConnectionParams), String> {
    let runtime_for_resolution = runtime.clone();
    let connection_id_for_resolution = connection_id.to_string();
    let (_driver_id, mut params) = tokio::task::spawn_blocking(move || {
        crate::application::connections::resolve_saved_connection_params(
            &runtime_for_resolution,
            session_id,
            &connection_id_for_resolution,
        )
    })
    .await
    .map_err(|error| error.to_string())??;
    if let Some(db) = database.filter(|db| !db.is_empty()) {
        params.database = crate::models::DatabaseSelection::Single(db);
    }
    let driver = crate::drivers::registry::get_connection_driver(&params).await?;
    Ok((driver, params))
}

/// Capabilities and type catalog reported by a connection's driver. Only
/// plugins that discover them per connection answer; static drivers return
/// `None` so the frontend keeps using their manifest.
pub async fn get_connection_metadata(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
) -> Result<Option<crate::plugins::connection_metadata::ConnectionMetadata>, String> {
    let driver_id =
        crate::application::connections::saved_connection_driver(runtime, connection_id)?;
    let driver = crate::drivers::registry::get_driver(&driver_id)
        .await
        .ok_or_else(|| format!("Unsupported driver: {driver_id}"))?;
    if !driver.has_connection_metadata() {
        return Ok(None);
    }
    let (driver, _params) = driver_and_params(runtime, session_id, connection_id, None).await?;
    Ok(Some(
        crate::plugins::connection_metadata::ConnectionMetadata {
            capabilities: driver.manifest().capabilities.clone(),
            data_types: driver.get_data_types(),
            type_mappings: driver.manifest().type_mappings.clone(),
        },
    ))
}

pub async fn get_ai_schema_context(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    schema: Option<String>,
    database: Option<String>,
) -> Result<String, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id, database).await?;

    let identifier_quote = driver.manifest().capabilities.identifier_quote.as_str();
    let context = driver
        .get_ai_schema_context(
            &params,
            schema.as_deref(),
            crate::ai_schema_context::DEFAULT_MAX_TABLES,
        )
        .await?;
    Ok(crate::ai_schema_context::format_for_prompt(
        &context,
        identifier_quote,
    ))
}

pub async fn get_available_databases(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
) -> Result<Vec<String>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id, None).await?;
    driver.get_databases(&params).await
}

pub async fn get_schemas(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    database: Option<String>,
) -> Result<Vec<String>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id, database).await?;

    driver.get_schemas(&params).await
}

pub async fn get_tables(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<TableInfo>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id, database).await?;

    driver.get_tables(&params, schema.as_deref()).await
}

pub async fn get_columns(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    table_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<TableColumn>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id, database).await?;

    driver
        .get_columns(&params, &table_name, schema.as_deref())
        .await
}

pub async fn get_foreign_keys(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    table_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<ForeignKey>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id, database).await?;

    driver
        .get_foreign_keys(&params, &table_name, schema.as_deref())
        .await
}

pub async fn get_indexes(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    table_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<Index>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id, database).await?;

    driver
        .get_indexes(&params, &table_name, schema.as_deref())
        .await
}

pub async fn get_views(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<ViewInfo>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id, database).await?;

    driver.get_views(&params, schema.as_deref()).await
}

pub async fn get_view_columns(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    view_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<TableColumn>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id, database).await?;

    driver
        .get_view_columns(&params, &view_name, schema.as_deref())
        .await
}

pub async fn get_materialized_views(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<ViewInfo>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id, database).await?;

    driver
        .get_materialized_views(&params, schema.as_deref())
        .await
}

pub async fn get_materialized_view_columns(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    view_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<TableColumn>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id, database).await?;

    driver
        .get_materialized_view_columns(&params, &view_name, schema.as_deref())
        .await
}

pub async fn get_materialized_view_definition(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    view_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<String, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id, database).await?;

    driver
        .get_materialized_view_definition(&params, &view_name, schema.as_deref())
        .await
}

pub async fn get_routines(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<RoutineInfo>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id, database).await?;

    driver.get_routines(&params, schema.as_deref()).await
}

pub async fn get_triggers(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<TriggerInfo>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id, database).await?;

    driver.get_triggers(&params, schema.as_deref()).await
}

pub async fn get_schema_snapshot(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<TableSchema>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id, database).await?;

    driver.get_schema_snapshot(&params, schema.as_deref()).await
}

pub fn get_selected_schemas(
    runtime: &RuntimeContext,
    connection_id: &str,
    database: Option<String>,
) -> Vec<String> {
    load_config(runtime)
        .selected_schemas
        .and_then(|schemas| {
            schemas
                .get(&crate::config::schema_storage_key(
                    connection_id,
                    database.as_deref(),
                ))
                .cloned()
        })
        .unwrap_or_default()
}

pub fn set_selected_schemas(
    runtime: &RuntimeContext,
    connection_id: String,
    schemas: Vec<String>,
    database: Option<String>,
) -> Result<(), String> {
    crate::application::persistence::set_selected_schemas(
        runtime,
        crate::config::schema_storage_key(&connection_id, database.as_deref()),
        schemas,
    )
}

pub fn get_schema_preference(
    runtime: &RuntimeContext,
    connection_id: &str,
    database: Option<String>,
) -> Option<String> {
    load_config(runtime)
        .schema_preferences
        .and_then(|preferences| {
            crate::config::resolve_schema_preference(
                &preferences,
                connection_id,
                database.as_deref(),
            )
        })
}

pub fn set_schema_preference(
    runtime: &RuntimeContext,
    connection_id: String,
    schema: String,
    database: Option<String>,
) -> Result<(), String> {
    crate::application::persistence::set_schema_preference(
        runtime,
        crate::config::schema_storage_key(&connection_id, database.as_deref()),
        schema,
    )
}

fn load_config(runtime: &RuntimeContext) -> crate::config::AppConfig {
    crate::application::persistence::load_config(runtime)
}

fn json(value: impl Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "metadata_tests.rs"]
mod tests;
