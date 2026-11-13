
use crate::table_transfer::{ColumnBinding, ConflictMode, OutKind, SourceKind, TransferValue};
use tokio_postgres::types::{ToSql, Type};
use tokio_postgres::Row;

const MAX_PARAMS: usize = 60_000;

pub(super) fn quote(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

pub(super) fn qualified(schema: &str, table: &str) -> String {
    format!("{}.{}", quote(schema), quote(table))
}

/// Summarises a database error without echoing row data: server messages for
/// data exceptions quote the offending value and `detail` carries key values.
pub(super) fn describe_error(error: &tokio_postgres::Error) -> String {
    let Some(db) = error.as_db_error() else {
        return "PostgreSQL connection error".to_string();
    };
    let code = db.code().code();
    let label = match code {
        "23505" => "unique constraint violation",
        "23502" => "not-null constraint violation",
        "23503" => "foreign key violation",
        "23514" => "check constraint violation",
        "23P01" => "exclusion constraint violation",
        c if c.starts_with("22") => "value rejected by the column type",
        c if c.starts_with("42") => "permission or schema error",
        _ => "database error",
    };
    let mut text = format!("{label} [SQLSTATE {code}]");
    if let Some(constraint) = db.constraint() {
        text.push_str(&format!(" constraint \"{constraint}\""));
    }
    if let Some(column) = db.column() {
        text.push_str(&format!(" column \"{column}\""));
    }
    text
}

pub(super) fn select_sql(schema: &str, table: &str, bindings: &[ColumnBinding]) -> String {
    let columns: Vec<String> = bindings
        .iter()
        .map(|b| {
            let name = quote(&b.source_column);
            match b.source_kind {
                SourceKind::Bool | SourceKind::Int | SourceKind::Text | SourceKind::Bytes => name,
                _ => format!("{name}::text"),
            }
        })
        .collect();
    format!("SELECT {} FROM {}", columns.join(", "), qualified(schema, table))
}

pub(super) fn read_cell(row: &Row, index: usize, kind: SourceKind) -> Result<TransferValue, String> {
    let wrong = || "A source column returned an unexpected type".to_string();
    match kind {
        SourceKind::Bool => Ok(row
            .try_get::<_, Option<bool>>(index)
            .map_err(|_| wrong())?
            .map_or(TransferValue::Null, TransferValue::Bool)),
        SourceKind::Int => {
            let value = match *row.columns()[index].type_() {
                Type::INT2 => row.try_get::<_, Option<i16>>(index).map(|v| v.map(i64::from)),
                Type::INT4 => row.try_get::<_, Option<i32>>(index).map(|v| v.map(i64::from)),
                _ => row.try_get::<_, Option<i64>>(index),
            };
            Ok(value.map_err(|_| wrong())?.map_or(TransferValue::Null, TransferValue::Int))
        }
        SourceKind::Bytes => Ok(row
            .try_get::<_, Option<Vec<u8>>>(index)
            .map_err(|_| wrong())?
            .map_or(TransferValue::Null, TransferValue::Bytes)),
        SourceKind::Float => match row.try_get::<_, Option<String>>(index).map_err(|_| wrong())? {
            None => Ok(TransferValue::Null),
            Some(text) => text
                .parse::<f64>()
                .map(TransferValue::Float)
                .map_err(|_| wrong()),
        },
        _ => Ok(row
            .try_get::<_, Option<String>>(index)
            .map_err(|_| wrong())?
            .map_or(TransferValue::Null, TransferValue::Text)),
    }
}

type Param = Box<dyn ToSql + Sync + Send>;

fn param(out: OutKind, value: &TransferValue) -> Result<Param, String> {
    Ok(match (out, value) {
        (OutKind::Bool, TransferValue::Null) => Box::new(None::<bool>),
        (OutKind::Bool, TransferValue::Bool(v)) => Box::new(*v),
        (OutKind::Int, TransferValue::Null) => Box::new(None::<i64>),
        (OutKind::Int, TransferValue::Int(v)) => Box::new(*v),
        (OutKind::Float, TransferValue::Null) => Box::new(None::<f64>),
        (OutKind::Float, TransferValue::Float(v)) => Box::new(*v),
        (OutKind::Text, TransferValue::Null) => Box::new(None::<String>),
        (OutKind::Text, TransferValue::Text(v)) => Box::new(v.clone()),
        (OutKind::Bytes, TransferValue::Null) => Box::new(None::<Vec<u8>>),
        (OutKind::Bytes, TransferValue::Bytes(v)) => Box::new(v.clone()),
        _ => return Err("A converted value does not match its bound type".to_string()),
    })
}

fn wire_type(out: OutKind) -> Type {
    match out {
        OutKind::Bool => Type::BOOL,
        OutKind::Int => Type::INT8,
        OutKind::Float => Type::FLOAT8,
        OutKind::Text => Type::TEXT,
        OutKind::Bytes => Type::BYTEA,
    }
}

fn cast_type(binding: &ColumnBinding) -> &'static str {
    match &binding.target_type {
        crate::table_transfer::TargetType::Pg(target) => target.cast_type(),
        crate::table_transfer::TargetType::Sqlite(_) => "text",
    }
}

