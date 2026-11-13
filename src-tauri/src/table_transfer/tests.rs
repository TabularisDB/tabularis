use super::convert::apply;
use super::types::{classify_sqlite_target, plan_conversion};
use super::*;
use crate::models::TableColumn;

fn column(name: &str, data_type: &str) -> TableColumn {
    TableColumn {
        name: name.to_string(),
        data_type: data_type.to_string(),
        is_pk: false,
        is_nullable: true,
        is_auto_increment: false,
        is_generated: false,
        default_value: None,
        character_maximum_length: None,
        numeric_precision: None,
        numeric_scale: None,
        comment: None,
        full_type: None,
        default_sql: None,
        on_update: None,
    }
}

fn text(value: &str) -> TransferValue {
    TransferValue::Text(value.to_string())
}

fn run(
    source: SourceKind,
    target: TargetType,
    value: TransferValue,
) -> Result<TransferValue, ConvertError> {
    let conversion = plan_conversion(source, &target).expect("compatible");
    apply(&conversion, value)
}

fn numeric(precision: u32, scale: u32) -> TargetType {
    TargetType::Pg(PgTarget::Decimal {
        precision: Some(precision),
        scale: Some(scale),
    })
}

#[test]
fn only_postgres_sources_and_builtin_targets_are_supported() {
    assert!(ensure_supported_pair("postgres", "postgres").is_ok());
    assert!(ensure_supported_pair("postgres", "sqlite").is_ok());
    assert!(ensure_supported_pair("sqlite", "postgres").is_err());
    assert!(ensure_supported_pair("postgres", "mysql").is_err());
    assert!(ensure_supported_pair("postgres", "custom-plugin").is_err());
    assert!(dialect_for_driver("custom-plugin").is_none());
}

#[test]
fn numeric_must_fit_target_precision_and_scale() {
    let target = || numeric(5, 2);
    assert_eq!(run(SourceKind::Decimal, target(), text("123.45")), Ok(text("123.45")));
    assert_eq!(run(SourceKind::Decimal, target(), text("123.450")), Ok(text("123.450")));
    assert_eq!(run(SourceKind::Decimal, target(), text("1.234")), Err(ConvertError::Lossy));
    assert_eq!(run(SourceKind::Decimal, target(), text("1234.5")), Err(ConvertError::OutOfRange));
    assert_eq!(
        run(SourceKind::Decimal, target(), TransferValue::Null),
        Ok(TransferValue::Null)
    );
    assert_eq!(run(SourceKind::Int, target(), TransferValue::Int(999)), Ok(text("999")));
    assert_eq!(
        run(SourceKind::Int, target(), TransferValue::Int(1000)),
        Err(ConvertError::OutOfRange)
    );
}

#[test]
fn integer_targets_check_range() {
    let small = TargetType::Pg(PgTarget::Int(16));
    assert!(run(SourceKind::Int, small.clone(), TransferValue::Int(32_767)).is_ok());
    assert_eq!(
        run(SourceKind::Int, small, TransferValue::Int(32_768)),
        Err(ConvertError::OutOfRange)
    );
    let int = TargetType::Pg(PgTarget::Int(32));
    assert_eq!(run(SourceKind::Decimal, int.clone(), text("10.5")), Err(ConvertError::Lossy));
    assert_eq!(
        run(SourceKind::Decimal, int.clone(), text("2147483648")),
        Err(ConvertError::OutOfRange)
    );
    assert_eq!(run(SourceKind::Decimal, int, text("-5.00")), Ok(TransferValue::Int(-5)));
}

