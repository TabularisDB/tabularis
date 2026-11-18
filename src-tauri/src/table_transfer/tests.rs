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

fn sqlite_declared_types_follow_affinity_rules() {
    assert_eq!(
        classify_sqlite_target("BIGINT", false),
        SqliteTarget::Integer
    );
    assert_eq!(
        classify_sqlite_target("VARCHAR(20)", false),
        SqliteTarget::Text
    );
    assert_eq!(
        classify_sqlite_target("DOUBLE PRECISION", false),
        SqliteTarget::Real
    );
    assert_eq!(
        classify_sqlite_target("DECIMAL(10,2)", false),
        SqliteTarget::Numeric
    );
    assert_eq!(classify_sqlite_target("", false), SqliteTarget::Untyped);
    assert_eq!(classify_sqlite_target("BLOB", false), SqliteTarget::Blob);
    assert_eq!(
        classify_sqlite_target("DATETIME", false),
        SqliteTarget::Temporal
    );
    assert_eq!(classify_sqlite_target("BOOLEAN", false), SqliteTarget::Bool);
}

#[test]
fn any_is_untyped_only_on_strict_tables() {
    assert_eq!(classify_sqlite_target("ANY", false), SqliteTarget::Numeric);
    assert_eq!(
        classify_sqlite_target(" any ", false),
        SqliteTarget::Numeric
    );
    assert_eq!(classify_sqlite_target("ANY", true), SqliteTarget::Untyped);
    assert_eq!(classify_sqlite_target("", false), SqliteTarget::Untyped);
    assert_eq!(classify_sqlite_target("", true), SqliteTarget::Untyped);
    assert_eq!(classify_sqlite_target("TEXT", true), SqliteTarget::Text);
    assert_eq!(
        classify_sqlite_target("DECIMAL(10,2)", true),
        SqliteTarget::Numeric
    );
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
    assert_eq!(
        ordinary.bindings[0].conversion.rule,
        ConversionRule::Checked
    );

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
    let planned = plan(
        &selection(vec![]),
        &source,
        &target,
        TransferDialect::Sqlite,
    );
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
    let planned = plan(
        &selection(vec![]),
        &source,
        &target,
        TransferDialect::Sqlite,
    );
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
    let ok = plan(
        &selection(vec![("note", None)]),
        &source,
        &target,
        TransferDialect::Sqlite,
    );
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