pub(super) fn insert_sql(
    schema: &str,
    table: &str,
    bindings: &[ColumnBinding],
    rows: usize,
    conflict: ConflictMode,
) -> String {
    let columns: Vec<String> = bindings.iter().map(|b| quote(&b.target_column)).collect();
    let mut next = 1;
    let tuples: Vec<String> = (0..rows)
        .map(|_| {
            let cells: Vec<String> = bindings
                .iter()
                .map(|b| {
                    let cell = format!("CAST(${next} AS {})", cast_type(b));
                    next += 1;
                    cell
                })
                .collect();
            format!("({})", cells.join(", "))
        })
        .collect();
    let mut sql = format!(
        "INSERT INTO {} ({}) VALUES {}",
        qualified(schema, table),
        columns.join(", "),
        tuples.join(", ")
    );
    if conflict == ConflictMode::Skip {
        sql.push_str(" ON CONFLICT DO NOTHING");
    }
    sql
}

/// Writes one batch in its own transaction. Returns `(written, skipped)`.
pub(super) async fn write_batch(
    client: &mut deadpool_postgres::Object,
    schema: &str,
    table: &str,
    bindings: &[ColumnBinding],
    rows: &[Vec<TransferValue>],
    conflict: ConflictMode,
) -> Result<(u64, u64), String> {
    let per_statement = (MAX_PARAMS / bindings.len().max(1)).max(1);
    let tx = client.transaction().await.map_err(|e| describe_error(&e))?;
    let mut written = 0u64;
    for chunk in rows.chunks(per_statement) {
        let sql = insert_sql(schema, table, bindings, chunk.len(), conflict);
        let types: Vec<Type> = (0..chunk.len())
            .flat_map(|_| bindings.iter().map(|b| wire_type(b.conversion.out)))
            .collect();
        let statement = tx.prepare_typed(&sql, &types).await.map_err(|e| describe_error(&e))?;
        let mut params: Vec<Param> = Vec::with_capacity(types.len());
        for row in chunk {
            for (value, binding) in row.iter().zip(bindings) {
                params.push(param(binding.conversion.out, value)?);
            }
        }
        let refs: Vec<&(dyn ToSql + Sync)> = params.iter().map(|p| p.as_ref() as &(dyn ToSql + Sync)).collect();
        written += tx.execute(&statement, &refs).await.map_err(|e| describe_error(&e))?;
    }
    tx.commit().await.map_err(|e| describe_error(&e))?;
    Ok((written, rows.len() as u64 - written))
}

pub(super) async fn estimate_rows(pool: &deadpool_postgres::Pool, schema: &str, table: &str) -> Option<i64> {
    let client = pool.get().await.ok()?;
    let row = client
        .query_opt(
            "SELECT c.reltuples::bigint FROM pg_class c \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = $1 AND c.relname = $2",
            &[&schema, &table],
        )
        .await
        .ok()??;
    row.try_get::<_, i64>(0).ok().filter(|estimate| *estimate >= 0)
}
