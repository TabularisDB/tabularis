//! The single-table SQL file format of "Export table to SQL" and "Import
//! table from SQL" (#709): its comment header, its section markers, the
//! statement reader the import streams it with, and the host `INSERT`
//! renderer. Pure helpers only; the export and import jobs live in
//! `application::table_transfers`.
//!
//! A file is plain SQL in the source driver's dialect. Tabularis metadata
//! lives in `-- Key: value` comment lines, so engines' own tools run it as is.

use std::collections::BTreeMap;
use std::io::BufRead;

use serde::{Deserialize, Serialize};

use crate::drivers::sql_syntax::LiteralStyle;
use crate::dump_utils::DumpDialect;

#[cfg(test)]
mod tests;

/// First line of every table export.
pub const HEADER_TITLE: &str = "-- Tabularis table export";
/// Name in the `Format` header line.
pub const FORMAT_NAME: &str = "tabularis-table-sql";
/// Highest `Format` major version this build reads and the one it writes.
pub const FORMAT_VERSION: u32 = 1;
/// Rows per `INSERT` statement.
pub const INSERT_BATCH_ROWS: usize = 500;
/// Header lines read at most before giving up on finding its end.
const MAX_HEADER_LINES: usize = 64;
/// Longest header line read.
const MAX_HEADER_LINE_BYTES: u64 = 4096;

pub const SECTION_STRUCTURE: &str = "structure";
pub const SECTION_DATA: &str = "data";
const SECTION_PREFIX: &str = "-- @section ";
const END_MARKER: &str = "-- @end";

/// Error for a `.sql` file that isn't a table export, so the import modal
/// can point the user to "Import database" instead.
pub const NOT_A_TABLE_EXPORT: &str =
    "This file is not a Tabularis table export. Use \"Import database\" to run an arbitrary SQL script.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TableSqlContent {
    StructureAndData,
    StructureOnly,
}

impl TableSqlContent {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::StructureAndData => "structure_and_data",
            Self::StructureOnly => "structure_only",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "structure_and_data" => Some(Self::StructureAndData),
            "structure_only" => Some(Self::StructureOnly),
            _ => None,
        }
    }

    pub fn has_data(self) -> bool {
        self == Self::StructureAndData
    }
}

/// Where the `CREATE TABLE` came from: the driver's own DDL for the table,
/// or built by the host from column metadata (indexes, constraints and
/// defaults may then be missing).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StructureSource {
    Driver,
    Generated,
}

impl StructureSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Driver => "driver",
            Self::Generated => "generated",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "driver" => Some(Self::Driver),
            "generated" => Some(Self::Generated),
            _ => None,
        }
    }
}

/// The metadata block at the top of a table export.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSqlHeader {
    pub format_version: u32,
    pub tabularis_version: String,
    pub driver: String,
    pub driver_version: Option<String>,
    /// Where the table came from, e.g. `shop.public.orders`. Display only.
    pub source: String,
    pub table: String,
    pub content: TableSqlContent,
    pub structure_source: StructureSource,
    pub rows: u64,
    pub exported: String,
}

impl TableSqlHeader {
    /// The header block, one `-- Key: value` line each, ending with a blank line.
    pub fn render(&self) -> String {
        let mut lines = vec![
            HEADER_TITLE.to_string(),
            format!("-- Format: {FORMAT_NAME}/{}", self.format_version),
            format!("-- Tabularis: {}", one_line(&self.tabularis_version)),
            format!("-- Driver: {}", one_line(&self.driver)),
        ];
        if let Some(version) = &self.driver_version {
            lines.push(format!("-- Driver-Version: {}", one_line(version)));
        }
        lines.extend([
            format!("-- Source: {}", one_line(&self.source)),
            format!("-- Table: {}", one_line(&self.table)),
            format!("-- Content: {}", self.content.as_str()),
            format!("-- Structure-Source: {}", self.structure_source.as_str()),
            format!("-- Rows: {}", self.rows),
            format!("-- Exported: {}", one_line(&self.exported)),
        ]);
        let mut out = lines.join("\n");
        out.push_str("\n\n");
        out
    }

