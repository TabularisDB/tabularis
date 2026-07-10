use super::output::{
    format_value, render_csv, render_expanded, render_json, render_table, result_to_rows,
    sanitize_text,
};
use crate::models::QueryResult;
use serde_json::json;

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|s| s.to_string()).collect()
}

fn sample_result() -> QueryResult {
    QueryResult {
        columns: strings(&["id", "name"]),
        rows: vec![vec![json!(1), json!("Alice")], vec![json!(2), json!(null)]],
        affected_rows: 0,
        truncated: false,
        pagination: None,
    }
}

// --- format_value -----------------------------------------------------------

#[test]
fn format_value_renders_null_as_uppercase_null() {
    assert_eq!(format_value(&json!(null)), "NULL");
}

#[test]
fn format_value_renders_strings_without_quotes() {
    assert_eq!(format_value(&json!("hello")), "hello");
}

#[test]
fn format_value_renders_numbers_and_booleans() {
    assert_eq!(format_value(&json!(42)), "42");
    assert_eq!(format_value(&json!(1.5)), "1.5");
    assert_eq!(format_value(&json!(true)), "true");
}

#[test]
fn format_value_renders_nested_json_compactly() {
    assert_eq!(format_value(&json!({"a": 1})), r#"{"a":1}"#);
    assert_eq!(format_value(&json!([1, 2])), "[1,2]");
}

// --- result_to_rows ---------------------------------------------------------

#[test]
fn result_to_rows_maps_every_cell() {
    let rows = result_to_rows(&sample_result());
    assert_eq!(
        rows,
        vec![strings(&["1", "Alice"]), strings(&["2", "NULL"])]
    );
}

// --- sanitize_text ----------------------------------------------------------

#[test]
fn sanitize_text_leaves_plain_text_untouched() {
    assert_eq!(sanitize_text("hello world é 日本"), "hello world é 日本");
}

#[test]
fn sanitize_text_escapes_newlines_carriage_returns_and_tabs() {
    assert_eq!(sanitize_text("a\nb\rc\td"), "a\\nb\\rc\\td");
}

#[test]
fn sanitize_text_escapes_ansi_escape_sequences() {
    // OSC 52 clipboard write: ESC ] 52 ; c ; <payload> BEL
    assert_eq!(
        sanitize_text("\x1b]52;c;ZWNobyBwd25lZA==\x07"),
        "\\u{1b}]52;c;ZWNobyBwd25lZA==\\u{7}"
    );
}

#[test]
fn sanitize_text_escapes_c1_control_characters() {
    // U+009B is CSI, the single-character form of ESC [
    assert_eq!(sanitize_text("a\u{9b}31mb"), "a\\u{9b}31mb");
    assert_eq!(sanitize_text("del\u{7f}"), "del\\u{7f}");
}

// --- render_table -----------------------------------------------------------

#[test]
fn render_table_aligns_columns_to_widest_cell() {
    let table = render_table(
        &strings(&["id", "name"]),
        &[strings(&["1", "Alice"]), strings(&["10", "Bo"])],
    );
    let expected = "\
+----+-------+
| id | name  |
+----+-------+
| 1  | Alice |
| 10 | Bo    |
+----+-------+";
    assert_eq!(table, expected);
}

#[test]
fn render_table_with_no_rows_prints_header_only() {
    let table = render_table(&strings(&["id"]), &[]);
    let expected = "\
+----+
| id |
+----+";
    assert_eq!(table, expected);
}

#[test]
fn render_table_escapes_newlines_and_tabs() {
    let table = render_table(&strings(&["v"]), &[strings(&["a\nb\tc"])]);
    assert!(table.contains("a\\nb\\tc"));
}

#[test]
fn render_table_escapes_control_characters_in_cells_and_headers() {
    let table = render_table(
        &strings(&["na\x1b[2Jme"]),
        &[strings(&["\x1b]0;owned\x07"])],
    );
    assert!(!table.contains('\x1b'));
    assert!(table.contains("na\\u{1b}[2Jme"));
    assert!(table.contains("\\u{1b}]0;owned\\u{7}"));
}

#[test]
fn render_table_pads_missing_cells() {
    let table = render_table(&strings(&["a", "b"]), &[strings(&["1"])]);
    assert!(table.contains("| 1 |   |"));
}

// --- render_expanded ----------------------------------------------------------

#[test]
fn render_expanded_prints_one_block_per_record() {
    let text = render_expanded(
        &strings(&["id", "name"]),
        &[strings(&["1", "Alice"]), strings(&["2", "Bo"])],
    );
    let expected = "\
-[ RECORD 1 ]-
id   | 1
name | Alice
-[ RECORD 2 ]-
id   | 2
name | Bo";
    assert_eq!(text, expected);
}

#[test]
fn render_expanded_aligns_column_names_to_the_widest() {
    let text = render_expanded(&strings(&["a", "long_name"]), &[strings(&["1", "2"])]);
    assert!(text.contains("a         | 1"));
    assert!(text.contains("long_name | 2"));
}

#[test]
fn render_expanded_with_no_rows_is_empty() {
    assert_eq!(render_expanded(&strings(&["id"]), &[]), "");
}

#[test]
fn render_expanded_pads_missing_cells() {
    let text = render_expanded(&strings(&["a", "b"]), &[strings(&["1"])]);
    assert!(text.contains("b | "));
}

#[test]
fn render_expanded_escapes_control_characters_in_names_and_cells() {
    let text = render_expanded(
        &strings(&["na\x1b[2Jme"]),
        &[strings(&["\x1b]0;owned\x07"])],
    );
    assert!(!text.contains('\x1b'));
    assert!(text.contains("na\\u{1b}[2Jme"));
    assert!(text.contains("\\u{1b}]0;owned\\u{7}"));
}

// --- render_csv -------------------------------------------------------------

#[test]
fn render_csv_writes_header_and_rows() {
    let csv = render_csv(&strings(&["id", "name"]), &[strings(&["1", "Alice"])]).unwrap();
    assert_eq!(csv, "id,name\n1,Alice\n");
}

#[test]
fn render_csv_quotes_cells_containing_separators() {
    let csv = render_csv(&strings(&["v"]), &[strings(&["a,b"])]).unwrap();
    assert_eq!(csv, "v\n\"a,b\"\n");
}

// --- render_json ------------------------------------------------------------

#[test]
fn render_json_emits_array_of_row_objects() {
    let rendered = render_json(&sample_result());
    let parsed: serde_json::Value = serde_json::from_str(&rendered).unwrap();
    assert_eq!(
        parsed,
        json!([
            {"id": 1, "name": "Alice"},
            {"id": 2, "name": null},
        ])
    );
}

#[test]
fn render_json_with_no_rows_emits_empty_array() {
    let mut result = sample_result();
    result.rows.clear();
    let parsed: serde_json::Value = serde_json::from_str(&render_json(&result)).unwrap();
    assert_eq!(parsed, json!([]));
}
