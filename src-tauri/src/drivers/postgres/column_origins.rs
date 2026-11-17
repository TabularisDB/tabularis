//! Resolves where the columns of a result set come from.
//!
//! PostgreSQL's `RowDescription` carries, for every column that is a plain
//! reference to a table column, the OID of that table and the column's
//! attribute number (`Column::table_oid()` / `Column::column_id()` in
//! `tokio_postgres`). Both are zero for expressions. The OIDs are resolved to
//! schema, table and column names with one catalog query per result set, which
//! covers every distinct table of a join at once.

use std::collections::HashMap;

use crate::models::ColumnSource;

/// `(table oid, attribute number)` as reported for one result column.
pub type ColumnOrigin = (Option<u32>, Option<i16>);

/// Names resolved from the catalog for one `(table oid, attribute number)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedOrigin {
    pub schema: String,
    pub table: String,
    pub column: String,
}

/// The distinct, resolvable keys of a result set. Columns without a table
/// (expressions) and system columns (negative attribute numbers) are skipped.
pub fn lookup_keys(origins: &[ColumnOrigin]) -> Vec<(u32, i16)> {
    let mut keys: Vec<(u32, i16)> = origins
        .iter()
        .filter_map(|(oid, attnum)| match (oid, attnum) {
            (Some(oid), Some(attnum)) if *oid != 0 && *attnum > 0 => Some((*oid, *attnum)),
            _ => None,
        })
        .collect();
    keys.sort_unstable();
    keys.dedup();
    keys
}

/// Builds the `column_sources` array, aligned with the result columns. A
/// column is `None` when it has no table origin or the catalog could not name
/// it (for example the table was dropped while the query ran).
pub fn build_column_sources(
    origins: &[ColumnOrigin],
    resolved: &HashMap<(u32, i16), ResolvedOrigin>,
) -> Vec<Option<ColumnSource>> {
    origins
        .iter()
        .map(|(oid, attnum)| {
            let key = ((*oid)?, (*attnum)?);
            let r = resolved.get(&key)?;
            Some(ColumnSource {
                schema: Some(r.schema.clone()),
                table: r.table.clone(),
                column: r.column.clone(),
                // PostgreSQL does not report the alias a table has in the query.
                table_alias: None,
            })
        })
        .collect()
}

/// Looks the keys up in the catalog. Any failure yields an empty map, so the
/// result simply has no origins (read-only) instead of the query failing.
pub async fn resolve_origins(
    client: &tokio_postgres::Client,
    keys: &[(u32, i16)],
) -> HashMap<(u32, i16), ResolvedOrigin> {
    let mut out = HashMap::new();
    if keys.is_empty() {
        return out;
    }
    let oids: Vec<u32> = keys.iter().map(|k| k.0).collect();
    let attnums: Vec<i16> = keys.iter().map(|k| k.1).collect();
    let sql = "SELECT a.attrelid, a.attnum, n.nspname, c.relname, a.attname \
               FROM unnest($1::oid[], $2::int2[]) AS k(oid, attnum) \
               JOIN pg_catalog.pg_attribute a ON a.attrelid = k.oid AND a.attnum = k.attnum \
               JOIN pg_catalog.pg_class c ON c.oid = a.attrelid \
               JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
               WHERE NOT a.attisdropped";
    let rows = match client.query(sql, &[&oids, &attnums]).await {
        Ok(rows) => rows,
        Err(_) => return out,
    };
    for row in rows {
        let (Ok(oid), Ok(attnum), Ok(schema), Ok(table), Ok(column)) = (
            row.try_get::<_, u32>(0),
            row.try_get::<_, i16>(1),
            row.try_get::<_, String>(2),
            row.try_get::<_, String>(3),
            row.try_get::<_, String>(4),
        ) else {
            continue;
        };
        out.insert(
            (oid, attnum),
            ResolvedOrigin {
                schema,
                table,
                column,
            },
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolved() -> HashMap<(u32, i16), ResolvedOrigin> {
        let mut m = HashMap::new();
        m.insert(
            (16384, 1),
            ResolvedOrigin {
                schema: "public".into(),
                table: "orders".into(),
                column: "id".into(),
            },
        );
        m.insert(
            (16390, 2),
            ResolvedOrigin {
                schema: "public".into(),
                table: "customers".into(),
                column: "name".into(),
            },
        );
        m
    }

    #[test]
    fn lookup_keys_skips_expressions_and_system_columns_and_dedupes() {
        let origins = vec![
            (Some(16384), Some(1)),
            (Some(16384), Some(1)),
            (Some(0), Some(0)),
            (None, None),
            (Some(16384), Some(-1)),
            (Some(16390), Some(2)),
        ];
        assert_eq!(lookup_keys(&origins), vec![(16384, 1), (16390, 2)]);
    }

    #[test]
    fn build_maps_join_columns_to_their_tables_and_expressions_to_none() {
        let origins = vec![
            (Some(16384), Some(1)),
            (Some(16390), Some(2)),
            (Some(0), Some(0)),
        ];
        let sources = build_column_sources(&origins, &resolved());
        assert_eq!(sources.len(), 3);
        assert_eq!(
            sources[0],
            Some(ColumnSource {
                schema: Some("public".into()),
                table: "orders".into(),
                column: "id".into(),
                table_alias: None,
            })
        );
        assert_eq!(sources[1].as_ref().unwrap().table, "customers");
        assert_eq!(sources[2], None);
    }

    #[test]
    fn build_uses_the_original_column_name_not_the_label() {
        // `SELECT id AS order_id` reports the same origin as `SELECT id`.
        let sources = build_column_sources(&[(Some(16384), Some(1))], &resolved());
        assert_eq!(sources[0].as_ref().unwrap().column, "id");
    }

    #[test]
    fn unresolved_origin_is_none() {
        let sources = build_column_sources(&[(Some(99999), Some(1))], &HashMap::new());
        assert_eq!(sources, vec![None]);
    }

    #[test]
    fn serializes_as_documented_json() {
        let sources =
            build_column_sources(&[(Some(16384), Some(1)), (Some(0), Some(0))], &resolved());
        let v = serde_json::to_value(&sources).unwrap();
        assert_eq!(
            v,
            serde_json::json!([
                {"schema": "public", "table": "orders", "column": "id"},
                null
            ])
        );
    }
}
