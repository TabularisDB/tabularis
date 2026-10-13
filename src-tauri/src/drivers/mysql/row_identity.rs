use std::collections::{HashMap, HashSet};

use super::{fetch_all_rows, mysql_row_str, TextProto};

pub(super) async fn get_float_columns(
    pool: &sqlx::MySqlPool,
    text: TextProto,
    table: &str,
    pk_map: &HashMap<String, serde_json::Value>,
) -> HashSet<String> {
    if !pk_map
        .values()
        .any(|v| v.as_f64().is_some_and(|f| f64::from(f as f32) != f))
    {
        return HashSet::new();
    }
    let sql = "SELECT column_name FROM information_schema.columns \
               WHERE table_schema = DATABASE() AND table_name = ? AND data_type = 'float'";
    match fetch_all_rows(pool, text, sql, &[table]).await {
        Ok(rows) => rows.iter().map(|row| mysql_row_str(row, 0)).collect(),
        Err(error) => {
            log::warn!("MySQL: Could not read FLOAT columns for `{table}`: {error}");
            HashSet::new()
        }
    }
}
