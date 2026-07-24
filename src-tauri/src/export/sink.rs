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
        self.writer
            .write_record(&record)
            .map_err(|e| e.to_string())
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
            let header_cells: Vec<String> =
                headers.iter().map(|h| Self::escape_cell(h)).collect();
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

        let mut obj = serde_json::Map::with_capacity(headers.len());
        for (i, name) in headers.iter().enumerate() {
            let val = values.get(i).cloned().unwrap_or(Value::Null);
            obj.insert(name.clone(), val);
        }
        serde_json::to_writer(&mut self.writer, &obj).map_err(|e| e.to_string())?;

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
