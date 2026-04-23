//! SQL Server schema introspection.
//!
//! The SQL strings are exposed as `pub const` so they can be asserted on in
//! unit tests (clean-room, no smoke-testing against a live server at compile
//! time). Async helpers execute each query via tiberius and normalise the
//! result into the public Tabularis models (`TableInfo`, `TableColumn`, ...).
//!
//! All queries qualify objects with `@P1` / `@P2` tiberius parameter markers;
//! we never interpolate user input.

use crate::drivers::sqlserver::helpers::qualify;
use crate::drivers::sqlserver::pool::TiberiusConnection;
use crate::models::{
    ForeignKey, Index, RoutineInfo, RoutineParameter, TableColumn, TableInfo, TableSchema,
    ViewInfo,
};
use std::collections::HashMap;

// --- SQL query constants --------------------------------------------------

pub const Q_GET_TABLES: &str = "\
SELECT t.name \
FROM sys.tables t \
JOIN sys.schemas s ON t.schema_id = s.schema_id \
WHERE s.name = @P1 \
ORDER BY t.name";

pub const Q_GET_COLUMNS: &str = "\
SELECT \
    c.name AS name, \
    ty.name AS data_type, \
    c.is_nullable AS is_nullable, \
    c.is_identity AS is_identity, \
    CAST(c.max_length AS INT) AS max_length, \
    CAST(ISNULL(( \
        SELECT TOP 1 1 \
        FROM sys.index_columns ic \
        JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id \
        WHERE ic.object_id = c.object_id \
          AND ic.column_id = c.column_id \
          AND i.is_primary_key = 1 \
    ), 0) AS BIT) AS is_pk, \
    dc.definition AS default_value \
FROM sys.columns c \
JOIN sys.types ty ON c.user_type_id = ty.user_type_id \
LEFT JOIN sys.default_constraints dc \
    ON dc.parent_object_id = c.object_id \
    AND dc.parent_column_id = c.column_id \
WHERE c.object_id = OBJECT_ID(@P1) \
ORDER BY c.column_id";

/// Phase 1 emits one row per FK column (like PG/MySQL drivers). Composite
/// FK grouping happens client-side by `constraint_name` — Phase 2 switches
/// the model to multi-column arrays.
pub const Q_GET_FOREIGN_KEYS: &str = "\
SELECT \
    rc.CONSTRAINT_NAME AS name, \
    kcu.COLUMN_NAME AS column_name, \
    kcu2.TABLE_NAME AS ref_table, \
    kcu2.COLUMN_NAME AS ref_column, \
    rc.UPDATE_RULE AS on_update, \
    rc.DELETE_RULE AS on_delete \
FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc \
JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu \
    ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME \
   AND rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA \
JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2 \
    ON rc.UNIQUE_CONSTRAINT_NAME = kcu2.CONSTRAINT_NAME \
   AND rc.UNIQUE_CONSTRAINT_SCHEMA = kcu2.CONSTRAINT_SCHEMA \
   AND kcu.ORDINAL_POSITION = kcu2.ORDINAL_POSITION \
WHERE kcu.TABLE_SCHEMA = @P1 AND kcu.TABLE_NAME = @P2 \
ORDER BY rc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION";

pub const Q_GET_VIEWS: &str = "\
SELECT v.name \
FROM sys.views v \
JOIN sys.schemas s ON v.schema_id = s.schema_id \
WHERE s.name = @P1 \
ORDER BY v.name";

pub const Q_GET_MODULE_DEFINITION: &str = "\
SELECT definition \
FROM sys.sql_modules \
WHERE object_id = OBJECT_ID(@P1)";

pub const Q_GET_ROUTINES: &str = "\
SELECT ROUTINE_NAME, ROUTINE_TYPE \
FROM INFORMATION_SCHEMA.ROUTINES \
WHERE ROUTINE_SCHEMA = @P1 \
ORDER BY ROUTINE_TYPE, ROUTINE_NAME";

