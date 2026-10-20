use super::format::{
    parse_csv_delimiter, value_to_csv_string, ExportFormat, DEFAULT_CSV_DELIMITER,
};
use super::progress::ProgressEmitter;
use super::sink::{
    escape_html, html_cell, CsvSink, HtmlSink, JsonSink, MarkdownSink, NdjsonSink, RowSink,
};
use serde_json::{json, Value};

// ---------------------------------------------------------------------------
// ExportFormat::parse
// ---------------------------------------------------------------------------

#[test]
fn parse_csv_format_accepts_lowercase() {
    assert_eq!(ExportFormat::parse("csv").unwrap(), ExportFormat::Csv);
}

#[test]
fn parse_csv_format_is_case_insensitive() {
    assert_eq!(ExportFormat::parse("CSV").unwrap(), ExportFormat::Csv);
    assert_eq!(ExportFormat::parse("Csv").unwrap(), ExportFormat::Csv);
}

#[test]
fn parse_json_format_is_case_insensitive() {
    assert_eq!(ExportFormat::parse("json").unwrap(), ExportFormat::Json);
    assert_eq!(ExportFormat::parse("JSON").unwrap(), ExportFormat::Json);
}

#[test]
fn parse_markdown_format_accepts_md_alias() {
    assert_eq!(
        ExportFormat::parse("markdown").unwrap(),
        ExportFormat::Markdown
    );
    assert_eq!(ExportFormat::parse("MD").unwrap(), ExportFormat::Markdown);
}

#[test]
fn parse_ndjson_and_html_formats_are_case_insensitive() {
    assert_eq!(ExportFormat::parse("ndjson").unwrap(), ExportFormat::Ndjson);
    assert_eq!(ExportFormat::parse("NDJSON").unwrap(), ExportFormat::Ndjson);
    assert_eq!(ExportFormat::parse("html").unwrap(), ExportFormat::Html);
    assert_eq!(ExportFormat::parse("HTML").unwrap(), ExportFormat::Html);
}

#[test]
fn parse_format_trims_whitespace() {
    assert_eq!(ExportFormat::parse("  csv ").unwrap(), ExportFormat::Csv);
}

#[test]
fn parse_format_rejects_unknown() {
    let err = ExportFormat::parse("xml").unwrap_err();
    assert!(err.contains("xml"));
}

// ---------------------------------------------------------------------------
// parse_csv_delimiter
// ---------------------------------------------------------------------------

#[test]
fn delimiter_defaults_to_comma_when_none() {
    assert_eq!(parse_csv_delimiter(None), DEFAULT_CSV_DELIMITER);
}

#[test]
fn delimiter_defaults_to_comma_for_empty_string() {
    assert_eq!(parse_csv_delimiter(Some("")), DEFAULT_CSV_DELIMITER);
}

#[test]
fn delimiter_uses_first_byte() {
    assert_eq!(parse_csv_delimiter(Some(";")), b';');
    assert_eq!(parse_csv_delimiter(Some("|extra")), b'|');
    assert_eq!(parse_csv_delimiter(Some("\t")), b'\t');
}

// ---------------------------------------------------------------------------
// value_to_csv_string
// ---------------------------------------------------------------------------

#[test]
fn value_to_csv_emits_raw_string_without_quotes() {
    assert_eq!(value_to_csv_string(&json!("hello")), "hello");
}

#[test]
fn value_to_csv_emits_null_sentinel() {
    assert_eq!(value_to_csv_string(&Value::Null), "NULL");
}

#[test]
fn value_to_csv_serializes_numbers_and_bools() {
    assert_eq!(value_to_csv_string(&json!(42)), "42");
    assert_eq!(value_to_csv_string(&json!(3.5)), "3.5");
    assert_eq!(value_to_csv_string(&json!(true)), "true");
    assert_eq!(value_to_csv_string(&json!(false)), "false");
}