#[test]
fn sqlite_numeric_values_must_round_trip() {
    let real = TargetType::Sqlite(SqliteTarget::Real);
    assert_eq!(
        run(SourceKind::Decimal, real.clone(), text("0.1")),
        Ok(TransferValue::Float(0.1))
    );
    assert_eq!(
        run(SourceKind::Decimal, real.clone(), text("0.12345678901234567890123")),
        Err(ConvertError::Lossy)
    );
    assert_eq!(
        run(SourceKind::Decimal, real.clone(), text("NaN")),
        Err(ConvertError::NonFinite)
    );
    assert_eq!(
        run(SourceKind::Int, real, TransferValue::Int((1 << 53) + 1)),
        Err(ConvertError::Lossy)
    );
    let any_number = TargetType::Sqlite(SqliteTarget::Numeric);
    assert_eq!(
        run(SourceKind::Decimal, any_number.clone(), text("42.00")),
        Ok(TransferValue::Int(42))
    );
    assert_eq!(
        run(SourceKind::Decimal, any_number, text("1.5")),
        Ok(TransferValue::Float(1.5))
    );
    assert!(plan_conversion(SourceKind::Decimal, &TargetType::Sqlite(SqliteTarget::Text)).is_ok());
}

#[test]
fn float32_targets_reject_double_precision_values() {
    let real = TargetType::Pg(PgTarget::Float(32));
    assert!(run(SourceKind::Float, real.clone(), TransferValue::Float(0.1)).is_ok());
    assert_eq!(
        run(SourceKind::Float, real, TransferValue::Float(0.123456789012345)),
        Err(ConvertError::Lossy)
    );
    let sqlite = TargetType::Sqlite(SqliteTarget::Real);
    assert_eq!(
        run(SourceKind::Float, sqlite, TransferValue::Float(f64::NAN)),
        Err(ConvertError::NonFinite)
    );
    assert!(run(
        SourceKind::Float,
        TargetType::Pg(PgTarget::Float(64)),
        TransferValue::Float(f64::INFINITY)
    )
    .is_ok());
}

#[test]
fn text_length_is_counted_in_characters() {
    let target = TargetType::Pg(PgTarget::Text { max_len: Some(3) });
    assert_eq!(run(SourceKind::Text, target.clone(), text("héé")), Ok(text("héé")));
    assert_eq!(
        run(SourceKind::Text, target, text("日本語子")),
        Err(ConvertError::TooLong)
    );
}

#[test]
fn temporal_precision_is_not_rounded() {
    let target = TargetType::Pg(PgTarget::Timestamp { precision: Some(0) });
    assert!(run(SourceKind::Timestamp, target.clone(), text("2024-01-02 03:04:05")).is_ok());
    assert_eq!(
        run(SourceKind::Timestamp, target, text("2024-01-02 03:04:05.5")),
        Err(ConvertError::Lossy)
    );
}

#[test]
fn sqlite_json_columns_refuse_bare_numbers() {
    let target = TargetType::Sqlite(SqliteTarget::Json);
    assert!(run(SourceKind::Json, target.clone(), text("{\"a\":1}")).is_ok());
    assert_eq!(run(SourceKind::Json, target, text("123")), Err(ConvertError::Lossy));
}

#[test]
fn bool_and_bytes_conversions() {
    let target = TargetType::Sqlite(SqliteTarget::Integer);
    assert_eq!(
        run(SourceKind::Bool, target, TransferValue::Bool(true)),
        Ok(TransferValue::Int(1))
    );
    let blob = TargetType::Sqlite(SqliteTarget::Blob);
    let bytes = TransferValue::Bytes(vec![0, 255, 0]);
    assert_eq!(run(SourceKind::Bytes, blob, bytes.clone()), Ok(bytes));
    assert!(plan_conversion(SourceKind::Bytes, &TargetType::Sqlite(SqliteTarget::Text)).is_err());
}

#[test]
fn implicit_coercions_are_refused() {
    let pg = |t| TargetType::Pg(t);
    assert!(plan_conversion(SourceKind::Int, &pg(PgTarget::Text { max_len: None })).is_err());
    assert!(plan_conversion(SourceKind::Text, &pg(PgTarget::Jsonb)).is_err());
    assert!(plan_conversion(
        SourceKind::Timestamp,
        &pg(PgTarget::TimestampTz { precision: None })
    )
    .is_err());
    assert!(plan_conversion(SourceKind::Float, &pg(PgTarget::Int(32))).is_err());
    assert!(plan_conversion(SourceKind::Int, &TargetType::Sqlite(SqliteTarget::Text)).is_err());
    assert!(plan_conversion(SourceKind::Text, &TargetType::Sqlite(SqliteTarget::Integer)).is_err());
}

