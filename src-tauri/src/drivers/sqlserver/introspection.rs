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
use crate::drivers::sqlserver::pool::BridgeConnection;
use crate::models::{
    ForeignKey, Index, RoutineInfo, RoutineParameter, TableColumn, TableInfo, TableSchema, ViewInfo,
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

/// Phase 2 (#146): SQL Server 2017+ FK query using `STRING_AGG` to collapse
/// every column of a constraint into a single row with comma-separated
/// `columns` / `ref_columns`. One row per constraint regardless of column
/// count. Gated by [`crate::drivers::sqlserver::version::ServerVersion::supports_string_agg`].
pub const Q_GET_FOREIGN_KEYS_STRING_AGG: &str = "\
SELECT \
    fk.name AS name, \
    rs.name AS ref_schema, \
    rt.name AS ref_table, \
    STRING_AGG(pc.name, ',') WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS columns, \
    STRING_AGG(rc.name, ',') WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS ref_columns, \
    CASE fk.update_referential_action \
        WHEN 0 THEN 'NO ACTION' WHEN 1 THEN 'CASCADE' \
        WHEN 2 THEN 'SET NULL' WHEN 3 THEN 'SET DEFAULT' \
    END AS on_update, \
    CASE fk.delete_referential_action \
        WHEN 0 THEN 'NO ACTION' WHEN 1 THEN 'CASCADE' \
        WHEN 2 THEN 'SET NULL' WHEN 3 THEN 'SET DEFAULT' \
    END AS on_delete \
FROM sys.foreign_keys fk \
JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id \
JOIN sys.tables pt ON fk.parent_object_id = pt.object_id \
JOIN sys.schemas ps ON pt.schema_id = ps.schema_id \
JOIN sys.tables rt ON fk.referenced_object_id = rt.object_id \
JOIN sys.schemas rs ON rt.schema_id = rs.schema_id \
JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id \
JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id \
WHERE ps.name = @P1 AND pt.name = @P2 \
GROUP BY fk.name, rs.name, rt.name, fk.update_referential_action, fk.delete_referential_action \
ORDER BY fk.name";

/// Phase 2 (#146): SQL Server 2012-2016 fallback using `STUFF(... FOR XML \
/// PATH(''))` to aggregate FK columns. Same row shape as
/// [`Q_GET_FOREIGN_KEYS_STRING_AGG`] so the caller doesn't branch on parsing.
pub const Q_GET_FOREIGN_KEYS_XML_PATH: &str = "\
SELECT \
    fk.name AS name, \
    rs.name AS ref_schema, \
    rt.name AS ref_table, \
    STUFF(( \
        SELECT ',' + pc.name \
        FROM sys.foreign_key_columns fkc \
        JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id \
        WHERE fkc.constraint_object_id = fk.object_id \
        ORDER BY fkc.constraint_column_id \
        FOR XML PATH(''), TYPE \
    ).value('.', 'NVARCHAR(MAX)'), 1, 1, '') AS columns, \
    STUFF(( \
        SELECT ',' + rc.name \
        FROM sys.foreign_key_columns fkc \
        JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id \
        WHERE fkc.constraint_object_id = fk.object_id \
        ORDER BY fkc.constraint_column_id \
        FOR XML PATH(''), TYPE \
    ).value('.', 'NVARCHAR(MAX)'), 1, 1, '') AS ref_columns, \
    CASE fk.update_referential_action \
        WHEN 0 THEN 'NO ACTION' WHEN 1 THEN 'CASCADE' \
        WHEN 2 THEN 'SET NULL' WHEN 3 THEN 'SET DEFAULT' \
    END AS on_update, \
    CASE fk.delete_referential_action \
        WHEN 0 THEN 'NO ACTION' WHEN 1 THEN 'CASCADE' \
        WHEN 2 THEN 'SET NULL' WHEN 3 THEN 'SET DEFAULT' \
    END AS on_delete \
FROM sys.foreign_keys fk \
JOIN sys.tables pt ON fk.parent_object_id = pt.object_id \
JOIN sys.schemas ps ON pt.schema_id = ps.schema_id \
JOIN sys.tables rt ON fk.referenced_object_id = rt.object_id \
JOIN sys.schemas rs ON rt.schema_id = rs.schema_id \
WHERE ps.name = @P1 AND pt.name = @P2 \
ORDER BY fk.name";

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

/// Phase 2 (#146): SQL Server 2017+ batch variant — same shape as
/// [`Q_GET_FOREIGN_KEYS_STRING_AGG`] but groups across every table in the
/// schema and emits `table_name` so the caller can bucket by parent table.
pub const Q_GET_ALL_FOREIGN_KEYS_BATCH_STRING_AGG: &str = "\
SELECT \
    pt.name AS table_name, \
    fk.name AS name, \
    rs.name AS ref_schema, \
    rt.name AS ref_table, \
    STRING_AGG(pc.name, ',') WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS columns, \
    STRING_AGG(rc.name, ',') WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS ref_columns, \
    CASE fk.update_referential_action \
        WHEN 0 THEN 'NO ACTION' WHEN 1 THEN 'CASCADE' \
        WHEN 2 THEN 'SET NULL' WHEN 3 THEN 'SET DEFAULT' \
    END AS on_update, \
    CASE fk.delete_referential_action \
        WHEN 0 THEN 'NO ACTION' WHEN 1 THEN 'CASCADE' \
        WHEN 2 THEN 'SET NULL' WHEN 3 THEN 'SET DEFAULT' \
    END AS on_delete \
FROM sys.foreign_keys fk \
JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id \
JOIN sys.tables pt ON fk.parent_object_id = pt.object_id \
JOIN sys.schemas ps ON pt.schema_id = ps.schema_id \
JOIN sys.tables rt ON fk.referenced_object_id = rt.object_id \
JOIN sys.schemas rs ON rt.schema_id = rs.schema_id \
JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id \
JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id \
WHERE ps.name = @P1 \
GROUP BY pt.name, fk.name, rs.name, rt.name, fk.update_referential_action, fk.delete_referential_action \
ORDER BY pt.name, fk.name";

/// Phase 2 (#146): SQL Server 2012-2016 batch fallback using STUFF / FOR XML
/// PATH. Same shape as [`Q_GET_ALL_FOREIGN_KEYS_BATCH_STRING_AGG`].
pub const Q_GET_ALL_FOREIGN_KEYS_BATCH_XML_PATH: &str = "\
SELECT \
    pt.name AS table_name, \
    fk.name AS name, \
    rs.name AS ref_schema, \
    rt.name AS ref_table, \
    STUFF(( \
        SELECT ',' + pc.name \
        FROM sys.foreign_key_columns fkc \
        JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id \
        WHERE fkc.constraint_object_id = fk.object_id \
        ORDER BY fkc.constraint_column_id \
        FOR XML PATH(''), TYPE \
    ).value('.', 'NVARCHAR(MAX)'), 1, 1, '') AS columns, \
    STUFF(( \
        SELECT ',' + rc.name \
        FROM sys.foreign_key_columns fkc \
        JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id \
        WHERE fkc.constraint_object_id = fk.object_id \
        ORDER BY fkc.constraint_column_id \
        FOR XML PATH(''), TYPE \
    ).value('.', 'NVARCHAR(MAX)'), 1, 1, '') AS ref_columns, \
    CASE fk.update_referential_action \
        WHEN 0 THEN 'NO ACTION' WHEN 1 THEN 'CASCADE' \
        WHEN 2 THEN 'SET NULL' WHEN 3 THEN 'SET DEFAULT' \
    END AS on_update, \
    CASE fk.delete_referential_action \
        WHEN 0 THEN 'NO ACTION' WHEN 1 THEN 'CASCADE' \
        WHEN 2 THEN 'SET NULL' WHEN 3 THEN 'SET DEFAULT' \
    END AS on_delete \
FROM sys.foreign_keys fk \
JOIN sys.tables pt ON fk.parent_object_id = pt.object_id \
JOIN sys.schemas ps ON pt.schema_id = ps.schema_id \
JOIN sys.tables rt ON fk.referenced_object_id = rt.object_id \
JOIN sys.schemas rs ON rt.schema_id = rs.schema_id \
WHERE ps.name = @P1 \
ORDER BY pt.name, fk.name";

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
        "char" | "varchar" | "text" | "binary" | "varbinary" | "image" | "xml" | "sysname" => {
            Some(max_length_bytes as u64)
        }
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

/// Expand one SQL Server constraint into the per-column foreign-key records
/// used by Tabularis. Composite constraints therefore retain every ordered
/// source/reference column pair without extending the shared model.
pub fn build_foreign_keys(
    name: String,
    columns: Vec<String>,
    _ref_schema: Option<String>,
    ref_table: String,
    ref_columns: Vec<String>,
    on_update: Option<String>,
    on_delete: Option<String>,
) -> Vec<ForeignKey> {
    columns
        .into_iter()
        .zip(ref_columns)
        .map(|(column_name, ref_column)| ForeignKey {
            name: name.clone(),
            column_name,
            ref_table: ref_table.clone(),
            ref_column,
            on_update: on_update.clone(),
            on_delete: on_delete.clone(),
        })
        .collect()
}

/// Split a comma-separated column list returned by `STRING_AGG` /
/// `FOR XML PATH`. Empty / NULL → empty vec.
pub fn split_agg_columns(raw: &str) -> Vec<String> {
    if raw.is_empty() {
        return Vec::new();
    }
    raw.split(',').map(|s| s.to_string()).collect()
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
    conn: &mut BridgeConnection,
    schema: &str,
) -> Result<Vec<TableInfo>, String> {
    let rows = conn
        .query(Q_GET_TABLES, &[&schema])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|error| error.to_string())?;

    Ok(rows
        .into_iter()
        .filter_map(|r| {
            r.get::<&str, _>(0).map(|n| TableInfo {
                name: n.to_string(),
            })
        })
        .collect())
}

