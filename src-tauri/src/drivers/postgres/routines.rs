//! PostgreSQL-dialect SQL builders for stored-routine management.
//!
//! Pure string builders; the trait overrides in `mod.rs` delegate here so
//! the generation logic stays unit-testable without a live server.

use crate::drivers::common::{quote_qualified, render_sql_literal};
use crate::models::RoutineCallArg;

/// Builds the invocation script. Functions go through `SELECT * FROM` so
/// both scalar and set-returning functions come back as a result set; their
/// pure `OUT` parameters are NOT part of the call signature in PostgreSQL, so
/// they are excluded from the argument list (passing them raises
/// `function ... does not exist`). Procedures use `CALL`; there OUT parameters
/// ARE required in the argument list and are rendered as `NULL` placeholders,
/// with INOUT values echoed back by the server as the procedure's result row.
pub(super) fn routine_call_sql(
    routine_name: &str,
    routine_type: &str,
    args: &[RoutineCallArg],
    schema: Option<&str>,
) -> String {
    let name = quote_qualified(routine_name, schema, "\"");
    let is_function = routine_type.eq_ignore_ascii_case("FUNCTION");
    let rendered: Vec<String> = args
        .iter()
        .filter(|arg| !(is_function && arg.mode.eq_ignore_ascii_case("OUT")))
        .map(render_sql_literal)
        .collect();
    let arg_list = rendered.join(", ");
    if is_function {
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

/// The catalog lookup for one routine's definition.
///
/// Two forms, because a schema and a name do not identify a routine in
/// PostgreSQL: they identify a set of overloads. With a signature the lookup
/// names one row and needs no `LIMIT`; without one it is the pre-#893 read,
/// which takes whichever row the scan returns and is kept for the callers that
/// have no signature to pass.
pub(super) fn routine_definition_sql(by_identity: bool) -> &'static str {
    if by_identity {
        r#"
            SELECT pg_get_functiondef(p.oid) AS definition
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = $1
            AND   p.proname = $2
            AND   pg_get_function_identity_arguments(p.oid) = $3
        "#
    } else {
        r#"
            SELECT pg_get_functiondef(p.oid) AS definition
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = $1 AND p.proname = $2
            LIMIT 1
        "#
    }
}

/// Whether one exact overload is there, for the `DROP` path to check before it
/// builds a statement naming a signature the server may not have.
pub(super) fn routine_exists_sql() -> &'static str {
    r#"
            SELECT 1
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = $1
            AND   p.proname = $2
            AND   pg_get_function_identity_arguments(p.oid) = $3
        "#
}

/// `information_schema.specific_name` for one overload, from its signature.
///
/// That column is the only key `information_schema.parameters` can be filtered
/// by, and the two views offer no way to reach it from a signature, so it is
/// derived: it is documented as the routine's name, an underscore, and its OID,
/// and `pg_proc` has both. Verified against `information_schema.routines` on
/// PostgreSQL 18 over a set of four overloads - each row's own `specific_name`
/// matches this expression and no other row's does.
pub(super) const ROUTINE_SPECIFIC_NAME_SQL: &str = r#"
            SELECT p.proname || '_' || p.oid AS specific_name
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = $1
            AND   p.proname = $2
            AND   pg_get_function_identity_arguments(p.oid) = $3
        "#;

/// The return type of one routine, by `specific_name` where the caller has one.
///
/// Without it this took `LIMIT 1` over every overload of the name, so the Run
/// dialog could show one overload's return type beside another's parameters.
pub(super) fn routine_return_type_sql(by_specific_name: bool) -> &'static str {
    if by_specific_name {
        r#"
            SELECT r.data_type, r.routine_type
            FROM information_schema.routines r
            WHERE r.routine_schema = $1
            AND   r.specific_name = $2
        "#
    } else {
        r#"
            SELECT data_type, routine_type
            FROM information_schema.routines
            WHERE routine_schema = $1 AND routine_name = $2
            LIMIT 1
        "#
    }
}

/// One routine's parameters, by `specific_name` where the caller has one.
///
/// Without it the join filtered on schema and name only, so every overload's
/// parameters came back in one list ordered by position: measured on
/// PostgreSQL 18, three overloads of `f` answered four rows, two of them
/// `ordinal_position` 1 with different types.
pub(super) fn routine_parameters_sql(by_specific_name: bool) -> &'static str {
    if by_specific_name {
        r#"
            SELECT p.parameter_name, p.data_type, p.parameter_mode, p.ordinal_position
            FROM information_schema.parameters p
            WHERE p.specific_schema = $1
            AND   p.specific_name = $2
            ORDER BY p.ordinal_position
        "#
    } else {
        r#"
            SELECT p.parameter_name, p.data_type, p.parameter_mode, p.ordinal_position
            FROM information_schema.parameters p
            JOIN information_schema.routines r ON p.specific_name = r.specific_name
            WHERE r.routine_schema = $1 AND r.routine_name = $2
            ORDER BY p.ordinal_position
        "#
    }
}