/// `PARAMETER_NAME` is NULL for a scalar-function return slot; we filter
/// those out because Tabularis' `RoutineParameter` struct requires a name.
pub const Q_GET_ROUTINE_PARAMETERS: &str = "\
SELECT \
    PARAMETER_NAME AS name, \
    DATA_TYPE AS data_type, \
    PARAMETER_MODE AS mode, \
    CAST(ORDINAL_POSITION AS INT) AS ordinal_position \
FROM INFORMATION_SCHEMA.PARAMETERS \
WHERE SPECIFIC_SCHEMA = @P1 \
  AND SPECIFIC_NAME = @P2 \
  AND PARAMETER_NAME IS NOT NULL \
ORDER BY ORDINAL_POSITION";

/// Batch-fetch all columns for every table in a schema in one round-trip.
/// Used by the ER diagram to avoid an N+1 query per table.
pub const Q_GET_ALL_COLUMNS_BATCH: &str = "\
SELECT \
    t.name AS table_name, \
    c.name AS name, \
    ty.name AS data_type, \
    c.is_nullable AS is_nullable, \
    c.is_identity AS is_identity, \
    CAST(c.max_length AS INT) AS max_length, \
    CAST(ISNULL(( \
        SELECT TOP 1 1 \
        FROM sys.index_columns ic \
        JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id \
        WHERE ic.object_id = c.object_id \
          AND ic.column_id = c.column_id \
          AND i.is_primary_key = 1 \
    ), 0) AS BIT) AS is_pk, \
    dc.definition AS default_value \
FROM sys.columns c \
JOIN sys.tables t ON c.object_id = t.object_id \
JOIN sys.schemas s ON t.schema_id = s.schema_id \
JOIN sys.types ty ON c.user_type_id = ty.user_type_id \
LEFT JOIN sys.default_constraints dc \
    ON dc.parent_object_id = c.object_id \
    AND dc.parent_column_id = c.column_id \
WHERE s.name = @P1 \
ORDER BY t.name, c.column_id";

/// Batch-fetch all FK columns for every table in a schema. One row per FK
/// column (Phase 1 shape — Phase 2 will aggregate composite FKs).
pub const Q_GET_ALL_FOREIGN_KEYS_BATCH: &str = "\
SELECT \
    kcu.TABLE_NAME AS table_name, \
    rc.CONSTRAINT_NAME AS name, \
    kcu.COLUMN_NAME AS column_name, \
    kcu2.TABLE_NAME AS ref_table, \
    kcu2.COLUMN_NAME AS ref_column, \
    rc.UPDATE_RULE AS on_update, \
    rc.DELETE_RULE AS on_delete \
FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc \
JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu \
    ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME \
   AND rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA \
JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2 \
    ON rc.UNIQUE_CONSTRAINT_NAME = kcu2.CONSTRAINT_NAME \
   AND rc.UNIQUE_CONSTRAINT_SCHEMA = kcu2.CONSTRAINT_SCHEMA \
   AND kcu.ORDINAL_POSITION = kcu2.ORDINAL_POSITION \
WHERE kcu.TABLE_SCHEMA = @P1 \
ORDER BY kcu.TABLE_NAME, rc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION";

/// Indexes: one row per (index, column) pair. Tabularis' `Index` struct maps
/// 1:1 to this shape and the frontend groups by `name`.
pub const Q_GET_INDEXES: &str = "\
SELECT \
    i.name AS name, \
    c.name AS column_name, \
    i.is_unique AS is_unique, \
    i.is_primary_key AS is_primary, \
    CAST(ic.key_ordinal AS INT) AS seq_in_index \
FROM sys.indexes i \
JOIN sys.index_columns ic \
    ON i.object_id = ic.object_id AND i.index_id = ic.index_id \
JOIN sys.columns c \
    ON ic.object_id = c.object_id AND ic.column_id = c.column_id \
WHERE i.object_id = OBJECT_ID(@P1) \
  AND i.type > 0 \
  AND i.name IS NOT NULL \
ORDER BY i.name, ic.key_ordinal";

// --- Pure SQL Server type helpers ----------------------------------------

