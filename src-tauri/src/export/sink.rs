use serde_json::ser::{CompactFormatter, Formatter};
use serde_json::Value;
use std::io::Write;

use super::format::value_to_csv_string;

/// A streaming consumer of rows produced by a driver.
///
/// `write_row` is called once per database row with the column names (stable
/// across the whole export) and the extracted JSON values. `finish` is called
/// after the last row so the sink can flush any trailing data.
pub trait RowSink {
    fn write_row(&mut self, headers: &[String], values: &[Value]) -> Result<(), String>;
    fn finish(&mut self) -> Result<(), String>;
}

pub struct CsvSink<W: Write> {
    writer: csv::Writer<W>,
    headers_written: bool,
}

impl<W: Write> CsvSink<W> {
    pub fn new(inner: W, delimiter: u8) -> Self {
        Self {
            writer: csv::WriterBuilder::new()
                .delimiter(delimiter)
                .from_writer(inner),
            headers_written: false,
        }
    }
}

impl<W: Write> RowSink for CsvSink<W> {
    fn write_row(&mut self, headers: &[String], values: &[Value]) -> Result<(), String> {
        if !self.headers_written {
            self.writer
                .write_record(headers)
                .map_err(|e| e.to_string())?;
            self.headers_written = true;
        }
        let record: Vec<String> = values.iter().map(value_to_csv_string).collect();
        self.writer.write_record(&record).map_err(|e| e.to_string())
    }

    fn finish(&mut self) -> Result<(), String> {
        self.writer.flush().map_err(|e| e.to_string())
    }
}

/// Streaming Markdown-table sink. Emits the header row and `---` separator
/// lazily on the first row, then one `| a | b |` line per row. Pipes are
/// escaped as `\|` and newlines become `<br>` so cell content cannot break
/// the table structure — mirroring the frontend copy-as-Markdown behavior.
pub struct MarkdownSink<W: Write> {
    writer: W,
    headers_written: bool,
}

impl<W: Write> MarkdownSink<W> {
    pub fn new(writer: W) -> Self {
        Self {
            writer,
            headers_written: false,
        }
    }

    fn escape_cell(raw: &str) -> String {
        raw.replace('|', "\\|")
            .replace("\r\n", "<br>")
            .replace(['\r', '\n'], "<br>")
    }

    fn write_line(&mut self, cells: &[String]) -> Result<(), String> {
        writeln!(self.writer, "| {} |", cells.join(" | ")).map_err(|e| e.to_string())
    }
}

impl<W: Write> RowSink for MarkdownSink<W> {
    fn write_row(&mut self, headers: &[String], values: &[Value]) -> Result<(), String> {
        if !self.headers_written {
            let header_cells: Vec<String> = headers.iter().map(|h| Self::escape_cell(h)).collect();
            self.write_line(&header_cells)?;
            let separator: Vec<String> = headers.iter().map(|_| "---".to_string()).collect();
            self.write_line(&separator)?;
            self.headers_written = true;
        }
        let cells: Vec<String> = values
            .iter()
            .map(|v| Self::escape_cell(&value_to_csv_string(v)))
            .collect();
        self.write_line(&cells)
    }

    fn finish(&mut self) -> Result<(), String> {
        self.writer.flush().map_err(|e| e.to_string())
    }
}

/// Builds the `{ column: value }` object for one row, in column order. A
/// missing value becomes `null`; a repeated column name keeps its first
/// position and its last value, like the frontend `rowToResultObject`.
fn row_to_object(headers: &[String], values: &[Value]) -> serde_json::Map<String, Value> {
    let mut obj = serde_json::Map::with_capacity(headers.len());
    for (i, name) in headers.iter().enumerate() {
        let val = values.get(i).cloned().unwrap_or(Value::Null);
        obj.insert(name.clone(), val);
    }
    obj
}

/// Streaming JSON-array sink. Delegates the `[`, `,`, `]` punctuation to
/// `serde_json::ser::CompactFormatter` so we never reinvent JSON framing.
pub struct JsonSink<W: Write> {
    writer: W,
    formatter: CompactFormatter,
    started: bool,
    first: bool,
}

impl<W: Write> JsonSink<W> {
    pub fn new(writer: W) -> Self {
        Self {
            writer,
            formatter: CompactFormatter,
            started: false,
            first: true,
        }
    }

    fn ensure_started(&mut self) -> Result<(), String> {
        if !self.started {
            self.formatter
                .begin_array(&mut self.writer)
                .map_err(|e| e.to_string())?;
            self.started = true;
        }
        Ok(())
    }
}