pub async fn get_columns(
    conn: &mut BridgeConnection,
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
        .map_err(|error| error.to_string())?;

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

/// Identity-column probe used by [`crate::drivers::sqlserver::SqlServerDriver::insert_record`].
///
/// SQL Server allows at most one identity column per table. Returns the
/// column name (case-preserved as stored in `sys.columns.name`) when one
/// exists, or `None` if the table has no identity column. Bubbles the
/// underlying TDS error up as a `String` on connection / query failure.
pub async fn detect_identity_column(
    conn: &mut BridgeConnection,
    table: &str,
    schema: Option<&str>,
) -> Result<Option<String>, String> {
    let qualified = qualify(schema, table);
    let rows = conn
        .query(Q_GET_IDENTITY_COLUMN, &[&qualified])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|error| error.to_string())?;

    Ok(rows
        .into_iter()
        .next()
        .and_then(|r| r.get::<&str, _>(0).map(|s| s.to_string())))
}

/// Locate the (at most one) IDENTITY column for a `[schema].[table]`. P1 is
/// the qualified name string — `OBJECT_ID(@P1)` resolves it server-side.
pub const Q_GET_IDENTITY_COLUMN: &str = "\
SELECT c.name \
FROM sys.columns c \
WHERE c.object_id = OBJECT_ID(@P1) AND c.is_identity = 1";

