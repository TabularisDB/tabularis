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
    GetAvailableDatabases {
        connection_id: String,
    },
    GetSchemas {
        connection_id: String,
    },
    GetTables {
        connection_id: String,
        schema: Option<String>,
    },
    GetColumns {
        connection_id: String,
        table_name: String,
        schema: Option<String>,
    },
    GetForeignKeys {
        connection_id: String,
        table_name: String,
        schema: Option<String>,
    },
    GetIndexes {
        connection_id: String,
        table_name: String,
        schema: Option<String>,
    },
    GetViews {
        connection_id: String,
        schema: Option<String>,
    },
    GetViewColumns {
        connection_id: String,
        view_name: String,
        schema: Option<String>,
    },
    GetMaterializedViews {
        connection_id: String,
        schema: Option<String>,
    },
    GetMaterializedViewColumns {
        connection_id: String,
        view_name: String,
        schema: Option<String>,
    },
    GetMaterializedViewDefinition {
        connection_id: String,
        view_name: String,
        schema: Option<String>,
    },
    GetRoutines {
        connection_id: String,
        schema: Option<String>,
    },
    GetTriggers {
        connection_id: String,
        schema: Option<String>,
    },
    GetSchemaSnapshot {
        connection_id: String,
        schema: Option<String>,
    },
    GetSelectedSchemas {
        connection_id: String,
    },
    SetSelectedSchemas {
        connection_id: String,
        schemas: Vec<String>,
    },
    GetSchemaPreference {
        connection_id: String,
    },
    SetSchemaPreference {
        connection_id: String,
        schema: String,
    },
}

pub async fn execute(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    command: MetadataCommand,
) -> Result<Value, String> {
    match command {
        MetadataCommand::GetAvailableDatabases { connection_id } => {
            json(get_available_databases(runtime, session_id, &connection_id).await?)
        }
        MetadataCommand::GetSchemas { connection_id } => {
            json(get_schemas(runtime, session_id, &connection_id).await?)
        }
        MetadataCommand::GetTables {
            connection_id,
            schema,
        } => json(get_tables(runtime, session_id, &connection_id, schema).await?),
        MetadataCommand::GetColumns {
            connection_id,
            table_name,
            schema,
        } => json(get_columns(runtime, session_id, &connection_id, table_name, schema).await?),
        MetadataCommand::GetForeignKeys {
            connection_id,
            table_name,
            schema,
        } => json(get_foreign_keys(runtime, session_id, &connection_id, table_name, schema).await?),
        MetadataCommand::GetIndexes {
            connection_id,
            table_name,
            schema,
        } => json(get_indexes(runtime, session_id, &connection_id, table_name, schema).await?),
        MetadataCommand::GetViews {
            connection_id,
            schema,
        } => json(get_views(runtime, session_id, &connection_id, schema).await?),
        MetadataCommand::GetViewColumns {
            connection_id,
            view_name,
            schema,
        } => json(get_view_columns(runtime, session_id, &connection_id, view_name, schema).await?),
        MetadataCommand::GetMaterializedViews {
            connection_id,
            schema,
        } => json(get_materialized_views(runtime, session_id, &connection_id, schema).await?),
        MetadataCommand::GetMaterializedViewColumns {
            connection_id,
            view_name,
            schema,
        } => json(
            get_materialized_view_columns(runtime, session_id, &connection_id, view_name, schema)
                .await?,
        ),
        MetadataCommand::GetMaterializedViewDefinition {
            connection_id,
            view_name,
            schema,
        } => json(
            get_materialized_view_definition(
                runtime,
                session_id,
                &connection_id,
                view_name,
                schema,
            )
            .await?,
        ),
        MetadataCommand::GetRoutines {
            connection_id,
            schema,
        } => json(get_routines(runtime, session_id, &connection_id, schema).await?),
        MetadataCommand::GetTriggers {
            connection_id,
            schema,
        } => json(get_triggers(runtime, session_id, &connection_id, schema).await?),
        MetadataCommand::GetSchemaSnapshot {
            connection_id,
            schema,
        } => json(get_schema_snapshot(runtime, session_id, &connection_id, schema).await?),
        MetadataCommand::GetSelectedSchemas { connection_id } => {
            json(get_selected_schemas(runtime, &connection_id))
        }
        MetadataCommand::SetSelectedSchemas {
            connection_id,
            schemas,
        } => {
            set_selected_schemas(runtime, connection_id, schemas)?;
            Ok(Value::Null)
        }
        MetadataCommand::GetSchemaPreference { connection_id } => {
            json(get_schema_preference(runtime, &connection_id))
        }
        MetadataCommand::SetSchemaPreference {
            connection_id,
            schema,
        } => {
            set_schema_preference(runtime, connection_id, schema)?;
            Ok(Value::Null)
        }
    }
}