    /// Reads the header from the start of a file. Fails with
    /// [`NOT_A_TABLE_EXPORT`] when the file doesn't start with one, and asks
    /// for a newer Tabularis when the format is newer than this build reads.
    /// Unknown keys are ignored.
    pub fn parse<R: BufRead>(reader: &mut R) -> Result<Self, String> {
        let mut fields = BTreeMap::new();
        let mut started = false;
        for _ in 0..MAX_HEADER_LINES {
            let mut line = String::new();
            let read = std::io::Read::take(&mut *reader, MAX_HEADER_LINE_BYTES)
                .read_line(&mut line)
                .map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            let line = line.trim_end_matches(['\r', '\n']).trim();
            if !started {
                if line.is_empty() {
                    continue;
                }
                if line.trim_start_matches('\u{feff}') != HEADER_TITLE {
                    return Err(NOT_A_TABLE_EXPORT.to_string());
                }
                started = true;
                continue;
            }
            if line.is_empty() || line.starts_with("-- @") || !line.starts_with("--") {
                break;
            }
            if let Some((key, value)) = line.trim_start_matches('-').trim().split_once(':') {
                fields.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
            }
        }
        if !started {
            return Err(NOT_A_TABLE_EXPORT.to_string());
        }
        Self::from_fields(&fields)
    }

    fn from_fields(fields: &BTreeMap<String, String>) -> Result<Self, String> {
        let required = |key: &str| {
            fields
                .get(key)
                .filter(|value| !value.is_empty())
                .cloned()
                .ok_or_else(|| format!("The table export header has no {key} line"))
        };
        let format = required("format")?;
        let format_version = parse_format(&format)?;
        let content = required("content")?;
        let content = TableSqlContent::parse(&content)
            .ok_or_else(|| format!("Unknown table export content: {content}"))?;
        let structure_source = fields
            .get("structure-source")
            .and_then(|value| StructureSource::parse(value))
            .unwrap_or(StructureSource::Driver);
        let rows = match content {
            TableSqlContent::StructureOnly => 0,
            TableSqlContent::StructureAndData => fields
                .get("rows")
                .and_then(|value| value.parse().ok())
                .unwrap_or(0),
        };
        Ok(Self {
            format_version,
            tabularis_version: fields.get("tabularis").cloned().unwrap_or_default(),
            driver: required("driver")?,
            driver_version: fields.get("driver-version").cloned(),
            source: fields.get("source").cloned().unwrap_or_default(),
            table: required("table")?,
            content,
            structure_source,
            rows,
            exported: fields.get("exported").cloned().unwrap_or_default(),
        })
    }
}

fn parse_format(value: &str) -> Result<u32, String> {
    let (name, version) = value
        .split_once('/')
        .ok_or_else(|| format!("Unknown table export format: {value}"))?;
    if name.trim() != FORMAT_NAME {
        return Err(format!("Unknown table export format: {value}"));
    }
    let major = version
        .trim()
        .split('.')
        .next()
        .and_then(|major| major.parse::<u32>().ok())
        .ok_or_else(|| format!("Unknown table export format: {value}"))?;
    if major > FORMAT_VERSION {
        return Err(format!(
            "This file uses table export format {major}, newer than this version of Tabularis reads ({FORMAT_VERSION}). Update Tabularis to import it."
        ));
    }
    Ok(major)
}

/// Header values are single lines.
fn one_line(value: &str) -> String {
    value.replace(['\r', '\n'], " ")
}

/// `-- @section <name>`
pub fn section_marker(name: &str) -> String {
    format!("{SECTION_PREFIX}{name}")
}

/// `-- @end`
pub fn end_marker() -> &'static str {
    END_MARKER
}

/// Removes the schema qualification from the table name in a driver's DDL
/// (`CREATE TABLE "public"."orders"` becomes `CREATE TABLE "orders"`), so
/// the file can be imported into any schema. Only the exact qualified name
/// the dialect would write is replaced; DDL that doesn't contain it is
/// returned unchanged.
pub fn unqualify_ddl(
    ddl: &str,
    dialect: &DumpDialect,
    schema: Option<&str>,
    table: &str,
) -> String {
    let qualified = dialect.table_ref(schema, table);
    let bare = dialect.quote_identifier(table);
    if qualified == bare {
        return ddl.to_string();
    }
    ddl.replace(&qualified, &bare)
}

/// Each DDL statement ends with `;`, so the import can split the section.
pub fn terminate_statements(ddl: &str) -> String {
    let trimmed = ddl.trim_end();
    if trimmed.ends_with(';') {
        trimmed.to_string()
    } else {
        format!("{trimmed};")
    }
}