pub async fn get_foreign_keys(
    conn: &mut BridgeConnection,
    table: &str,
    schema: Option<&str>,
) -> Result<Vec<ForeignKey>, String> {
    let schema = schema.unwrap_or("dbo");
    let version = detect_server_version(conn).await;
    let query = if version.supports_string_agg() {
        Q_GET_FOREIGN_KEYS_STRING_AGG
    } else {
        Q_GET_FOREIGN_KEYS_XML_PATH
    };
    let rows = conn
        .query(query, &[&schema, &table])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|error| error.to_string())?;

    Ok(rows
        .into_iter()
        .flat_map(|r| {
            build_foreign_keys(
                row_str(&r, "name"),
                split_agg_columns(&row_str(&r, "columns")),
                row_str_opt(&r, "ref_schema"),
                row_str(&r, "ref_table"),
                split_agg_columns(&row_str(&r, "ref_columns")),
                row_str_opt(&r, "on_update"),
                row_str_opt(&r, "on_delete"),
            )
        })
        .collect())
}

pub async fn get_all_columns_batch(
    conn: &mut BridgeConnection,
    schema: &str,
) -> Result<HashMap<String, Vec<TableColumn>>, String> {
    let rows = conn
        .query(Q_GET_ALL_COLUMNS_BATCH, &[&schema])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|error| error.to_string())?;

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
    conn: &mut BridgeConnection,
    schema: &str,
) -> Result<HashMap<String, Vec<ForeignKey>>, String> {
    let version = detect_server_version(conn).await;
    let query = if version.supports_string_agg() {
        Q_GET_ALL_FOREIGN_KEYS_BATCH_STRING_AGG
    } else {
        Q_GET_ALL_FOREIGN_KEYS_BATCH_XML_PATH
    };
    let rows = conn
        .query(query, &[&schema])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|error| error.to_string())?;

    let mut out: HashMap<String, Vec<ForeignKey>> = HashMap::new();
    for r in rows {
        let table_name = row_str(&r, "table_name");
        let foreign_keys = build_foreign_keys(
            row_str(&r, "name"),
            split_agg_columns(&row_str(&r, "columns")),
            row_str_opt(&r, "ref_schema"),
            row_str(&r, "ref_table"),
            split_agg_columns(&row_str(&r, "ref_columns")),
            row_str_opt(&r, "on_update"),
            row_str_opt(&r, "on_delete"),
        );
        out.entry(table_name).or_default().extend(foreign_keys);
    }
    Ok(out)
}