#[test]
fn sqlite_declared_types_follow_affinity_rules() {
    assert_eq!(classify_sqlite_target("BIGINT", false), SqliteTarget::Integer);
    assert_eq!(classify_sqlite_target("VARCHAR(20)", false), SqliteTarget::Text);
    assert_eq!(classify_sqlite_target("DOUBLE PRECISION", false), SqliteTarget::Real);
    assert_eq!(classify_sqlite_target("DECIMAL(10,2)", false), SqliteTarget::Numeric);
    assert_eq!(classify_sqlite_target("", false), SqliteTarget::Untyped);
    assert_eq!(classify_sqlite_target("BLOB", false), SqliteTarget::Blob);
    assert_eq!(classify_sqlite_target("DATETIME", false), SqliteTarget::Temporal);
    assert_eq!(classify_sqlite_target("BOOLEAN", false), SqliteTarget::Bool);
}

#[test]
fn any_is_untyped_only_on_strict_tables() {
    assert_eq!(classify_sqlite_target("ANY", false), SqliteTarget::Numeric);
    assert_eq!(classify_sqlite_target(" any ", false), SqliteTarget::Numeric);
    assert_eq!(classify_sqlite_target("ANY", true), SqliteTarget::Untyped);
    assert_eq!(classify_sqlite_target("", false), SqliteTarget::Untyped);
    assert_eq!(classify_sqlite_target("", true), SqliteTarget::Untyped);
    assert_eq!(classify_sqlite_target("TEXT", true), SqliteTarget::Text);
    assert_eq!(classify_sqlite_target("DECIMAL(10,2)", true), SqliteTarget::Numeric);
}

fn plan_into_any(source_type: &str, strict: bool) -> PlannedTable {
    let source = [column("v", source_type)];
    let target = [column("v", "ANY")];
    build_table_plan(&PlanInputs {
        selection: &selection(vec![]),
        source_columns: &source,
        target_columns: &target,
        target_dialect: TransferDialect::Sqlite,
        target_strict: strict,
        estimated_rows: None,
        same_table: false,
    })
}

#[test]
fn decimal_into_ordinary_any_is_checked_not_exact() {
    let ordinary = plan_into_any("numeric", false);
    assert!(!ordinary.plan.blocking, "{:?}", ordinary.plan.issues);
    assert_eq!(ordinary.bindings[0].conversion.op, Op::DecimalToNumeric);
    assert_eq!(ordinary.bindings[0].conversion.rule, ConversionRule::Checked);

    let strict = plan_into_any("numeric", true);
    assert_eq!(strict.bindings[0].conversion.op, Op::Copy);
    assert_eq!(strict.bindings[0].conversion.rule, ConversionRule::Exact);
}

#[test]
fn text_into_ordinary_any_is_refused_but_allowed_on_strict() {
    let ordinary = plan_into_any("text", false);
    assert_eq!(codes(&ordinary), vec!["incompatibleTypes"]);
    let strict = plan_into_any("text", true);
    assert!(!strict.plan.blocking, "{:?}", strict.plan.issues);
}

fn selection(columns: Vec<(&str, Option<&str>)>) -> TableSelection {
    TableSelection {
        source_table: "customers".into(),
        target_table: "customers".into(),
        columns: columns
            .into_iter()
            .map(|(s, t)| ColumnMappingRequest {
                source_column: s.into(),
                target_column: t.map(Into::into),
            })
            .collect(),
    }
}

fn plan(
    selection: &TableSelection,
    source: &[TableColumn],
    target: &[TableColumn],
    dialect: TransferDialect,
) -> PlannedTable {
    build_table_plan(&PlanInputs {
        selection,
        source_columns: source,
        target_columns: target,
        target_dialect: dialect,
        target_strict: false,
        estimated_rows: None,
        same_table: false,
    })
}