/// Column names whose `max_length` in `sys.columns` measures bytes, not chars.
/// Handles `nchar` / `nvarchar` (2 bytes per char) and treats `-1` (MAX) as
/// "unbounded" (returns `None`).
pub fn character_length_from_sys_columns(data_type: &str, max_length_bytes: i32) -> Option<u64> {
    if max_length_bytes < 0 {
        // -1 means MAX (nvarchar(MAX), varbinary(MAX), ...). Represent as None.
        return None;
    }
    let lower = data_type.to_ascii_lowercase();
    match lower.as_str() {
        // Double-byte encodings: divide by 2 to get char count.
        "nchar" | "nvarchar" | "ntext" => Some((max_length_bytes as u64) / 2),
        // Single-byte character or raw binary types: bytes == chars.
        "char" | "varchar" | "text" | "binary" | "varbinary" | "image" | "xml"
        | "sysname" => Some(max_length_bytes as u64),
        // Numeric/date/uuid/etc. types do not carry a character length.
        _ => None,
    }
}

/// Normalise `INFORMATION_SCHEMA.PARAMETERS.PARAMETER_MODE` into Tabularis'
/// three canonical values: `"IN"`, `"OUT"`, `"INOUT"`. SQL Server emits the
/// mode in uppercase; we normalise whitespace and map unknown / NULL values
/// to `"IN"` (the least surprising default).
pub fn normalize_routine_mode(raw: Option<&str>) -> String {
    let s = raw.unwrap_or("IN").trim().to_ascii_uppercase();
    match s.as_str() {
        "OUT" => "OUT".into(),
        "INOUT" => "INOUT".into(),
        "IN" | "" => "IN".into(),
        _ => "IN".into(),
    }
}

/// Normalise `INFORMATION_SCHEMA.ROUTINES.ROUTINE_TYPE` to the canonical
/// `"PROCEDURE"` / `"FUNCTION"`. Anything unrecognised becomes
/// `"PROCEDURE"` (the conservative default — matches Tabularis' existing
/// drivers that treat unknowns as callable routines).
pub fn normalize_routine_type(raw: Option<&str>) -> String {
    let s = raw.unwrap_or("").trim().to_ascii_uppercase();
    match s.as_str() {
        "FUNCTION" => "FUNCTION".into(),
        _ => "PROCEDURE".into(),
    }
}

/// Pure builder for [`TableColumn`] from the raw column-level fields returned
/// by the `sys.*` introspection queries. Extracted out of the async paths so
/// the field-by-field mapping — including the non-obvious
/// `character_maximum_length` policy — stays unit-testable.
pub fn build_table_column(
    name: String,
    data_type: String,
    is_nullable: bool,
    is_identity: bool,
    max_length_bytes: i32,
    is_pk: bool,
    default_value: Option<String>,
) -> TableColumn {
    let character_maximum_length = if is_string_type(&data_type) {
        character_length_from_sys_columns(&data_type, max_length_bytes)
    } else {
        None
    };
    TableColumn {
        name,
        data_type,
        is_pk,
        is_nullable,
        is_auto_increment: is_identity,
        default_value,
        character_maximum_length,
    }
}

/// Pure builder for [`ForeignKey`]. Kept alongside [`build_table_column`] so
/// the two are symmetric and both reachable from tests.
pub fn build_foreign_key(
    name: String,
    column_name: String,
    ref_table: String,
    ref_column: String,
    on_update: Option<String>,
    on_delete: Option<String>,
) -> ForeignKey {
    ForeignKey {
        name,
        column_name,
        ref_table,
        ref_column,
        on_update,
        on_delete,
    }
}

/// Whether a given SQL Server type name is a string-like type that should
/// advertise `character_maximum_length` to the UI.
pub fn is_string_type(data_type: &str) -> bool {
    matches!(
        data_type.to_ascii_lowercase().as_str(),
        "char"
            | "varchar"
            | "nchar"
            | "nvarchar"
            | "text"
            | "ntext"
            | "binary"
            | "varbinary"
            | "image"
            | "xml"
            | "sysname"
    )
}

// --- Async query helpers --------------------------------------------------

fn row_str(row: &tiberius::Row, col: &str) -> String {
    row.get::<&str, _>(col).unwrap_or("").to_string()
}

