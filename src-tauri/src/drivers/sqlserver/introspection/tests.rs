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
    assert_eq!(
        character_length_from_sys_columns("uniqueidentifier", 16),
        None
    );
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
    let col = build_table_column("id".into(), "int".into(), false, true, 4, true, None);
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

// --- build_foreign_keys ----------------------------------------------

#[test]
fn build_foreign_keys_maps_single_column() {
    let keys = build_foreign_keys(
        "FK_orders_customer".into(),
        vec!["customer_id".into()],
        Some("dbo".into()),
        "customers".into(),
        vec!["id".into()],
        Some("NO ACTION".into()),
        Some("CASCADE".into()),
    );
    assert_eq!(keys.len(), 1);
    let key = &keys[0];
    assert_eq!(key.name, "FK_orders_customer");
    assert_eq!(key.column_name, "customer_id");
    assert_eq!(key.ref_table, "customers");
    assert_eq!(key.ref_column, "id");
    assert_eq!(key.on_update, Some("NO ACTION".into()));
    assert_eq!(key.on_delete, Some("CASCADE".into()));
}

#[test]
fn build_foreign_keys_expands_composite_columns_in_order() {
    let keys = build_foreign_keys(
        "FK_line_items_orders".into(),
        vec!["tenant_id".into(), "order_id".into()],
        Some("dbo".into()),
        "orders".into(),
        vec!["tenant_id".into(), "id".into()],
        None,
        None,
    );
    assert_eq!(keys.len(), 2);
    assert_eq!(keys[0].column_name, "tenant_id");
    assert_eq!(keys[0].ref_column, "tenant_id");
    assert_eq!(keys[1].column_name, "order_id");
    assert_eq!(keys[1].ref_column, "id");
}

#[test]
fn build_foreign_keys_ignores_unpaired_columns() {
    let keys = build_foreign_keys(
        "FK_bad".into(),
        vec!["a".into(), "b".into()],
        None,
        "target".into(),
        vec!["id".into()],
        None,
        None,
    );
    assert_eq!(keys.len(), 1);
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