/// Probe the connected server for its major version. Failures fall back to
/// [`ServerVersion`] with `DEFAULT_MAJOR` (= SQL Server 2017) — same default
/// the parser uses, keeps the FK query on the modern STRING_AGG branch.
pub async fn detect_server_version(
    conn: &mut BridgeConnection,
) -> crate::drivers::sqlserver::version::ServerVersion {
    use crate::drivers::sqlserver::version::{
        parse_major_version, parse_version_banner, ServerVersion, DEFAULT_MAJOR,
    };

    // Try SERVERPROPERTY first — cheapest and structured.
    if let Ok(result) = conn
        .query(
            "SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(128)) AS v",
            &[],
        )
        .await
    {
        if let Ok(rows) = result.into_first_result().await {
            if let Some(r) = rows.first() {
                let raw = row_str(r, "v");
                if !raw.trim().is_empty() {
                    let major = parse_major_version(&raw);
                    return ServerVersion { major, full: raw };
                }
            }
        }
    }

    // Fall back to @@VERSION banner.
    if let Ok(result) = conn.query("SELECT @@VERSION AS v", &[]).await {
        if let Ok(rows) = result.into_first_result().await {
            if let Some(r) = rows.first() {
                let raw = row_str(r, "v");
                if !raw.trim().is_empty() {
                    let major = parse_version_banner(&raw);
                    return ServerVersion { major, full: raw };
                }
            }
        }
    }

    ServerVersion {
        major: DEFAULT_MAJOR,
        full: String::new(),
    }
}

/// Build the full per-schema snapshot in three round-trips: tables, columns
/// batch, FK batch. Missing columns or FK for a table → empty Vec (never
/// omitted from the result).
pub async fn get_schema_snapshot(
    conn: &mut BridgeConnection,
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

pub async fn get_views(conn: &mut BridgeConnection, schema: &str) -> Result<Vec<ViewInfo>, String> {
    let rows = conn
        .query(Q_GET_VIEWS, &[&schema])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|error| error.to_string())?;

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
    conn: &mut BridgeConnection,
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
        .map_err(|error| error.to_string())?;

    rows.into_iter()
        .next()
        .and_then(|r| r.get::<&str, _>(0).map(|s| s.to_string()))
        .ok_or_else(|| format!("Definition not found for {}", qualified))
}

pub async fn get_routines(
    conn: &mut BridgeConnection,
    schema: &str,
) -> Result<Vec<RoutineInfo>, String> {
    let rows = conn
        .query(Q_GET_ROUTINES, &[&schema])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|error| error.to_string())?;

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
    conn: &mut BridgeConnection,
    routine_name: &str,
    schema: &str,
) -> Result<Vec<RoutineParameter>, String> {
    let rows = conn
        .query(Q_GET_ROUTINE_PARAMETERS, &[&schema, &routine_name])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|error| error.to_string())?;

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
    conn: &mut BridgeConnection,
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
        .map_err(|error| error.to_string())?;

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
mod tests;