fn row_str_opt(row: &tiberius::Row, col: &str) -> Option<String> {
    row.get::<&str, _>(col).map(|s| s.to_string())
}

fn row_bool(row: &tiberius::Row, col: &str) -> bool {
    row.get::<bool, _>(col).unwrap_or(false)
}

fn row_i32(row: &tiberius::Row, col: &str) -> i32 {
    row.get::<i32, _>(col).unwrap_or(0)
}

pub async fn get_tables(
    conn: &mut TiberiusConnection,
    schema: &str,
) -> Result<Vec<TableInfo>, String> {
    let rows = conn
        .query(Q_GET_TABLES, &[&schema])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .filter_map(|r| r.get::<&str, _>(0).map(|n| TableInfo { name: n.to_string() }))
        .collect())
}

pub async fn get_columns(
    conn: &mut TiberiusConnection,
    table: &str,
    schema: Option<&str>,
) -> Result<Vec<TableColumn>, String> {
    let qualified = qualify(schema, table);
    let rows = conn
        .query(Q_GET_COLUMNS, &[&qualified])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|r| {
            build_table_column(
                row_str(&r, "name"),
                row_str(&r, "data_type"),
                row_bool(&r, "is_nullable"),
                row_bool(&r, "is_identity"),
                row_i32(&r, "max_length"),
                row_bool(&r, "is_pk"),
                row_str_opt(&r, "default_value"),
            )
        })
        .collect())
}

pub async fn get_foreign_keys(
    conn: &mut TiberiusConnection,
    table: &str,
    schema: Option<&str>,
) -> Result<Vec<ForeignKey>, String> {
    let schema = schema.unwrap_or("dbo");
    let rows = conn
        .query(Q_GET_FOREIGN_KEYS, &[&schema, &table])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|r| {
            build_foreign_key(
                row_str(&r, "name"),
                row_str(&r, "column_name"),
                row_str(&r, "ref_table"),
                row_str(&r, "ref_column"),
                row_str_opt(&r, "on_update"),
                row_str_opt(&r, "on_delete"),
            )
        })
        .collect())
}

pub async fn get_all_columns_batch(
    conn: &mut TiberiusConnection,
    schema: &str,
) -> Result<HashMap<String, Vec<TableColumn>>, String> {
    let rows = conn
        .query(Q_GET_ALL_COLUMNS_BATCH, &[&schema])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let mut out: HashMap<String, Vec<TableColumn>> = HashMap::new();
    for r in rows {
        let table_name = row_str(&r, "table_name");
        let col = build_table_column(
            row_str(&r, "name"),
            row_str(&r, "data_type"),
            row_bool(&r, "is_nullable"),
            row_bool(&r, "is_identity"),
            row_i32(&r, "max_length"),
            row_bool(&r, "is_pk"),
            row_str_opt(&r, "default_value"),
        );
        out.entry(table_name).or_default().push(col);
    }
    Ok(out)
}

pub async fn get_all_foreign_keys_batch(
    conn: &mut TiberiusConnection,
    schema: &str,
) -> Result<HashMap<String, Vec<ForeignKey>>, String> {
    let rows = conn
        .query(Q_GET_ALL_FOREIGN_KEYS_BATCH, &[&schema])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let mut out: HashMap<String, Vec<ForeignKey>> = HashMap::new();
    for r in rows {
        let table_name = row_str(&r, "table_name");
        let fk = build_foreign_key(
            row_str(&r, "name"),
            row_str(&r, "column_name"),
            row_str(&r, "ref_table"),
            row_str(&r, "ref_column"),
            row_str_opt(&r, "on_update"),
            row_str_opt(&r, "on_delete"),
        );
        out.entry(table_name).or_default().push(fk);
    }
    Ok(out)
}

