use crate::drivers::sqlserver::helpers::{bracket_quote, escape_single_quoted, qualify};
use crate::models::{RoutineCallArg, RoutineParameter};

fn argument_value(arg: &RoutineCallArg) -> String {
    match arg.value.as_deref() {
        None => "NULL".into(),
        Some(value) if arg.is_raw => value.into(),
        Some(value) => format!("N'{}'", escape_single_quoted(value)),
    }
}

pub fn routine_call_sql(
    routine_name: &str,
    routine_type: &str,
    args: &[RoutineCallArg],
    parameters: &[RoutineParameter],
    is_table_valued: bool,
    schema: Option<&str>,
) -> Result<String, String> {
    let target = qualify(schema, routine_name);
    if routine_type.eq_ignore_ascii_case("FUNCTION") {
        let values = args
            .iter()
            .map(argument_value)
            .collect::<Vec<_>>()
            .join(", ");
        return Ok(if is_table_valued {
            format!("SELECT * FROM {target}({values})")
        } else {
            format!("SELECT {target}({values}) AS [result]")
        });
    }

    let mut statements = Vec::new();
    let mut assignments = Vec::new();
    let mut outputs = Vec::new();
    for (index, arg) in args.iter().enumerate() {
        let name = arg.name.trim_start_matches('@');
        if name.is_empty()
            || !name
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '_')
        {
            return Err(format!("Invalid SQL Server parameter name: {}", arg.name));
        }
        let binding = format!("@{name}");
        if arg.mode.eq_ignore_ascii_case("OUT") || arg.mode.eq_ignore_ascii_case("INOUT") {
            let data_type = parameters
                .iter()
                .find(|parameter| {
                    parameter
                        .name
                        .trim_start_matches('@')
                        .eq_ignore_ascii_case(name)
                })
                .map(|parameter| parameter.data_type.as_str())
                .ok_or_else(|| format!("Missing SQL type for output parameter @{name}"))?;
            let variable = format!("@tabularis_output_{index}");
            statements.push(format!(
                "DECLARE {variable} {data_type} = {}",
                argument_value(arg)
            ));
            assignments.push(format!("{binding} = {variable} OUTPUT"));
            outputs.push(format!("{variable} AS {}", bracket_quote(name)));
        } else {
            assignments.push(format!("{binding} = {}", argument_value(arg)));
        }
    }

    statements.push(if assignments.is_empty() {
        format!("EXEC {target}")
    } else {
        format!("EXEC {target} {}", assignments.join(", "))
    });
    if !outputs.is_empty() {
        statements.push(format!("SELECT {}", outputs.join(", ")));
    }
    Ok(statements.join(";\n"))
}

pub fn routine_create_template(routine_type: &str, schema: Option<&str>) -> String {
    let schema = bracket_quote(schema.unwrap_or("dbo"));
    if routine_type.eq_ignore_ascii_case("FUNCTION") {
        format!(
            "CREATE FUNCTION {schema}.[my_function] (@value INT)\nRETURNS INT\nAS\nBEGIN\n    RETURN @value;\nEND"
        )
    } else {
        format!(
            "CREATE PROCEDURE {schema}.[my_procedure]\n    @value INT = NULL\nAS\nBEGIN\n    SET NOCOUNT ON;\n    SELECT @value AS [value];\nEND"
        )
    }
}

pub fn routine_edit_script(definition: &str) -> Result<String, String> {
    let trimmed = definition.trim();
    if trimmed.is_empty() {
        return Err("Routine definition is empty or encrypted".into());
    }
    let upper = trimmed.to_ascii_uppercase();
    if upper.starts_with("ALTER ") || upper.starts_with("CREATE OR ALTER ") {
        return Ok(trimmed.into());
    }
    if upper.starts_with("CREATE ") {
        return Ok(format!("ALTER {}", &trimmed["CREATE ".len()..]));
    }
    Err("SQL Server routine definition does not start with CREATE or ALTER".into())
}

pub fn drop_routine_sql(routine_name: &str, routine_type: &str, schema: Option<&str>) -> String {
    let keyword = if routine_type.eq_ignore_ascii_case("FUNCTION") {
        "FUNCTION"
    } else {
        "PROCEDURE"
    };
    format!("DROP {keyword} {}", qualify(schema, routine_name))
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
