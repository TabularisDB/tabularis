use super::complete::{candidates, completion_start, Catalog};
use std::collections::BTreeMap;

fn catalog() -> Catalog {
    let mut columns = BTreeMap::new();
    columns.insert(
        "users".to_string(),
        vec!["id".to_string(), "email".to_string()],
    );
    columns.insert(
        "posts".to_string(),
        vec!["id".to_string(), "title".to_string()],
    );
    Catalog {
        tables: vec!["users".to_string(), "posts".to_string()],
        columns,
    }
}

// --- completion_start -----------------------------------------------------------

#[test]
fn completion_start_at_line_start_is_zero() {
    assert_eq!(completion_start("sel", 3), 0);
}

#[test]
fn completion_start_after_whitespace() {
    assert_eq!(completion_start("SELECT na", 9), 7);
}

#[test]
fn completion_start_after_punctuation() {
    assert_eq!(completion_start("SELECT id,na", 12), 10);
    assert_eq!(completion_start("WHERE (a=b", 10), 9);
}

#[test]
fn completion_start_after_qualified_name_dot() {
    assert_eq!(completion_start("SELECT users.em", 15), 13);
}

#[test]
fn completion_start_handles_multibyte_characters() {
    let line = "SELECT 'é' , na";
    assert_eq!(completion_start(line, line.len()), line.len() - 2);
}

// --- SQL candidates -------------------------------------------------------------

#[test]
fn empty_word_yields_no_candidates() {
    assert!(candidates("SELECT ", "", &catalog()).is_empty());
}

#[test]
fn lowercase_prefix_completes_keywords_in_lowercase() {
    let result = candidates("sel", "sel", &catalog());
    assert!(result.contains(&"select".to_string()));
}

#[test]
fn uppercase_prefix_completes_keywords_in_uppercase() {
    let result = candidates("SEL", "SEL", &catalog());
    assert!(result.contains(&"SELECT".to_string()));
}

#[test]
fn tables_complete_case_insensitively() {
    let result = candidates("SELECT * FROM us", "us", &catalog());
    assert!(result.contains(&"users".to_string()));

    let result = candidates("SELECT * FROM US", "US", &catalog());
    assert!(result.contains(&"users".to_string()));
}

#[test]
fn columns_from_every_table_complete() {
    let result = candidates("SELECT ti", "ti", &catalog());
    assert!(result.contains(&"title".to_string()));

    let result = candidates("SELECT em", "em", &catalog());
    assert!(result.contains(&"email".to_string()));
}

#[test]
fn duplicate_candidates_are_removed() {
    // `id` exists in both tables but must appear once.
    let result = candidates("SELECT id", "id", &catalog());
    assert_eq!(result.iter().filter(|c| *c == "id").count(), 1);
}

#[test]
fn empty_catalog_still_completes_keywords() {
    let result = candidates("fro", "fro", &Catalog::default());
    assert_eq!(result, vec!["from".to_string()]);
}

// --- meta command candidates ------------------------------------------------------

#[test]
fn backslash_prefix_completes_meta_commands() {
    let result = candidates("\\d", "\\d", &catalog());
    assert!(result.contains(&"\\d".to_string()));
    assert!(result.contains(&"\\dt".to_string()));
    assert!(result.contains(&"\\dn".to_string()));
}

#[test]
fn describe_argument_completes_table_names() {
    let result = candidates("\\d us", "us", &catalog());
    assert_eq!(result, vec!["users".to_string()]);
}

#[test]
fn format_argument_completes_formats() {
    let result = candidates("\\f ex", "ex", &catalog());
    assert_eq!(result, vec!["expanded".to_string()]);
}

#[test]
fn pager_argument_completes_on_off() {
    let result = candidates("\\pager o", "o", &catalog());
    assert_eq!(result, vec!["on".to_string(), "off".to_string()]);
}

#[test]
fn unknown_meta_argument_yields_no_candidates() {
    assert!(candidates("\\limit 5", "5", &catalog()).is_empty());
}
