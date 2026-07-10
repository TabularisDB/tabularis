//! Pure formatting helpers for CLI output: value rendering, aligned ASCII
//! tables, CSV and JSON. No I/O happens here so everything is unit-testable.

use crate::models::QueryResult;
use serde_json::Value;

/// Render a single JSON cell value as plain text. Strings are printed raw
/// (no quotes), `null` becomes `NULL`, everything else uses its compact JSON
/// representation.
pub fn format_value(value: &Value) -> String {
    match value {
        Value::Null => "NULL".to_string(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Convert a `QueryResult`'s rows into plain-text cells.
pub fn result_to_rows(result: &QueryResult) -> Vec<Vec<String>> {
    result
        .rows
        .iter()
        .map(|row| row.iter().map(format_value).collect())
        .collect()
}

/// Replace every control character (C0 including ESC, DEL, C1) with a visible
/// escape. Database-sourced text reaches the terminal through here, so this
/// is what stops crafted cell values or identifiers from injecting ANSI
/// escape sequences (cursor movement, OSC 52 clipboard writes, title changes)
/// — not just a cosmetic alignment fix.
pub fn sanitize_text(text: &str) -> String {
    if !text.chars().any(char::is_control) {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '\r' => out.push_str("\\r"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => out.extend(c.escape_unicode()),
            c => out.push(c),
        }
    }
    out
}

/// Render an aligned ASCII table (psql/mysql style) with a header row.
///
/// ```text
/// +----+-------+
/// | id | name  |
/// +----+-------+
/// | 1  | Alice |
/// +----+-------+
/// ```
pub fn render_table(headers: &[String], rows: &[Vec<String>]) -> String {
    let cols = headers.len();
    // Headers are database-sourced too (column names), so they get the same
    // sanitization as cells.
    let headers: Vec<String> = headers.iter().map(|h| sanitize_text(h)).collect();
    let sanitized: Vec<Vec<String>> = rows
        .iter()
        .map(|row| {
            (0..cols)
                .map(|i| sanitize_text(row.get(i).map(String::as_str).unwrap_or("")))
                .collect()
        })
        .collect();

    let mut widths: Vec<usize> = headers.iter().map(|h| h.chars().count()).collect();
    for row in &sanitized {
        for (i, cell) in row.iter().enumerate() {
            widths[i] = widths[i].max(cell.chars().count());
        }
    }

    let separator = {
        let mut s = String::from("+");
        for w in &widths {
            s.push_str(&"-".repeat(w + 2));
            s.push('+');
        }
        s
    };

    let render_row = |cells: &[String]| {
        let mut line = String::from("|");
        for (i, w) in widths.iter().enumerate() {
            let cell = cells.get(i).map(String::as_str).unwrap_or("");
            let pad = w - cell.chars().count();
            line.push(' ');
            line.push_str(cell);
            line.push_str(&" ".repeat(pad + 1));
            line.push('|');
        }
        line
    };

    let mut out = String::new();
    out.push_str(&separator);
    out.push('\n');
    out.push_str(&render_row(&headers));
    out.push('\n');
    out.push_str(&separator);
    for row in &sanitized {
        out.push('\n');
        out.push_str(&render_row(row));
    }
    if !sanitized.is_empty() {
        out.push('\n');
        out.push_str(&separator);
    }
    out
}

/// Render rows vertically, one block per record (psql `\x` style):
///
/// ```text
/// -[ RECORD 1 ]-
/// id   | 1
/// name | Alice
/// ```
///
/// Wide result sets stay readable because every column gets its own line.
pub fn render_expanded(headers: &[String], rows: &[Vec<String>]) -> String {
    let headers: Vec<String> = headers.iter().map(|h| sanitize_text(h)).collect();
    let name_width = headers.iter().map(|h| h.chars().count()).max().unwrap_or(0);

    let mut out = String::new();
    for (i, row) in rows.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        out.push_str(&format!("-[ RECORD {} ]-", i + 1));
        for (j, header) in headers.iter().enumerate() {
            let cell = sanitize_text(row.get(j).map(String::as_str).unwrap_or(""));
            out.push('\n');
            out.push_str(header);
            out.push_str(&" ".repeat(name_width - header.chars().count()));
            out.push_str(" | ");
            out.push_str(&cell);
        }
    }
    out
}

/// Render rows as CSV with a header row.
pub fn render_csv(headers: &[String], rows: &[Vec<String>]) -> Result<String, String> {
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(headers).map_err(|e| e.to_string())?;
    for row in rows {
        writer.write_record(row).map_err(|e| e.to_string())?;
    }
    let bytes = writer.into_inner().map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

/// Render a query result as a JSON array of `{column: value}` objects,
/// preserving the original JSON values (not their text rendering).
pub fn render_json(result: &QueryResult) -> String {
    let objects: Vec<Value> = result
        .rows
        .iter()
        .map(|row| {
            let map: serde_json::Map<String, Value> = result
                .columns
                .iter()
                .cloned()
                .zip(row.iter().cloned())
                .collect();
            Value::Object(map)
        })
        .collect();
    serde_json::to_string_pretty(&objects).expect("serializing JSON values cannot fail")
}
