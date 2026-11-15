pub(super) fn comment_sql(table_ref: &str, column: &str, comment: Option<&str>) -> String {
    let value = match comment.filter(|value| !value.is_empty()) {
        // Explicit escape strings also work when standard_conforming_strings is off.
        Some(value) => format!("E'{}'", value.replace('\\', "\\\\").replace('\'', "''")),
        None => "NULL".to_string(),
    };
    format!(
        "COMMENT ON COLUMN {}.\"{}\" IS {}",
        table_ref,
        column.replace('"', "\"\""),
        value
    )
}

#[cfg(test)]
#[path = "column_comments_tests.rs"]
mod tests;
