use crate::table_transfer::{ColumnBinding, ConflictMode, TransferValue};
use sqlx::{Pool, Sqlite};

const MAX_PARAMS: usize = 30_000;

fn quote(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

/// SQLite messages name constraints and columns but never quote row values.
fn describe_error(error: sqlx::Error) -> String {
    match error {
        sqlx::Error::Database(db) => db.message().to_string(),
        _ => "SQLite error".to_string(),
    }
}

fn insert_sql(table: &str, bindings: &[ColumnBinding], rows: usize, conflict: ConflictMode) -> String {
    let columns: Vec<String> = bindings.iter().map(|b| quote(&b.target_column)).collect();
    let tuple = format!("({})", vec!["?"; bindings.len()].join(", "));
    let mut sql = format!(
        "INSERT INTO {} ({}) VALUES {}",
        quote(table),
        columns.join(", "),
        vec![tuple; rows].join(", ")
    );
    if conflict == ConflictMode::Skip {
        sql.push_str(" ON CONFLICT DO NOTHING");
    }
    sql
}

/// Writes one batch in its own transaction. Returns `(written, skipped)`.
pub(super) async fn write_batch(
    pool: &Pool<Sqlite>,
    table: &str,
    bindings: &[ColumnBinding],
    rows: &[Vec<TransferValue>],
    conflict: ConflictMode,
) -> Result<(u64, u64), String> {
    let per_statement = (MAX_PARAMS / bindings.len().max(1)).max(1);
    let mut tx = pool.begin().await.map_err(describe_error)?;
    let mut written = 0u64;
    for chunk in rows.chunks(per_statement) {
        let sql = insert_sql(table, bindings, chunk.len(), conflict);
        let mut query = sqlx::query(&sql);
        for value in chunk.iter().flatten() {
            query = match value {
                TransferValue::Null => query.bind(None::<i64>),
                TransferValue::Bool(v) => query.bind(i64::from(*v)),
                TransferValue::Int(v) => query.bind(*v),
                TransferValue::Float(v) => query.bind(*v),
                TransferValue::Text(v) => query.bind(v.clone()),
                TransferValue::Bytes(v) => query.bind(v.clone()),
            };
        }
        written += query.execute(&mut *tx).await.map_err(describe_error)?.rows_affected();
    }
    tx.commit().await.map_err(describe_error)?;
    Ok((written, rows.len() as u64 - written))
}
