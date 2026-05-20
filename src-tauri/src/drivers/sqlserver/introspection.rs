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

/// Pure builder for [`ForeignKey`]. Composite-aware: takes the full column
/// arrays and derives the legacy `column_name` / `ref_column` from the first
/// entry. Empty arrays yield empty legacy strings — callers should treat that
/// as a malformed row.
pub fn build_foreign_key(
    name: String,
    columns: Vec<String>,
    ref_schema: Option<String>,
    ref_table: String,
    ref_columns: Vec<String>,
    on_update: Option<String>,
    on_delete: Option<String>,
) -> ForeignKey {
    let column_name = columns.first().cloned().unwrap_or_default();
    let ref_column = ref_columns.first().cloned().unwrap_or_default();
    ForeignKey {
        name,
        column_name,
        ref_table,
        ref_column,
        on_update,
        on_delete,
        columns,
        ref_columns,
        ref_schema,
    }
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

fn row_str(row: &mssql_tiberius_bridge::Row, col: &str) -> String {
    row.get::<&str, _>(col).unwrap_or("").to_string()
}

fn row_str_opt(row: &mssql_tiberius_bridge::Row, col: &str) -> Option<String> {
    row.get::<&str, _>(col).map(|s| s.to_string())
}

fn row_bool(row: &mssql_tiberius_bridge::Row, col: &str) -> bool {
    row.get::<bool, _>(col).unwrap_or(false)
}

fn row_i32(row: &mssql_tiberius_bridge::Row, col: &str) -> i32 {
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
        .into_first_result();

    Ok(rows
        .into_iter()
        .filter_map(|r| r.get::<&str, _>(0).map(|n| TableInfo { name: n.to_string() }))
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
        .into_first_result();

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
        .into_first_result();

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
        .into_first_result();

    Ok(rows
        .into_iter()
        .map(|r| {
            build_foreign_key(
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
        .into_first_result();

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
        .into_first_result();

    let mut out: HashMap<String, Vec<ForeignKey>> = HashMap::new();
    for r in rows {
        let table_name = row_str(&r, "table_name");
        let fk = build_foreign_key(
            row_str(&r, "name"),
            split_agg_columns(&row_str(&r, "columns")),
            row_str_opt(&r, "ref_schema"),
            row_str(&r, "ref_table"),
            split_agg_columns(&row_str(&r, "ref_columns")),
            row_str_opt(&r, "on_update"),
            row_str_opt(&r, "on_delete"),
        );
        out.entry(table_name).or_default().push(fk);
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
        let rows = result.into_first_result();
        if let Some(r) = rows.first() {
            let raw = row_str(r, "v");
            if !raw.trim().is_empty() {
                let major = parse_major_version(&raw);
                return ServerVersion { major, full: raw };
            }
        }
    }

    // Fall back to @@VERSION banner.
    if let Ok(result) = conn.query("SELECT @@VERSION AS v", &[]).await {
        let rows = result.into_first_result();
        if let Some(r) = rows.first() {
            let raw = row_str(r, "v");
            if !raw.trim().is_empty() {
                let major = parse_version_banner(&raw);
                return ServerVersion { major, full: raw };
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

pub async fn get_views(
    conn: &mut BridgeConnection,
    schema: &str,
) -> Result<Vec<ViewInfo>, String> {
    let rows = conn
        .query(Q_GET_VIEWS, &[&schema])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result();

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
        .into_first_result();

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
        .into_first_result();

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
        .into_first_result();

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
        .into_first_result();

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
    fn q_get_foreign_keys_string_agg_uses_sys_catalog() {
        // 2017+ branch must use STRING_AGG with deterministic column ordering,
        // emit one row per constraint (not per column), and qualify both the
        // parent table and the schema.
        assert!(Q_GET_FOREIGN_KEYS_STRING_AGG.contains("sys.foreign_keys"));
        assert!(Q_GET_FOREIGN_KEYS_STRING_AGG.contains("sys.foreign_key_columns"));
        assert!(Q_GET_FOREIGN_KEYS_STRING_AGG.contains("STRING_AGG"));
        assert!(Q_GET_FOREIGN_KEYS_STRING_AGG.contains("WITHIN GROUP"));
        assert!(Q_GET_FOREIGN_KEYS_STRING_AGG.contains("ORDER BY fkc.constraint_column_id"));
        assert!(Q_GET_FOREIGN_KEYS_STRING_AGG.contains("AS columns"));
        assert!(Q_GET_FOREIGN_KEYS_STRING_AGG.contains("AS ref_columns"));
        assert!(Q_GET_FOREIGN_KEYS_STRING_AGG.contains("rs.name AS ref_schema"));
        assert!(Q_GET_FOREIGN_KEYS_STRING_AGG.contains("@P1"));
        assert!(Q_GET_FOREIGN_KEYS_STRING_AGG.contains("@P2"));
        assert!(Q_GET_FOREIGN_KEYS_STRING_AGG.contains("GROUP BY"));
        // Action codes must be normalised to the space-form ("NO ACTION", not "NO_ACTION").
        assert!(Q_GET_FOREIGN_KEYS_STRING_AGG.contains("'NO ACTION'"));
        assert!(Q_GET_FOREIGN_KEYS_STRING_AGG.contains("'SET NULL'"));
    }

    #[test]
    fn q_get_foreign_keys_xml_path_uses_stuff_for_xml() {
        // 2012-2016 fallback. Same row shape (columns / ref_columns /
        // ref_schema) so the caller doesn't have to branch on parsing.
        assert!(Q_GET_FOREIGN_KEYS_XML_PATH.contains("sys.foreign_keys"));
        assert!(Q_GET_FOREIGN_KEYS_XML_PATH.contains("STUFF("));
        assert!(Q_GET_FOREIGN_KEYS_XML_PATH.contains("FOR XML PATH('')"));
        assert!(Q_GET_FOREIGN_KEYS_XML_PATH.contains("ORDER BY fkc.constraint_column_id"));
        assert!(Q_GET_FOREIGN_KEYS_XML_PATH.contains("AS columns"));
        assert!(Q_GET_FOREIGN_KEYS_XML_PATH.contains("AS ref_columns"));
        assert!(Q_GET_FOREIGN_KEYS_XML_PATH.contains("rs.name AS ref_schema"));
        assert!(Q_GET_FOREIGN_KEYS_XML_PATH.contains("@P1"));
        assert!(Q_GET_FOREIGN_KEYS_XML_PATH.contains("@P2"));
        assert!(Q_GET_FOREIGN_KEYS_XML_PATH.contains("'NO ACTION'"));
    }

    #[test]
    fn q_get_indexes_excludes_heap_and_unnamed() {
        assert!(Q_GET_INDEXES.contains("sys.indexes"));
        assert!(Q_GET_INDEXES.contains("sys.index_columns"));
        assert!(Q_GET_INDEXES.contains("sys.columns"));
        assert!(Q_GET_INDEXES.contains("i.type > 0"));
        assert!(Q_GET_INDEXES.contains("i.name IS NOT NULL"));
    }

    #[test]
    fn q_get_identity_column_filters_sys_columns_by_object_id() {
        // Must take a qualified [schema].[table] string and resolve it via
        // OBJECT_ID server-side so the caller doesn't have to translate the
        // name into a sys.tables / sys.schemas join.
        assert!(Q_GET_IDENTITY_COLUMN.contains("sys.columns"));
        assert!(Q_GET_IDENTITY_COLUMN.contains("OBJECT_ID(@P1)"));
        assert!(Q_GET_IDENTITY_COLUMN.contains("is_identity = 1"));
        // We project only the column name — the caller wraps it in Option.
        assert!(Q_GET_IDENTITY_COLUMN.contains("SELECT c.name"));
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
    fn q_get_all_foreign_keys_batch_string_agg_emits_table_name() {
        assert!(Q_GET_ALL_FOREIGN_KEYS_BATCH_STRING_AGG.contains("pt.name AS table_name"));
        assert!(Q_GET_ALL_FOREIGN_KEYS_BATCH_STRING_AGG.contains("STRING_AGG"));
        assert!(Q_GET_ALL_FOREIGN_KEYS_BATCH_STRING_AGG.contains("WITHIN GROUP"));
        assert!(Q_GET_ALL_FOREIGN_KEYS_BATCH_STRING_AGG.contains("AS columns"));
        assert!(Q_GET_ALL_FOREIGN_KEYS_BATCH_STRING_AGG.contains("AS ref_columns"));
        assert!(Q_GET_ALL_FOREIGN_KEYS_BATCH_STRING_AGG.contains("@P1"));
        // No @P2 — batch variant aggregates across every table in the schema.
        assert!(!Q_GET_ALL_FOREIGN_KEYS_BATCH_STRING_AGG.contains("@P2"));
        assert!(Q_GET_ALL_FOREIGN_KEYS_BATCH_STRING_AGG.contains("GROUP BY"));
        assert!(Q_GET_ALL_FOREIGN_KEYS_BATCH_STRING_AGG.contains("ORDER BY pt.name"));
    }

    #[test]
    fn q_get_all_foreign_keys_batch_xml_path_emits_table_name() {
        assert!(Q_GET_ALL_FOREIGN_KEYS_BATCH_XML_PATH.contains("pt.name AS table_name"));
        assert!(Q_GET_ALL_FOREIGN_KEYS_BATCH_XML_PATH.contains("STUFF("));
        assert!(Q_GET_ALL_FOREIGN_KEYS_BATCH_XML_PATH.contains("FOR XML PATH('')"));
        assert!(Q_GET_ALL_FOREIGN_KEYS_BATCH_XML_PATH.contains("AS columns"));
        assert!(Q_GET_ALL_FOREIGN_KEYS_BATCH_XML_PATH.contains("AS ref_columns"));
        assert!(Q_GET_ALL_FOREIGN_KEYS_BATCH_XML_PATH.contains("@P1"));
        assert!(!Q_GET_ALL_FOREIGN_KEYS_BATCH_XML_PATH.contains("@P2"));
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
            vec!["customer_id".into()],
            Some("dbo".into()),
            "customers".into(),
            vec!["id".into()],
            Some("NO ACTION".into()),
            Some("CASCADE".into()),
        );
        assert_eq!(fk.name, "FK_orders_customer");
        assert_eq!(fk.column_name, "customer_id");
        assert_eq!(fk.ref_table, "customers");
        assert_eq!(fk.ref_column, "id");
        assert_eq!(fk.ref_schema.as_deref(), Some("dbo"));
        assert_eq!(fk.on_update, Some("NO ACTION".into()));
        assert_eq!(fk.on_delete, Some("CASCADE".into()));
        assert_eq!(fk.columns, vec!["customer_id"]);
        assert_eq!(fk.ref_columns, vec!["id"]);
    }

    #[test]
    fn build_foreign_key_allows_missing_actions() {
        let fk = build_foreign_key(
            "FK_a".into(),
            vec!["x".into()],
            None,
            "t".into(),
            vec!["y".into()],
            None,
            None,
        );
        assert!(fk.on_update.is_none());
        assert!(fk.on_delete.is_none());
        assert!(fk.ref_schema.is_none());
    }

    #[test]
    fn build_foreign_key_handles_composite_columns() {
        // The (tenant_id, order_id) -> (tenant_id, id) shape that triggered
        // #146. The legacy fields must reflect the first column of each side
        // so frontends that still read column_name/ref_column don't crash;
        // the full set is exposed via columns / ref_columns.
        let fk = build_foreign_key(
            "FK_line_items_orders".into(),
            vec!["tenant_id".into(), "order_id".into()],
            Some("dbo".into()),
            "orders".into(),
            vec!["tenant_id".into(), "id".into()],
            Some("NO ACTION".into()),
            Some("NO ACTION".into()),
        );
        assert_eq!(fk.column_name, "tenant_id");
        assert_eq!(fk.ref_column, "tenant_id");
        assert_eq!(fk.columns, vec!["tenant_id", "order_id"]);
        assert_eq!(fk.ref_columns, vec!["tenant_id", "id"]);
        assert_eq!(fk.local_columns(), vec!["tenant_id", "order_id"]);
        assert_eq!(fk.referenced_columns(), vec!["tenant_id", "id"]);
    }

    #[test]
    fn build_foreign_key_empty_arrays_yield_empty_legacy_fields() {
        // Defensive: a malformed row with empty STRING_AGG output shouldn't
        // panic — column_name / ref_column just become "".
        let fk = build_foreign_key(
            "FK_bad".into(),
            vec![],
            None,
            "t".into(),
            vec![],
            None,
            None,
        );
        assert_eq!(fk.column_name, "");
        assert_eq!(fk.ref_column, "");
        assert!(fk.columns.is_empty());
        assert!(fk.ref_columns.is_empty());
    }

    #[test]
    fn split_agg_columns_parses_comma_lists() {
        assert_eq!(split_agg_columns(""), Vec::<String>::new());
        assert_eq!(split_agg_columns("a"), vec!["a".to_string()]);
        assert_eq!(
            split_agg_columns("tenant_id,order_id"),
            vec!["tenant_id".to_string(), "order_id".to_string()]
        );
    }

    #[test]
    fn foreign_key_local_columns_falls_back_to_legacy() {
        // Drivers that haven't migrated (MySQL/Postgres/SQLite today, or old
        // serialized JSON) leave columns/ref_columns empty. The helpers must
        // synthesize a single-element vec from the legacy fields.
        let fk = ForeignKey {
            name: "fk".into(),
            column_name: "user_id".into(),
            ref_table: "users".into(),
            ref_column: "id".into(),
            on_delete: None,
            on_update: None,
            columns: Vec::new(),
            ref_columns: Vec::new(),
            ref_schema: None,
        };
        assert_eq!(fk.local_columns(), vec!["user_id"]);
        assert_eq!(fk.referenced_columns(), vec!["id"]);
    }

    #[test]
    fn foreign_key_deserializes_legacy_json_without_composite_fields() {
        // Regression guard: existing persisted snapshots / IPC payloads that
        // don't carry columns / ref_columns / ref_schema must still parse via
        // serde defaults.
        let raw = r#"{
            "name": "fk_legacy",
            "column_name": "user_id",
            "ref_table": "users",
            "ref_column": "id",
            "on_update": null,
            "on_delete": null
        }"#;
        let fk: ForeignKey = serde_json::from_str(raw).expect("legacy JSON must parse");
        assert_eq!(fk.column_name, "user_id");
        assert!(fk.columns.is_empty());
        assert!(fk.ref_columns.is_empty());
        assert!(fk.ref_schema.is_none());
        // local_columns/referenced_columns must still return the legacy value
        // via the fallback path.
        assert_eq!(fk.local_columns(), vec!["user_id"]);
        assert_eq!(fk.referenced_columns(), vec!["id"]);
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