/// Build the full per-schema snapshot in three round-trips: tables, columns
/// batch, FK batch. Missing columns or FK for a table → empty Vec (never
/// omitted from the result).
pub async fn get_schema_snapshot(
    conn: &mut TiberiusConnection,
    schema: &str,
) -> Result<Vec<TableSchema>, String> {
    let tables = get_tables(conn, schema).await?;
    let mut columns_by_table = get_all_columns_batch(conn, schema).await?;
    let mut fks_by_table = get_all_foreign_keys_batch(conn, schema).await?;

    Ok(tables
        .into_iter()
        .map(|t| TableSchema {
            columns: columns_by_table.remove(&t.name).unwrap_or_default(),
            foreign_keys: fks_by_table.remove(&t.name).unwrap_or_default(),
            name: t.name,
        })
        .collect())
}

pub async fn get_views(
    conn: &mut TiberiusConnection,
    schema: &str,
) -> Result<Vec<ViewInfo>, String> {
    let rows = conn
        .query(Q_GET_VIEWS, &[&schema])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .filter_map(|r| {
            r.get::<&str, _>(0).map(|n| ViewInfo {
                name: n.to_string(),
                // Definition is fetched lazily — matches MySQL/Postgres driver behaviour.
                definition: None,
            })
        })
        .collect())
}

pub async fn get_module_definition(
    conn: &mut TiberiusConnection,
    object_name: &str,
    schema: Option<&str>,
) -> Result<String, String> {
    let qualified = qualify(schema, object_name);
    let rows = conn
        .query(Q_GET_MODULE_DEFINITION, &[&qualified])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    rows.into_iter()
        .next()
        .and_then(|r| r.get::<&str, _>(0).map(|s| s.to_string()))
        .ok_or_else(|| format!("Definition not found for {}", qualified))
}

pub async fn get_routines(
    conn: &mut TiberiusConnection,
    schema: &str,
) -> Result<Vec<RoutineInfo>, String> {
    let rows = conn
        .query(Q_GET_ROUTINES, &[&schema])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|r| {
            let name = r.get::<&str, _>(0).unwrap_or("").to_string();
            let routine_type = normalize_routine_type(r.get::<&str, _>(1));
            RoutineInfo {
                name,
                routine_type,
                definition: None, // Lazy — fetched via get_module_definition.
            }
        })
        .filter(|r| !r.name.is_empty())
        .collect())
}

pub async fn get_routine_parameters(
    conn: &mut TiberiusConnection,
    routine_name: &str,
    schema: &str,
) -> Result<Vec<RoutineParameter>, String> {
    let rows = conn
        .query(Q_GET_ROUTINE_PARAMETERS, &[&schema, &routine_name])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|r| RoutineParameter {
            name: row_str(&r, "name"),
            data_type: row_str(&r, "data_type"),
            mode: normalize_routine_mode(r.get::<&str, _>("mode")),
            ordinal_position: row_i32(&r, "ordinal_position"),
        })
        .collect())
}

