use super::*;

fn arg(name: &str, value: Option<&str>, mode: &str, is_raw: bool) -> RoutineCallArg {
    RoutineCallArg {
        name: name.into(),
        mode: mode.into(),
        value: value.map(str::to_string),
        is_raw,
    }
}

#[test]
fn procedure_call_uses_named_parameters_and_output() {
    let sql = routine_call_sql(
        "save_item",
        "PROCEDURE",
        &[
            arg("@name", Some("O'Reilly"), "IN", false),
            arg("id", None, "OUT", false),
        ],
        &[RoutineParameter {
            name: "@id".into(),
            data_type: "INT".into(),
            mode: "OUT".into(),
            ordinal_position: 2,
        }],
        false,
        Some("sales"),
    )
    .unwrap();
    assert_eq!(
        sql,
        "DECLARE @tabularis_output_1 INT = NULL;\nEXEC [sales].[save_item] @name = N'O''Reilly', @id = @tabularis_output_1 OUTPUT;\nSELECT @tabularis_output_1 AS [id]"
    );
}

#[test]
fn function_call_returns_result() {
    assert_eq!(
        routine_call_sql(
            "double_value",
            "FUNCTION",
            &[arg("value", Some("21"), "IN", true)],
            &[],
            false,
            None,
        )
        .unwrap(),
        "SELECT [dbo].[double_value](21) AS [result]"
    );
}

#[test]
fn table_valued_function_uses_from_clause() {
    assert_eq!(
        routine_call_sql("items", "FUNCTION", &[], &[], true, Some("dbo")).unwrap(),
        "SELECT * FROM [dbo].[items]()"
    );
}

#[test]
fn edit_script_changes_create_to_alter() {
    assert_eq!(
        routine_edit_script("CREATE PROCEDURE [dbo].[p] AS SELECT 1").unwrap(),
        "ALTER PROCEDURE [dbo].[p] AS SELECT 1"
    );
}

#[test]
fn templates_and_drop_sql_are_dialect_specific() {
    assert!(routine_create_template("FUNCTION", Some("sales")).contains("CREATE FUNCTION [sales]"));
    assert_eq!(
        drop_routine_sql("p", "PROCEDURE", Some("sales")),
        "DROP PROCEDURE [sales].[p]"
    );
}