#[test]
fn value_to_csv_serializes_objects_and_arrays_as_json() {
    assert_eq!(value_to_csv_string(&json!({"a": 1})), r#"{"a":1}"#);
    assert_eq!(value_to_csv_string(&json!([1, 2, 3])), "[1,2,3]");
}

// ---------------------------------------------------------------------------
// ProgressEmitter
// ---------------------------------------------------------------------------

#[test]
fn progress_emits_at_each_interval() {
    let mut emitted: Vec<u64> = Vec::new();
    {
        let mut p = ProgressEmitter::new(3, |c| emitted.push(c));
        for _ in 0..7 {
            p.tick();
        }
    }
    assert_eq!(emitted, vec![3, 6]);
}

#[test]
fn progress_finish_always_emits_final_count() {
    let mut emitted: Vec<u64> = Vec::new();
    {
        let mut p = ProgressEmitter::new(100, |c| emitted.push(c));
        for _ in 0..5 {
            p.tick();
        }
        p.finish();
    }
    // 5 ticks, no interval emission, but finish() emits the final count.
    assert_eq!(emitted, vec![5]);
}

#[test]
fn progress_finish_emits_zero_on_empty_stream() {
    let mut emitted: Vec<u64> = Vec::new();
    {
        let mut p = ProgressEmitter::new(100, |c| emitted.push(c));
        p.finish();
    }
    assert_eq!(emitted, vec![0]);
}

#[test]
fn progress_interval_zero_is_normalized_to_one() {
    let mut emitted: Vec<u64> = Vec::new();
    {
        let mut p = ProgressEmitter::new(0, |c| emitted.push(c));
        for _ in 0..3 {
            p.tick();
        }
    }
    assert_eq!(emitted, vec![1, 2, 3]);
}

#[test]
fn progress_counter_tracks_total_ticks() {
    let mut p = ProgressEmitter::new(100, |_| ());
    for _ in 0..42 {
        p.tick();
    }
    assert_eq!(p.count(), 42);
}

// ---------------------------------------------------------------------------
// CsvSink
// ---------------------------------------------------------------------------

fn collect_csv(delimiter: u8, rows: &[(Vec<&str>, Vec<Value>)]) -> String {
    let mut buf: Vec<u8> = Vec::new();
    {
        let mut sink = CsvSink::new(&mut buf, delimiter);
        for (headers, values) in rows {
            let headers_owned: Vec<String> = headers.iter().map(|s| s.to_string()).collect();
            sink.write_row(&headers_owned, values).unwrap();
        }
        sink.finish().unwrap();
    }
    String::from_utf8(buf).unwrap()
}

#[test]
fn csv_writes_headers_once_then_rows() {
    let csv = collect_csv(
        b',',
        &[
            (vec!["id", "name"], vec![json!(1), json!("alice")]),
            (vec!["id", "name"], vec![json!(2), json!("bob")]),
        ],
    );
    assert_eq!(csv, "id,name\n1,alice\n2,bob\n");
}

#[test]
fn csv_respects_custom_delimiter() {
    let csv = collect_csv(b';', &[(vec!["a", "b"], vec![json!("x"), json!("y")])]);
    assert_eq!(csv, "a;b\nx;y\n");
}

#[test]
fn csv_emits_null_sentinel_for_null_values() {
    let csv = collect_csv(b',', &[(vec!["v"], vec![Value::Null])]);
    assert_eq!(csv, "v\nNULL\n");
}

#[test]
fn csv_quotes_values_containing_delimiter() {
    let csv = collect_csv(b',', &[(vec!["v"], vec![json!("a,b")])]);
    assert!(csv.contains("\"a,b\""));
}

// ---------------------------------------------------------------------------
// MarkdownSink
// ---------------------------------------------------------------------------

fn collect_markdown(rows: &[(Vec<&str>, Vec<Value>)]) -> String {
    let mut buf: Vec<u8> = Vec::new();
    {
        let mut sink = MarkdownSink::new(&mut buf);
        for (headers, values) in rows {
            let headers_owned: Vec<String> = headers.iter().map(|s| s.to_string()).collect();
            sink.write_row(&headers_owned, values).unwrap();
        }
        sink.finish().unwrap();
    }
    String::from_utf8(buf).unwrap()
}

#[test]
fn markdown_writes_header_separator_then_rows() {
    let md = collect_markdown(&[
        (vec!["id", "name"], vec![json!(1), json!("alice")]),
        (vec!["id", "name"], vec![json!(2), json!("bob")]),
    ]);
    assert_eq!(
        md,
        "| id | name |\n| --- | --- |\n| 1 | alice |\n| 2 | bob |\n"
    );
}

#[test]
fn markdown_emits_null_sentinel_for_null_values() {
    let md = collect_markdown(&[(vec!["v"], vec![Value::Null])]);
    assert_eq!(md, "| v |\n| --- |\n| NULL |\n");
}

#[test]
fn markdown_escapes_pipes_and_newlines() {
    let md = collect_markdown(&[(
        vec!["a", "b"],
        vec![json!("x|y"), json!("line1\nline2\r\nline3")],
    )]);
    assert_eq!(
        md,
        "| a | b |\n| --- | --- |\n| x\\|y | line1<br>line2<br>line3 |\n"
    );
}

#[test]
fn markdown_empty_stream_writes_nothing() {
    let md = collect_markdown(&[]);
    assert_eq!(md, "");
}

// ---------------------------------------------------------------------------
// JsonSink
// ---------------------------------------------------------------------------

fn collect_json(rows: &[(Vec<&str>, Vec<Value>)]) -> String {
    let mut buf: Vec<u8> = Vec::new();
    {
        let mut sink = JsonSink::new(&mut buf);
        for (headers, values) in rows {
            let headers_owned: Vec<String> = headers.iter().map(|s| s.to_string()).collect();
            sink.write_row(&headers_owned, values).unwrap();
        }
        sink.finish().unwrap();
    }
    String::from_utf8(buf).unwrap()
}

#[test]
fn json_empty_stream_writes_empty_array() {
    let json_out = collect_json(&[]);
    assert_eq!(json_out, "[]");
}

#[test]
fn json_single_row_is_wrapped_in_array() {
    let json_out = collect_json(&[(vec!["id", "name"], vec![json!(1), json!("alice")])]);
    let parsed: Value = serde_json::from_str(&json_out).unwrap();
    assert_eq!(parsed, json!([{"id": 1, "name": "alice"}]));
}

#[test]
fn json_multiple_rows_separated_by_commas() {
    let json_out = collect_json(&[
        (vec!["id"], vec![json!(1)]),
        (vec!["id"], vec![json!(2)]),
        (vec!["id"], vec![json!(3)]),
    ]);
    let parsed: Value = serde_json::from_str(&json_out).unwrap();
    assert_eq!(parsed, json!([{"id": 1}, {"id": 2}, {"id": 3}]));
}

#[test]
fn json_preserves_value_types_unchanged() {
    let json_out = collect_json(&[(
        vec!["n", "f", "b", "s", "z"],
        vec![json!(42), json!(3.5), json!(true), json!("hi"), Value::Null],
    )]);
    let parsed: Value = serde_json::from_str(&json_out).unwrap();
    assert_eq!(
        parsed,
        json!([{"n": 42, "f": 3.5, "b": true, "s": "hi", "z": null}])
    );
}

#[test]
fn json_missing_value_defaults_to_null() {
    // Defensive: if a driver yields fewer values than headers, the sink fills
    // the gap with null rather than panicking.
    let mut buf: Vec<u8> = Vec::new();
    {
        let mut sink = JsonSink::new(&mut buf);
        let headers = vec!["a".to_string(), "b".to_string()];
        sink.write_row(&headers, &[json!(1)]).unwrap();
        sink.finish().unwrap();
    }
    let parsed: Value = serde_json::from_str(&String::from_utf8(buf).unwrap()).unwrap();
    assert_eq!(parsed, json!([{"a": 1, "b": null}]));
}

// ---------------------------------------------------------------------------
// NdjsonSink
// ---------------------------------------------------------------------------

fn collect_with<S: RowSink>(sink: &mut S, rows: &[(Vec<&str>, Vec<Value>)]) {
    for (headers, values) in rows {
        let headers_owned: Vec<String> = headers.iter().map(|s| s.to_string()).collect();
        sink.write_row(&headers_owned, values).unwrap();
    }
    sink.finish().unwrap();
}

fn collect_ndjson(rows: &[(Vec<&str>, Vec<Value>)]) -> String {
    let mut buf: Vec<u8> = Vec::new();
    collect_with(&mut NdjsonSink::new(&mut buf), rows);
    String::from_utf8(buf).unwrap()
}

#[test]
fn ndjson_empty_stream_writes_nothing() {
    assert_eq!(collect_ndjson(&[]), "");
}

#[test]
fn ndjson_writes_one_object_per_line_with_trailing_newline() {
    let out = collect_ndjson(&[
        (vec!["id", "name"], vec![json!(1), json!("alice")]),
        (vec!["id", "name"], vec![json!(2), json!("bob")]),
    ]);
    assert_eq!(
        out,
        "{\"id\":1,\"name\":\"alice\"}\n{\"id\":2,\"name\":\"bob\"}\n"
    );
}

#[test]
fn ndjson_keeps_column_order() {
    let out = collect_ndjson(&[(vec!["z", "a", "m"], vec![json!(1), json!(2), json!(3)])]);
    assert_eq!(out, "{\"z\":1,\"a\":2,\"m\":3}\n");
}

#[test]
fn ndjson_keeps_null_and_value_types() {
    let out = collect_ndjson(&[(
        vec!["n", "b", "s", "z", "o"],
        vec![
            json!(42),
            json!(true),
            json!("hi"),
            Value::Null,
            json!({"k": [1]}),
        ],
    )]);
    assert_eq!(
        out,
        "{\"n\":42,\"b\":true,\"s\":\"hi\",\"z\":null,\"o\":{\"k\":[1]}}\n"
    );
}

#[test]
fn ndjson_escapes_newlines_inside_values() {
    // A raw newline in a value must not split the record.
    let out = collect_ndjson(&[(vec!["v"], vec![json!("a\nb")])]);
    assert_eq!(out, r#"{"v":"a\nb"}"#.to_owned() + "\n");
    assert_eq!(out.lines().count(), 1);
}

#[test]
fn ndjson_missing_value_defaults_to_null() {
    let mut buf: Vec<u8> = Vec::new();
    {
        let mut sink = NdjsonSink::new(&mut buf);
        let headers = vec!["a".to_string(), "b".to_string()];
        sink.write_row(&headers, &[json!(1)]).unwrap();
        sink.finish().unwrap();
    }
    assert_eq!(String::from_utf8(buf).unwrap(), "{\"a\":1,\"b\":null}\n");
}

// ---------------------------------------------------------------------------
// HtmlSink
// ---------------------------------------------------------------------------

const HTML_PREFIX: &str = "<!DOCTYPE html>\n\
<html lang=\"en\">\n\
<head>\n\
<meta charset=\"utf-8\">\n\
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
<title>Query results</title>\n\
<style>\n\
body { font-family: system-ui, sans-serif; margin: 1.5rem; }\n\
table { border-collapse: collapse; }\n\
th, td { border: 1px solid; padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }\n\
th { font-weight: 600; }\n\
</style>\n\
</head>\n\
<body>\n";

const HTML_SUFFIX: &str = "\n</body>\n</html>\n";

fn collect_html(rows: &[(Vec<&str>, Vec<Value>)]) -> String {
    let mut buf: Vec<u8> = Vec::new();
    collect_with(&mut HtmlSink::new(&mut buf), rows);
    String::from_utf8(buf).unwrap()
}

#[test]
fn html_writes_document_with_header_and_rows() {
    let out = collect_html(&[
        (vec!["id", "name"], vec![json!(1), json!("alice")]),
        (vec!["id", "name"], vec![json!(2), json!("bob")]),
    ]);
    assert_eq!(
        out,
        format!(
            "{HTML_PREFIX}<table><thead><tr><th>id</th><th>name</th></tr></thead><tbody>\
             <tr><td>1</td><td>alice</td></tr><tr><td>2</td><td>bob</td></tr>\
             </tbody></table>{HTML_SUFFIX}"
        )
    );
}

#[test]
fn html_empty_stream_writes_valid_document_with_empty_table() {
    assert_eq!(
        collect_html(&[]),
        format!("{HTML_PREFIX}<table><thead><tr></tr></thead><tbody></tbody></table>{HTML_SUFFIX}")
    );
}

#[test]
fn html_writes_lowercase_null_and_scalars() {
    let out = collect_html(&[(
        vec!["z", "b", "n", "o"],
        vec![Value::Null, json!(false), json!(3.5), json!({"a": 1})],
    )]);
    assert!(
        out.contains("<tr><td>null</td><td>false</td><td>3.5</td><td>{&quot;a&quot;:1}</td></tr>")
    );
}

#[test]
fn html_escapes_headers_and_cells() {
    let out = collect_html(&[(vec!["<a&b>"], vec![json!("<script>'x' & \"y\"</script>")])]);
    assert!(out.contains("<th>&lt;a&amp;b&gt;</th>"));
    assert!(out.contains("<td>&lt;script&gt;&#39;x&#39; &amp; &quot;y&quot;&lt;/script&gt;</td>"));
}

#[test]
fn escape_html_replaces_the_five_special_characters() {
    assert_eq!(escape_html(r#"&<>"'"#), "&amp;&lt;&gt;&quot;&#39;");
    assert_eq!(escape_html("plain"), "plain");
    assert_eq!(escape_html(""), "");
}

#[test]
fn html_cell_turns_line_breaks_into_br() {
    assert_eq!(html_cell(&json!("a\nb\r\nc")), "a<br>b<br>c");
    assert_eq!(html_cell(&json!("a<\nb")), "a&lt;<br>b");
}

#[test]
fn html_cell_writes_null_as_lowercase_null() {
    assert_eq!(html_cell(&Value::Null), "null");
    assert_eq!(html_cell(&json!("NULL")), "NULL");
}