pub async fn get_indexes(
    conn: &mut TiberiusConnection,
    table: &str,
    schema: Option<&str>,
) -> Result<Vec<Index>, String> {
    let qualified = qualify(schema, table);
    let rows = conn
        .query(Q_GET_INDEXES, &[&qualified])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|r| Index {
            name: row_str(&r, "name"),
            column_name: row_str(&r, "column_name"),
            is_unique: row_bool(&r, "is_unique"),
            is_primary: row_bool(&r, "is_primary"),
            seq_in_index: row_i32(&r, "seq_in_index"),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Query shape assertions (no live server needed) -------------------

    #[test]
    fn q_get_tables_queries_sys_tables_and_schemas() {
        assert!(Q_GET_TABLES.contains("sys.tables"));
        assert!(Q_GET_TABLES.contains("sys.schemas"));
        assert!(Q_GET_TABLES.contains("@P1"));
        assert!(Q_GET_TABLES.contains("ORDER BY t.name"));
    }

    #[test]
    fn q_get_columns_joins_sys_types_and_reports_pk() {
        assert!(Q_GET_COLUMNS.contains("sys.columns"));
        assert!(Q_GET_COLUMNS.contains("sys.types"));
        assert!(Q_GET_COLUMNS.contains("sys.index_columns"));
        assert!(Q_GET_COLUMNS.contains("sys.indexes"));
        assert!(Q_GET_COLUMNS.contains("is_primary_key"));
        assert!(Q_GET_COLUMNS.contains("sys.default_constraints"));
        assert!(Q_GET_COLUMNS.contains("OBJECT_ID(@P1)"));
        assert!(Q_GET_COLUMNS.contains("ORDER BY c.column_id"));
    }

    #[test]
    fn q_get_foreign_keys_uses_information_schema() {
        assert!(Q_GET_FOREIGN_KEYS.contains("INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS"));
        assert!(Q_GET_FOREIGN_KEYS.contains("INFORMATION_SCHEMA.KEY_COLUMN_USAGE"));
        assert!(Q_GET_FOREIGN_KEYS.contains("@P1"));
        assert!(Q_GET_FOREIGN_KEYS.contains("@P2"));
        assert!(Q_GET_FOREIGN_KEYS.contains("ORDER BY"));
        // The join must pair parent/unique constraints on ordinal position so
        // a composite FK yields rows where (col, ref_col) are matched, not
        // cartesian-producted.
        assert!(Q_GET_FOREIGN_KEYS.contains("ORDINAL_POSITION"));
    }

    #[test]
    fn q_get_indexes_excludes_heap_and_unnamed() {
        assert!(Q_GET_INDEXES.contains("sys.indexes"));
        assert!(Q_GET_INDEXES.contains("sys.index_columns"));
        assert!(Q_GET_INDEXES.contains("sys.columns"));
        assert!(Q_GET_INDEXES.contains("i.type > 0"));
        assert!(Q_GET_INDEXES.contains("i.name IS NOT NULL"));
    }

    // --- character_length_from_sys_columns -------------------------------

    #[test]
    fn character_length_maps_nvarchar_bytes_to_chars() {
        // nvarchar(10) -> max_length = 20 bytes -> 10 chars
        assert_eq!(character_length_from_sys_columns("nvarchar", 20), Some(10));
        assert_eq!(character_length_from_sys_columns("NVARCHAR", 20), Some(10));
        assert_eq!(character_length_from_sys_columns("nchar", 40), Some(20));
        assert_eq!(character_length_from_sys_columns("ntext", 2), Some(1));
    }

    #[test]
    fn character_length_passes_varchar_through() {
        // varchar(255) -> max_length = 255 bytes == 255 chars
        assert_eq!(character_length_from_sys_columns("varchar", 255), Some(255));
        assert_eq!(character_length_from_sys_columns("char", 10), Some(10));
        assert_eq!(character_length_from_sys_columns("varbinary", 64), Some(64));
        assert_eq!(character_length_from_sys_columns("binary", 8), Some(8));
    }

    #[test]
    fn character_length_treats_max_as_none() {
        // In sys.columns, MAX is encoded as -1.
        assert_eq!(character_length_from_sys_columns("nvarchar", -1), None);
        assert_eq!(character_length_from_sys_columns("varchar", -1), None);
        assert_eq!(character_length_from_sys_columns("varbinary", -1), None);
    }

    #[test]
    fn character_length_is_none_for_numeric_types() {
        assert_eq!(character_length_from_sys_columns("int", 4), None);
        assert_eq!(character_length_from_sys_columns("bigint", 8), None);
        assert_eq!(character_length_from_sys_columns("decimal", 17), None);
        assert_eq!(character_length_from_sys_columns("bit", 1), None);
        assert_eq!(character_length_from_sys_columns("datetime2", 8), None);
        assert_eq!(character_length_from_sys_columns("uniqueidentifier", 16), None);
    }

    #[test]
    fn is_string_type_covers_all_text_family() {
        for t in &[
            "char",
            "varchar",
            "nchar",
            "nvarchar",
            "text",
            "ntext",
            "binary",
            "varbinary",
            "image",
            "xml",
            "sysname",
        ] {
            assert!(is_string_type(t), "{} should be string-like", t);
            // Case-insensitive — tiberius gives us lowercase, but sys.types
            // occasionally echoes mixed case via sysname aliases.
            assert!(is_string_type(&t.to_ascii_uppercase()));
        }
    }

    #[test]
    fn q_get_all_columns_batch_groups_by_table() {
        assert!(Q_GET_ALL_COLUMNS_BATCH.contains("sys.columns"));
        assert!(Q_GET_ALL_COLUMNS_BATCH.contains("sys.tables"));
        assert!(Q_GET_ALL_COLUMNS_BATCH.contains("sys.schemas"));
        assert!(Q_GET_ALL_COLUMNS_BATCH.contains("sys.types"));
        assert!(Q_GET_ALL_COLUMNS_BATCH.contains("@P1"));
        assert!(Q_GET_ALL_COLUMNS_BATCH.contains("ORDER BY t.name, c.column_id"));
        // Must emit the table name so the caller can group rows.
        assert!(Q_GET_ALL_COLUMNS_BATCH.contains("t.name AS table_name"));
    }

    #[test]
    fn q_get_all_foreign_keys_batch_emits_table_name() {
        assert!(Q_GET_ALL_FOREIGN_KEYS_BATCH.contains("INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS"));
        assert!(Q_GET_ALL_FOREIGN_KEYS_BATCH.contains("kcu.TABLE_NAME AS table_name"));
        assert!(Q_GET_ALL_FOREIGN_KEYS_BATCH.contains("@P1"));
        assert!(Q_GET_ALL_FOREIGN_KEYS_BATCH.contains("ORDER BY"));
        assert!(Q_GET_ALL_FOREIGN_KEYS_BATCH.contains("ORDINAL_POSITION"));
    }

    // --- build_table_column ----------------------------------------------

    #[test]
    fn build_table_column_populates_string_length() {
        let col = build_table_column(
            "note".into(),
            "nvarchar".into(),
            true,
            false,
            40,
            false,
            None,
        );
        assert_eq!(col.name, "note");
        assert_eq!(col.data_type, "nvarchar");
        assert!(col.is_nullable);
        assert!(!col.is_pk);
        assert!(!col.is_auto_increment);
        // nvarchar(20) -> max_length bytes = 40 -> chars = 20
        assert_eq!(col.character_maximum_length, Some(20));
    }

    #[test]
    fn build_table_column_leaves_length_none_for_numeric() {
        let col = build_table_column(
            "id".into(),
            "int".into(),
            false,
            true,
            4,
            true,
            None,
        );
        assert_eq!(col.character_maximum_length, None);
        assert!(col.is_pk);
        assert!(col.is_auto_increment);
    }

    #[test]
    fn build_table_column_honours_max_as_none() {
        // varbinary(MAX) -> max_length = -1
        let col = build_table_column(
            "payload".into(),
            "varbinary".into(),
            true,
            false,
            -1,
            false,
            None,
        );
        assert_eq!(col.character_maximum_length, None);
    }

    #[test]
    fn build_table_column_carries_default_value() {
        let col = build_table_column(
            "created".into(),
            "datetime2".into(),
            false,
            false,
            8,
            false,
            Some("(getdate())".into()),
        );
        assert_eq!(col.default_value, Some("(getdate())".into()));
        assert_eq!(col.character_maximum_length, None);
    }

    // --- build_foreign_key -----------------------------------------------

    #[test]
    fn build_foreign_key_assembles_all_fields() {
        let fk = build_foreign_key(
            "FK_orders_customer".into(),
            "customer_id".into(),
            "customers".into(),
            "id".into(),
            Some("NO ACTION".into()),
            Some("CASCADE".into()),
        );
        assert_eq!(fk.name, "FK_orders_customer");
        assert_eq!(fk.column_name, "customer_id");
        assert_eq!(fk.ref_table, "customers");
        assert_eq!(fk.ref_column, "id");
        assert_eq!(fk.on_update, Some("NO ACTION".into()));
        assert_eq!(fk.on_delete, Some("CASCADE".into()));
    }

    #[test]
    fn build_foreign_key_allows_missing_actions() {
        let fk = build_foreign_key(
            "FK_a".into(),
            "x".into(),
            "t".into(),
            "y".into(),
            None,
            None,
        );
        assert!(fk.on_update.is_none());
        assert!(fk.on_delete.is_none());
    }

    #[test]
    fn q_get_views_targets_sys_views() {
        assert!(Q_GET_VIEWS.contains("sys.views"));
        assert!(Q_GET_VIEWS.contains("sys.schemas"));
        assert!(Q_GET_VIEWS.contains("@P1"));
        assert!(Q_GET_VIEWS.contains("ORDER BY v.name"));
    }

    #[test]
    fn q_get_module_definition_targets_sys_sql_modules() {
        assert!(Q_GET_MODULE_DEFINITION.contains("sys.sql_modules"));
        assert!(Q_GET_MODULE_DEFINITION.contains("OBJECT_ID(@P1)"));
    }

    #[test]
    fn q_get_routines_uses_information_schema() {
        assert!(Q_GET_ROUTINES.contains("INFORMATION_SCHEMA.ROUTINES"));
        assert!(Q_GET_ROUTINES.contains("ROUTINE_NAME"));
        assert!(Q_GET_ROUTINES.contains("ROUTINE_TYPE"));
        assert!(Q_GET_ROUTINES.contains("@P1"));
        assert!(Q_GET_ROUTINES.contains("ORDER BY"));
    }

    #[test]
    fn q_get_routine_parameters_filters_null_names() {
        assert!(Q_GET_ROUTINE_PARAMETERS.contains("INFORMATION_SCHEMA.PARAMETERS"));
        assert!(Q_GET_ROUTINE_PARAMETERS.contains("PARAMETER_NAME IS NOT NULL"));
        assert!(Q_GET_ROUTINE_PARAMETERS.contains("@P1"));
        assert!(Q_GET_ROUTINE_PARAMETERS.contains("@P2"));
        assert!(Q_GET_ROUTINE_PARAMETERS.contains("ORDER BY ORDINAL_POSITION"));
    }

    #[test]
    fn normalize_routine_mode_maps_canonicals() {
        assert_eq!(normalize_routine_mode(Some("IN")), "IN");
        assert_eq!(normalize_routine_mode(Some("OUT")), "OUT");
        assert_eq!(normalize_routine_mode(Some("INOUT")), "INOUT");
    }

    #[test]
    fn normalize_routine_mode_is_case_insensitive() {
        assert_eq!(normalize_routine_mode(Some("in")), "IN");
        assert_eq!(normalize_routine_mode(Some("  Out  ")), "OUT");
        assert_eq!(normalize_routine_mode(Some("InOut")), "INOUT");
    }

    #[test]
    fn normalize_routine_mode_defaults_to_in_for_missing() {
        assert_eq!(normalize_routine_mode(None), "IN");
        assert_eq!(normalize_routine_mode(Some("")), "IN");
        assert_eq!(normalize_routine_mode(Some("   ")), "IN");
    }

    #[test]
    fn normalize_routine_mode_defaults_to_in_for_unknown() {
        assert_eq!(normalize_routine_mode(Some("readonly")), "IN");
        assert_eq!(normalize_routine_mode(Some("???")), "IN");
    }

    #[test]
    fn normalize_routine_type_maps_function_and_procedure() {
        assert_eq!(normalize_routine_type(Some("FUNCTION")), "FUNCTION");
        assert_eq!(normalize_routine_type(Some("function")), "FUNCTION");
        assert_eq!(normalize_routine_type(Some("PROCEDURE")), "PROCEDURE");
        assert_eq!(normalize_routine_type(Some("procedure")), "PROCEDURE");
    }

    #[test]
    fn normalize_routine_type_defaults_to_procedure() {
        assert_eq!(normalize_routine_type(None), "PROCEDURE");
        assert_eq!(normalize_routine_type(Some("")), "PROCEDURE");
        assert_eq!(normalize_routine_type(Some("TRIGGER")), "PROCEDURE");
    }

    #[test]
    fn is_string_type_excludes_non_string_types() {
        for t in &[
            "int",
            "bigint",
            "smallint",
            "tinyint",
            "bit",
            "decimal",
            "numeric",
            "float",
            "real",
            "money",
            "date",
            "time",
            "datetime",
            "datetime2",
            "datetimeoffset",
            "uniqueidentifier",
            "hierarchyid",
            "geography",
            "geometry",
            "sql_variant",
        ] {
            assert!(!is_string_type(t), "{} must NOT be string-like", t);
        }
    }
}