async fn driver_and_params(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
) -> Result<(Arc<dyn DatabaseDriver>, ConnectionParams), String> {
    let runtime_for_resolution = runtime.clone();
    let connection_id_for_resolution = connection_id.to_string();
    let (driver_id, params) = tokio::task::spawn_blocking(move || {
        crate::application::connections::resolve_saved_connection_params(
            &runtime_for_resolution,
            session_id,
            &connection_id_for_resolution,
        )
    })
    .await
    .map_err(|error| error.to_string())??;
    let driver = crate::drivers::registry::get_driver(&driver_id)
        .await
        .ok_or_else(|| format!("Driver not found: {driver_id}"))?;
    Ok((driver, params))
}

pub async fn get_ai_schema_context(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    schema: Option<String>,
) -> Result<String, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id).await?;
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
    let (driver, params) = driver_and_params(runtime, session_id, connection_id).await?;
    driver.get_databases(&params).await
}

pub async fn get_schemas(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
) -> Result<Vec<String>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id).await?;
    driver.get_schemas(&params).await
}

pub async fn get_tables(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    schema: Option<String>,
) -> Result<Vec<TableInfo>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id).await?;
    driver.get_tables(&params, schema.as_deref()).await
}

pub async fn get_columns(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    table_name: String,
    schema: Option<String>,
) -> Result<Vec<TableColumn>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id).await?;
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
) -> Result<Vec<ForeignKey>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id).await?;
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
) -> Result<Vec<Index>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id).await?;
    driver
        .get_indexes(&params, &table_name, schema.as_deref())
        .await
}

pub async fn get_views(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    schema: Option<String>,
) -> Result<Vec<ViewInfo>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id).await?;
    driver.get_views(&params, schema.as_deref()).await
}

pub async fn get_view_columns(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    view_name: String,
    schema: Option<String>,
) -> Result<Vec<TableColumn>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id).await?;
    driver
        .get_view_columns(&params, &view_name, schema.as_deref())
        .await
}

pub async fn get_materialized_views(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    schema: Option<String>,
) -> Result<Vec<ViewInfo>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id).await?;
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
) -> Result<Vec<TableColumn>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id).await?;
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
) -> Result<String, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id).await?;
    driver
        .get_materialized_view_definition(&params, &view_name, schema.as_deref())
        .await
}

pub async fn get_routines(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    schema: Option<String>,
) -> Result<Vec<RoutineInfo>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id).await?;
    driver.get_routines(&params, schema.as_deref()).await
}

pub async fn get_triggers(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    schema: Option<String>,
) -> Result<Vec<TriggerInfo>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id).await?;
    driver.get_triggers(&params, schema.as_deref()).await
}

pub async fn get_schema_snapshot(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    schema: Option<String>,
) -> Result<Vec<TableSchema>, String> {
    let (driver, params) = driver_and_params(runtime, session_id, connection_id).await?;
    driver.get_schema_snapshot(&params, schema.as_deref()).await
}

pub fn get_selected_schemas(runtime: &RuntimeContext, connection_id: &str) -> Vec<String> {
    load_config(runtime)
        .selected_schemas
        .and_then(|schemas| schemas.get(connection_id).cloned())
        .unwrap_or_default()
}

pub fn set_selected_schemas(
    runtime: &RuntimeContext,
    connection_id: String,
    schemas: Vec<String>,
) -> Result<(), String> {
    crate::application::persistence::set_selected_schemas(runtime, connection_id, schemas)
}

pub fn get_schema_preference(runtime: &RuntimeContext, connection_id: &str) -> Option<String> {
    load_config(runtime)
        .schema_preferences
        .and_then(|preferences| preferences.get(connection_id).cloned())
}

pub fn set_schema_preference(
    runtime: &RuntimeContext,
    connection_id: String,
    schema: String,
) -> Result<(), String> {
    crate::application::persistence::set_schema_preference(runtime, connection_id, schema)
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