impl<W: Write> RowSink for JsonSink<W> {
    fn write_row(&mut self, headers: &[String], values: &[Value]) -> Result<(), String> {
        self.ensure_started()?;
        self.formatter
            .begin_array_value(&mut self.writer, self.first)
            .map_err(|e| e.to_string())?;
        self.first = false;

        serde_json::to_writer(&mut self.writer, &row_to_object(headers, values))
            .map_err(|e| e.to_string())?;

        self.formatter
            .end_array_value(&mut self.writer)
            .map_err(|e| e.to_string())
    }

    fn finish(&mut self) -> Result<(), String> {
        self.ensure_started()?;
        self.formatter
            .end_array(&mut self.writer)
            .map_err(|e| e.to_string())?;
        self.writer.flush().map_err(|e| e.to_string())
    }
}

/// Streaming NDJSON sink: one compact JSON object per row, every record
/// (the last one included) terminated by `\n`. An empty stream writes an
/// empty file, like the frontend NDJSON export.
pub struct NdjsonSink<W: Write> {
    writer: W,
}

impl<W: Write> NdjsonSink<W> {
    pub fn new(writer: W) -> Self {
        Self { writer }
    }
}

impl<W: Write> RowSink for NdjsonSink<W> {
    fn write_row(&mut self, headers: &[String], values: &[Value]) -> Result<(), String> {
        serde_json::to_writer(&mut self.writer, &row_to_object(headers, values))
            .map_err(|e| e.to_string())?;
        self.writer.write_all(b"\n").map_err(|e| e.to_string())
    }

    fn finish(&mut self) -> Result<(), String> {
        self.writer.flush().map_err(|e| e.to_string())
    }
}

const HTML_DOCUMENT_HEAD: &str = "<!DOCTYPE html>
<html lang=\"en\">
<head>
<meta charset=\"utf-8\">
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">
<title>Query results</title>
<style>
body { font-family: system-ui, sans-serif; margin: 1.5rem; }
table { border-collapse: collapse; }
th, td { border: 1px solid; padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
th { font-weight: 600; }
</style>
</head>
<body>
";

const HTML_DOCUMENT_TAIL: &str = "</tbody></table>
</body>
</html>
";

/// Streaming HTML sink. Produces the same standalone document as the frontend
/// `formatResultForExport(result, "html")`: the document head and the table
/// header are written on the first row, one `<tr>` per row, and the closing
/// tags on `finish`. An empty stream still yields a valid document with an
/// empty table, since no column names are known without a row.
pub struct HtmlSink<W: Write> {
    writer: W,
    headers_written: bool,
}

impl<W: Write> HtmlSink<W> {
    pub fn new(writer: W) -> Self {
        Self {
            writer,
            headers_written: false,
        }
    }

    fn write_head(&mut self, headers: &[String]) -> Result<(), String> {
        let header_cells: String = headers
            .iter()
            .map(|h| format!("<th>{}</th>", escape_html(h)))
            .collect();
        write!(
            self.writer,
            "{HTML_DOCUMENT_HEAD}<table><thead><tr>{header_cells}</tr></thead><tbody>"
        )
        .map_err(|e| e.to_string())?;
        self.headers_written = true;
        Ok(())
    }
}

/// Escapes the five HTML-significant characters, matching `escapeHtml` in
/// `packages/web-ui/src/utils/clipboard.ts`.
pub(crate) fn escape_html(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for c in raw.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            other => out.push(other),
        }
    }
    out
}

/// Cell text for the HTML table, matching `htmlCell` in
/// `packages/web-ui/src/utils/clipboard.ts`: NULL becomes `null`, the text is escaped and
/// `\r\n` / `\n` line breaks become `<br>`.
pub(crate) fn html_cell(val: &Value) -> String {
    let text = match val {
        Value::Null => "null".to_string(),
        other => value_to_csv_string(other),
    };
    escape_html(&text)
        .replace("\r\n", "<br>")
        .replace('\n', "<br>")
}

impl<W: Write> RowSink for HtmlSink<W> {
    fn write_row(&mut self, headers: &[String], values: &[Value]) -> Result<(), String> {
        if !self.headers_written {
            self.write_head(headers)?;
        }
        // One cell per header, padding a short row with null like the JSON writers do.
        let cells: String = (0..headers.len().max(values.len()))
            .map(|i| {
                format!(
                    "<td>{}</td>",
                    html_cell(values.get(i).unwrap_or(&Value::Null))
                )
            })
            .collect();
        write!(self.writer, "<tr>{cells}</tr>").map_err(|e| e.to_string())
    }

    fn finish(&mut self) -> Result<(), String> {
        if !self.headers_written {
            self.write_head(&[])?;
        }
        self.writer
            .write_all(HTML_DOCUMENT_TAIL.as_bytes())
            .map_err(|e| e.to_string())?;
        self.writer.flush().map_err(|e| e.to_string())
    }
}
