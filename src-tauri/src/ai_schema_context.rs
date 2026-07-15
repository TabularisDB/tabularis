use futures::future::join_all;

use crate::drivers::driver_trait::DatabaseDriver;
use crate::models::{AiSchemaContext, ConnectionParams, TableSchema};

pub const DEFAULT_MAX_TABLES: usize = 20;
const MAX_ALLOWED_TABLES: usize = 100;

/// Builds a bounded schema context from the common driver metadata API.
/// Plugin drivers inherit this behavior automatically through `RpcDriver`.
pub async fn load_from_driver<D: DatabaseDriver + ?Sized>(
    driver: &D,
    params: &ConnectionParams,
    schema: Option<&str>,
    max_tables: usize,
) -> Result<AiSchemaContext, String> {
    let tables = driver.get_tables(params, schema).await?;
    let total_table_count = tables.len();
    let limit = max_tables.clamp(1, MAX_ALLOWED_TABLES);

    let table_loads = tables.into_iter().take(limit).map(|table| async move {
        let (columns, foreign_keys) = tokio::join!(
            driver.get_columns(params, &table.name, schema),
            driver.get_foreign_keys(params, &table.name, schema),
        );

        Ok::<TableSchema, String>(TableSchema {
            name: table.name,
            columns: columns?,
            // Relationships enrich join generation, but a driver that cannot
            // expose them should still provide useful table/column context.
            foreign_keys: foreign_keys.unwrap_or_default(),
        })
    });

    let tables = join_all(table_loads)
        .await
        .into_iter()
        .collect::<Result<Vec<_>, _>>()?;

    Ok(AiSchemaContext {
        tables,
        total_table_count,
    })
}

/// Renders driver-provided metadata into the stable prompt format shared by
/// every AI provider. Drivers never control the surrounding system prompt.
pub fn format_for_prompt(context: &AiSchemaContext, identifier_quote: &str) -> String {
    let quote = if identifier_quote.is_empty() {
        "\""
    } else {
        identifier_quote
    };
    let mut lines = Vec::new();

    for table in &context.tables {
        lines.push(format!("Table: {quote}{}{quote}", table.name));
        for column in &table.columns {
            let mut description = format!("  - {} {}", column.name, column.data_type);
            if column.is_pk {
                description.push_str(" PK");
            }
            if !column.is_nullable {
                description.push_str(" NOT NULL");
            }
            if let Some(default) = &column.default_value {
                description.push_str(&format!(" DEFAULT {default}"));
            }
            lines.push(description);
        }
        for foreign_key in &table.foreign_keys {
            lines.push(format!(
                "  FK: {} -> {}.{}",
                foreign_key.column_name, foreign_key.ref_table, foreign_key.ref_column
            ));
        }
    }

    let omitted = context
        .total_table_count
        .saturating_sub(context.tables.len());
    if omitted > 0 {
        lines.push(format!("... and {omitted} more tables (not shown)"));
    }

    lines.join("\n")
}
