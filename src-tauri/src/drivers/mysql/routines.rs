//! MySQL-dialect SQL builders for stored-routine management.
//!
//! Pure string builders; the trait overrides in `mod.rs` delegate here so
//! the generation logic stays unit-testable without a live server.

use super::helpers::{escape_identifier, mysql_string_literal};
use crate::models::RoutineCallArg;

fn quoted(name: &str) -> String {
    format!("`{}`", escape_identifier(name))
}

/// Session-variable name for an OUT/INOUT parameter: parameter names come
/// from information_schema but are embedded unquoted after `@`, so anything
/// outside [A-Za-z0-9_] is normalised away.
fn session_var(param_name: &str, position: usize) -> String {
    let sanitized: String = param_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect();
    if sanitized.is_empty() {
        format!("@param_{}", position + 1)
    } else {
        format!("@{}", sanitized)
    }
}

fn literal(arg: &RoutineCallArg) -> String {
    match &arg.value {
        None => "NULL".to_string(),
        Some(v) if arg.is_raw => v.clone(),
        // The script runs through the editor with the default sql_mode
        // assumption (backslash is an escape character).
        Some(v) => mysql_string_literal(v, false),
    }
}

/// Builds the invocation script. Functions become a plain `SELECT`;
/// procedures with OUT/INOUT parameters get the session-variable dance:
/// `SET` for INOUT inputs, `@var` placeholders in the `CALL`, and a final
/// `SELECT` exposing the outputs as a result set.
pub(super) fn routine_call_sql(
    routine_name: &str,
    routine_type: &str,
    args: &[RoutineCallArg],
) -> String {
    let name = quoted(routine_name);

    if routine_type.eq_ignore_ascii_case("FUNCTION") {
        let list: Vec<String> = args.iter().map(literal).collect();
        return format!("SELECT {}({}) AS result;", name, list.join(", "));
    }

    let mut set_lines: Vec<String> = Vec::new();
    let mut call_args: Vec<String> = Vec::new();
    let mut out_vars: Vec<(String, String)> = Vec::new(); // (var, label)

    for (i, arg) in args.iter().enumerate() {
        let mode = arg.mode.to_uppercase();
        if mode == "OUT" || mode == "INOUT" {
            let var = session_var(&arg.name, i);
            if mode == "INOUT" {
                set_lines.push(format!("SET {} = {};", var, literal(arg)));
            }
            let label = if arg.name.is_empty() {
                var.trim_start_matches('@').to_string()
            } else {
                arg.name.clone()
            };
            out_vars.push((var.clone(), label));
            call_args.push(var);
        } else {
            call_args.push(literal(arg));
        }
    }

    let mut script = String::new();
    for line in &set_lines {
        script.push_str(line);
        script.push('\n');
    }
    script.push_str(&format!("CALL {}({});", name, call_args.join(", ")));
    if !out_vars.is_empty() {
        let selects: Vec<String> = out_vars
            .iter()
            .map(|(var, label)| format!("{} AS {}", var, quoted(label)))
            .collect();
        script.push_str(&format!("\nSELECT {};", selects.join(", ")));
    }
    script
}

/// Starter script for a new routine, wrapped in the `DELIMITER` dance the
/// statement splitter needs to send the body as one statement.
pub(super) fn routine_create_template(routine_type: &str) -> String {
    if routine_type.eq_ignore_ascii_case("FUNCTION") {
        r"DELIMITER //
CREATE FUNCTION my_function(p_value INT) RETURNS INT
DETERMINISTIC
BEGIN
    RETURN p_value;
END//
DELIMITER ;
"
        .to_string()
    } else {
        r"DELIMITER //
CREATE PROCEDURE my_procedure(IN p_value INT)
BEGIN
    SELECT p_value;
END//
DELIMITER ;
"
        .to_string()
    }
}

/// Wraps a `SHOW CREATE` definition into a re-runnable edit script:
/// drop the existing routine, then recreate it inside a `DELIMITER` block.
pub(super) fn routine_edit_script(
    routine_name: &str,
    routine_type: &str,
    definition: &str,
) -> String {
    let keyword = drop_keyword(routine_type);
    format!(
        "DROP {} IF EXISTS {};\n\nDELIMITER //\n{}//\nDELIMITER ;\n",
        keyword,
        quoted(routine_name),
        definition.trim_end()
    )
}

pub(super) fn drop_routine_sql(routine_name: &str, routine_type: &str) -> String {
    format!("DROP {} {}", drop_keyword(routine_type), quoted(routine_name))
}

fn drop_keyword(routine_type: &str) -> &'static str {
    if routine_type.eq_ignore_ascii_case("FUNCTION") {
        "FUNCTION"
    } else {
        "PROCEDURE"
    }
}