/// One `INSERT` with an explicit column list for a batch of already
/// rendered rows: `INSERT INTO "t" ("a", "b") VALUES\n(1, 'x'),\n(2, NULL);`.
pub fn render_insert(
    dialect: &DumpDialect,
    table: &str,
    columns: &[String],
    rows: &[Vec<String>],
) -> String {
    let column_list = columns
        .iter()
        .map(|column| dialect.quote_identifier(column))
        .collect::<Vec<_>>()
        .join(", ");
    let values = rows
        .iter()
        .map(|row| format!("({})", row.join(", ")))
        .collect::<Vec<_>>()
        .join(",\n");
    format!(
        "INSERT INTO {} ({column_list}) VALUES\n{values};",
        dialect.quote_identifier(table)
    )
}

/// What the import reads next from a table export.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TableSqlItem {
    /// A `-- @section <name>` marker.
    Section(String),
    /// A complete statement, without its trailing `;`, and the line it starts on.
    Statement { sql: String, line: usize },
}

/// Streams statements and section markers from a table export, one at a
/// time, so memory doesn't grow with the file. Statements end at a `;`
/// outside quotes, so text values may hold `;`, quotes and line breaks.
/// Comment lines between statements are skipped; `-- @end` stops it.
pub struct TableSqlReader<R: BufRead> {
    reader: R,
    identifier_quote: char,
    backslash_escapes: bool,
    line_number: usize,
    finished: bool,
    /// What followed a `;` on the line a statement ended on.
    pending: String,
}

impl<R: BufRead> TableSqlReader<R> {
    pub fn new(reader: R, dialect: &DumpDialect) -> Self {
        Self {
            reader,
            identifier_quote: dialect.identifier_quote.chars().next().unwrap_or('"'),
            backslash_escapes: dialect.string_escape != LiteralStyle::Standard,
            line_number: 0,
            finished: false,
            pending: String::new(),
        }
    }

    pub fn next_item(&mut self) -> Result<Option<TableSqlItem>, String> {
        if self.finished {
            return Ok(None);
        }
        let mut statement = String::new();
        let mut start_line = 0;
        let mut state = QuoteState::None;
        let mut line = String::new();
        loop {
            line.clear();
            let read = if self.pending.is_empty() {
                let read = self
                    .reader
                    .read_line(&mut line)
                    .map_err(|error| error.to_string())?;
                if read > 0 {
                    self.line_number += 1;
                }
                read
            } else {
                line = std::mem::take(&mut self.pending);
                line.len()
            };
            if read == 0 {
                self.finished = true;
                let rest = statement.trim();
                if rest.is_empty() {
                    return Ok(None);
                }
                return Ok(Some(TableSqlItem::Statement {
                    sql: rest.to_string(),
                    line: start_line,
                }));
            }
            if statement.is_empty() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if trimmed == END_MARKER {
                    self.finished = true;
                    return Ok(None);
                }
                if let Some(name) = trimmed.strip_prefix(SECTION_PREFIX) {
                    return Ok(Some(TableSqlItem::Section(name.trim().to_string())));
                }
                if trimmed.starts_with("--") {
                    continue;
                }
                start_line = self.line_number;
            }
            let mut chars = line.char_indices().peekable();
            while let Some((index, ch)) = chars.next() {
                match state {
                    QuoteState::None => {
                        if ch == '\'' {
                            state = QuoteState::Literal;
                        } else if ch == self.identifier_quote {
                            state = QuoteState::Identifier;
                        } else if ch == ';' {
                            statement.push_str(&line[..index]);
                            let rest = &line[index + 1..];
                            if !rest.trim().is_empty() {
                                self.pending = rest.to_string();
                            }
                            return Ok(Some(TableSqlItem::Statement {
                                sql: statement.trim().to_string(),
                                line: start_line,
                            }));
                        }
                    }
                    QuoteState::Literal => {
                        if self.backslash_escapes && ch == '\\' {
                            chars.next();
                        } else if ch == '\'' {
                            if matches!(chars.peek(), Some((_, '\''))) {
                                chars.next();
                            } else {
                                state = QuoteState::None;
                            }
                        }
                    }
                    QuoteState::Identifier => {
                        if ch == self.identifier_quote {
                            if matches!(chars.peek(), Some((_, next)) if *next == self.identifier_quote)
                            {
                                chars.next();
                            } else {
                                state = QuoteState::None;
                            }
                        }
                    }
                }
            }
            statement.push_str(&line);
        }
    }
}

#[derive(Clone, Copy)]
enum QuoteState {
    None,
    Literal,
    Identifier,
}
