//! Dialect-neutral SQL builders for stored-routine management.
//!
//! These back the `DatabaseDriver` trait defaults and the `RpcDriver`
//! fallback for plugins that do not implement the optional routine-management
//! RPC methods. Built-in drivers override them with dialect-aware variants.

use crate::models::RoutineCallArg;

/// Renders one argument value as a SQL literal: `NULL` when absent, verbatim
/// when marked raw (numbers, expressions), otherwise a single-quoted string
/// with embedded quotes doubled — the only escaping form every SQL dialect
/// shares.
pub fn render_sql_literal(arg: &RoutineCallArg) -> String {
    match &arg.value {
        None => "NULL".to_string(),
        Some(v) if arg.is_raw => v.clone(),
        Some(v) => format!("'{}'", v.replace('\'', "''")),
    }
}

/// Quotes one identifier with the driver's quote character (doubling embedded
/// quote characters), optionally schema-qualified.
pub fn quote_qualified(name: &str, schema: Option<&str>, quote: &str) -> String {
    let q = |part: &str| {
        if quote.is_empty() {
            part.to_string()
        } else {
            format!("{q}{}{q}", part.replace(quote, &quote.repeat(2)), q = quote)
        }
    };
    match schema {
        Some(s) if !s.is_empty() => format!("{}.{}", q(s), q(name)),
        _ => q(name),
    }
}

/// Generic invocation script: `CALL proc(args);` for procedures and
/// `SELECT fn(args);` for functions. Dialects with richer conventions
/// (MySQL OUT variables, PostgreSQL set-returning functions) override this.
pub fn generic_routine_call_sql(
    routine_name: &str,
    routine_type: &str,
    args: &[RoutineCallArg],
    schema: Option<&str>,
    quote: &str,
) -> String {
    let name = quote_qualified(routine_name, schema, quote);
    let rendered: Vec<String> = args.iter().map(render_sql_literal).collect();
    let arg_list = rendered.join(", ");
    if routine_type.eq_ignore_ascii_case("FUNCTION") {
        format!("SELECT {}({}) AS result;", name, arg_list)
    } else {
        format!("CALL {}({});", name, arg_list)
    }
}

/// Generic `DROP PROCEDURE|FUNCTION` statement.
pub fn generic_drop_routine_sql(
    routine_name: &str,
    routine_type: &str,
    schema: Option<&str>,
    quote: &str,
) -> String {
    let keyword = if routine_type.eq_ignore_ascii_case("FUNCTION") {
        "FUNCTION"
    } else {
        "PROCEDURE"
    };
    format!(
        "DROP {} {}",
        keyword,
        quote_qualified(routine_name, schema, quote)
    )
}