fn codes(planned: &PlannedTable) -> Vec<String> {
    planned.plan.issues.iter().map(|i| i.code.clone()).collect()
}

#[test]
fn plan_maps_by_name_and_is_clean_for_compatible_columns() {
    let source = [column("id", "integer"), column("Name", "text")];
    let target = [column("id", "INTEGER"), column("name", "TEXT")];
    let planned = plan(&selection(vec![]), &source, &target, TransferDialect::Sqlite);
    assert!(!planned.plan.blocking, "{:?}", planned.plan.issues);
    assert_eq!(planned.bindings.len(), 2);
    assert_eq!(planned.bindings[1].target_column, "name");
}

#[test]
fn plan_blocks_unmapped_missing_and_incompatible_columns() {
    let source = [
        column("id", "integer"),
        column("extra", "text"),
        column("shape", "point"),
    ];
    let mut required = column("must", "text");
    required.is_nullable = false;
    let target = [column("id", "TEXT"), required];
    let planned = plan(&selection(vec![]), &source, &target, TransferDialect::Sqlite);
    let found = codes(&planned);
    assert!(found.contains(&"incompatibleTypes".to_string()));
    assert!(found.contains(&"noTargetColumn".to_string()));
    assert!(found.contains(&"requiredTargetColumnUnmapped".to_string()));
    assert!(planned.plan.blocking);
}

#[test]
fn explicit_skip_is_not_an_issue_but_duplicates_and_unknowns_are() {
    let source = [column("id", "integer"), column("note", "text")];
    let target = [column("id", "INTEGER")];
    let ok = plan(&selection(vec![("note", None)]), &source, &target, TransferDialect::Sqlite);
    assert!(!ok.plan.blocking);
    assert!(ok.plan.columns[1].skipped);
    let duplicate = plan(
        &selection(vec![("note", Some("id"))]),
        &source,
        &target,
        TransferDialect::Sqlite,
    );
    assert!(codes(&duplicate).contains(&"duplicateTargetColumn".to_string()));
    let unknown = plan(
        &selection(vec![("ghost", None), ("id", Some("nope"))]),
        &source,
        &target,
        TransferDialect::Sqlite,
    );
    let found = codes(&unknown);
    assert!(found.contains(&"unknownSourceColumn".to_string()));
    assert!(found.contains(&"unknownTargetColumn".to_string()));
}

#[test]
fn plan_never_creates_tables_and_rejects_same_table() {
    let source = [column("id", "integer")];
    let missing = plan(&selection(vec![]), &source, &[], TransferDialect::Postgres);
    assert_eq!(codes(&missing), vec!["targetTableNotFound"]);
    let same = build_table_plan(&PlanInputs {
        selection: &selection(vec![]),
        source_columns: &source,
        target_columns: &source,
        target_dialect: TransferDialect::Postgres,
        target_strict: false,
        estimated_rows: None,
        same_table: true,
    });
    assert!(codes(&same).contains(&"sourceEqualsTarget".to_string()));
}

#[test]
fn generated_and_unsupported_target_columns_block() {
    let source = [column("id", "integer")];
    let mut generated = column("id", "integer");
    generated.is_generated = true;
    assert!(
        codes(&plan(&selection(vec![]), &source, &[generated], TransferDialect::Postgres))
            .contains(&"targetColumnGenerated".to_string())
    );
    let target = [column("id", "inet")];
    assert!(
        codes(&plan(&selection(vec![]), &source, &target, TransferDialect::Postgres))
            .contains(&"unsupportedTargetType".to_string())
    );
}

#[test]
fn pg_target_reads_precision_from_declared_type() {
    let mut ts = column("at", "timestamp without time zone");
    ts.full_type = Some("timestamp(3) without time zone".into());
    let source = [column("at", "timestamp without time zone")];
    let planned = plan(&selection(vec![]), &source, &[ts], TransferDialect::Postgres);
    assert_eq!(planned.bindings[0].conversion.rule, ConversionRule::Checked);
}
