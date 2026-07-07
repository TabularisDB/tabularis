//! PostgreSQL-dialect SQL builders for stored-routine management.
//!
//! Pure string builders; the trait overrides in `mod.rs` delegate here so
//! the generation logic stays unit-testable without a live server.

use crate::drivers::common::{quote_qualified, render_sql_literal};
use crate::models::RoutineCallArg;

/// Builds the invocation script. Functions go through `SELECT * FROM` so
/// both scalar and set-returning functions come back as a result set.
/// Procedures use `CALL`; OUT parameters are rendered as `NULL` placeholders
/// (PostgreSQL requires them in the argument list) and INOUT values are
/// echoed back by the server as the procedure's result row.
pub(super) fn routine_call_sql(
    routine_name: &str,
    routine_type: &str,
    args: &[RoutineCallArg],
    schema: Option<&str>,
) -> String {
    let name = quote_qualified(routine_name, schema, "\"");
    let rendered: Vec<String> = args.iter().map(render_sql_literal).collect();
    let arg_list = rendered.join(", ");
    if routine_type.eq_ignore_ascii_case("FUNCTION") {
        format!("SELECT * FROM {}({});", name, arg_list)
    } else {
        format!("CALL {}({});", name, arg_list)
    }
}

/// Starter script for a new routine. `CREATE OR REPLACE` keeps the script
/// re-runnable while iterating on the body.
pub(super) fn routine_create_template(routine_type: &str, schema: Option<&str>) -> String {
    let prefix = match schema {
        Some(s) if !s.is_empty() => format!("\"{}\".", s.replace('"', "\"\"")),
        _ => String::new(),
    };
    if routine_type.eq_ignore_ascii_case("FUNCTION") {
        format!(
            r#"CREATE OR REPLACE FUNCTION {prefix}my_function(p_value integer)
RETURNS integer
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN p_value;
END;
$$;
"#
        )
    } else {
        format!(
            r#"CREATE OR REPLACE PROCEDURE {prefix}my_procedure(p_value integer)
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE NOTICE 'value: %', p_value;
END;
$$;
"#
        )
    }
}

/// `DROP` statement for a routine identified by its exact signature (the
/// output of `pg_get_function_identity_arguments`), which is how PostgreSQL
/// disambiguates overloads.
pub(super) fn drop_routine_sql(
    routine_name: &str,
    routine_type: &str,
    identity_args: &str,
    schema: Option<&str>,
) -> String {
    let keyword = if routine_type.eq_ignore_ascii_case("PROCEDURE") {
        "PROCEDURE"
    } else {
        "FUNCTION"
    };
    format!(
        "DROP {} {}({})",
        keyword,
        quote_qualified(routine_name, schema, "\""),
        identity_args
    )
}
