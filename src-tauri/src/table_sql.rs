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

use crate::drivers::sql_syntax::{LiteralStyle, QuoteEscape, QuoteKind, SqlSyntax};
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
            // Once the title is read, look at the next line before taking it:
            // the line that ends the header (a blank line, a section marker,
            // a statement) stays in the reader for the statement reader.
            if started && !next_line_is_header(reader)? {
                break;
            }
            let mut line = String::new();
            let read = std::io::Read::take(&mut *reader, MAX_HEADER_LINE_BYTES)
                .read_line(&mut line)
                .map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            let line_complete = line.ends_with('\n');
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
            if read as u64 == MAX_HEADER_LINE_BYTES && !line_complete {
                return Err(format!(
                    "The table export header has a line longer than {MAX_HEADER_LINE_BYTES} bytes"
                ));
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

/// Whether the next line in `reader` is a `-- Key: value` header line,
/// without consuming it.
fn next_line_is_header<R: BufRead>(reader: &mut R) -> Result<bool, String> {
    let buffer = reader.fill_buf().map_err(|error| error.to_string())?;
    let start = buffer
        .iter()
        .position(|byte| *byte != b' ' && *byte != b'\t')
        .unwrap_or(buffer.len());
    let line = &buffer[start..];
    Ok(line.starts_with(b"--") && !line.starts_with(b"-- @"))
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

/// Removes the source schema from a driver's DDL (`CREATE TABLE
/// "public"."orders"` becomes `CREATE TABLE "orders"`), so the file can be
/// imported into any schema. Every `<schema>.` qualifier the dialect would
/// write is removed, so references to other tables of the same schema (a
/// foreign key's `REFERENCES "public"."customers"`) resolve in the target
/// schema too. Text inside string literals and comments is left alone, and
/// DDL without the qualifier is returned unchanged.
pub fn unqualify_ddl(
    ddl: &str,
    dialect: &DumpDialect,
    rules: &SqlScanRules,
    schema: Option<&str>,
    table: &str,
) -> String {
    let qualified = dialect.table_ref(schema, table);
    let bare = dialect.quote_identifier(table);
    let Some(prefix) = qualified
        .strip_suffix(bare.as_str())
        .filter(|prefix| !prefix.is_empty())
    else {
        return ddl.to_string();
    };
    let mut out = String::with_capacity(ddl.len());
    let mut scanner = Scanner::new(rules);
    let mut at = 0;
    while at < ddl.len() {
        if scanner.in_code()
            && ddl[at..].starts_with(prefix)
            && !ddl[..at].ends_with('.')
            && !previous_is_word(ddl, at)
        {
            at += prefix.len();
            continue;
        }
        let (len, _) = scanner.step(ddl, at);
        out.push_str(&ddl[at..at + len]);
        at += len;
    }
    out
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
    rules: SqlScanRules,
    line_number: usize,
    finished: bool,
    /// What followed a `;` on the line a statement ended on.
    pending: String,
}

impl<R: BufRead> TableSqlReader<R> {
    pub fn new(reader: R, rules: SqlScanRules) -> Self {
        Self {
            reader,
            rules,
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
        let mut scanner = Scanner::new(&self.rules);
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
                if trimmed.starts_with("--")
                    || (self.rules.hash_comments && trimmed.starts_with('#'))
                {
                    continue;
                }
                start_line = self.line_number;
            }
            let mut at = 0;
            while at < line.len() {
                let (len, code) = scanner.step(&line, at);
                if code == Some(';') {
                    statement.push_str(&line[..at]);
                    let rest = &line[at + len..];
                    if !rest.trim().is_empty() {
                        self.pending = rest.to_string();
                    }
                    return Ok(Some(TableSqlItem::Statement {
                        sql: statement.trim().to_string(),
                        line: start_line,
                    }));
                }
                at += len;
            }
            statement.push_str(&line);
        }
    }
}

/// How a driver's SQL is lexed, enough to find where statements end and
/// which text is code: its quotes, comments and dollar quoting. Built from
/// the driver's resolved [`SqlSyntax`] and its dump dialect.
#[derive(Debug, Clone)]
pub struct SqlScanRules {
    quotes: Vec<ScanQuote>,
    triple_quoted_strings: bool,
    hash_comments: bool,
    line_comment_requires_space: bool,
    nested_block_comments: bool,
    dollar_quoting: bool,
    e_strings: bool,
}

#[derive(Debug, Clone)]
struct ScanQuote {
    open: String,
    close: String,
    string: bool,
    doubled: bool,
    backslash: bool,
}

impl SqlScanRules {
    pub fn new(syntax: &SqlSyntax, dialect: &DumpDialect) -> Self {
        // Literals the host renders with backslash escapes must read back
        // the same way, even where the quote rule itself only doubles.
        let backslash_literals = dialect.string_escape != LiteralStyle::Standard;
        let mut quotes = syntax
            .quotes
            .iter()
            .filter(|rule| !rule.open.is_empty() && !rule.close.is_empty())
            .map(|rule| {
                let string = rule.kind == QuoteKind::String;
                ScanQuote {
                    open: rule.open.clone(),
                    close: rule.close.clone(),
                    string,
                    doubled: matches!(rule.escape, QuoteEscape::Double | QuoteEscape::Both),
                    backslash: rule.escape.backslash()
                        || (string && rule.open == "'" && backslash_literals),
                }
            })
            .collect::<Vec<_>>();
        // The identifier quote the dump writes is always a quote, also for a
        // plugin whose syntax doesn't list it.
        let identifier = dialect.identifier_quote.clone();
        if !identifier.is_empty() && !quotes.iter().any(|quote| quote.open == identifier) {
            let close = if identifier == "[" {
                "]".to_string()
            } else {
                identifier.clone()
            };
            quotes.push(ScanQuote {
                open: identifier,
                close,
                string: false,
                doubled: true,
                backslash: false,
            });
        }
        // Longer openers first, so `$$`-like or multi-character quotes win.
        quotes.sort_by(|a, b| b.open.len().cmp(&a.open.len()));
        Self {
            quotes,
            triple_quoted_strings: syntax.triple_quoted_strings,
            hash_comments: syntax.hash_comments,
            line_comment_requires_space: syntax.line_comment_requires_space,
            nested_block_comments: syntax.nested_block_comments,
            dollar_quoting: syntax.dollar_quoting,
            e_strings: syntax.e_strings,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ScanState {
    Code,
    Quote {
        close: String,
        doubled: bool,
        backslash: bool,
    },
    LineComment,
    BlockComment(usize),
    DollarQuote(String),
}

/// Walks SQL text one token start at a time and keeps the lexer state
/// across calls, so it can be fed a file line by line.
struct Scanner<'a> {
    rules: &'a SqlScanRules,
    state: ScanState,
}

impl<'a> Scanner<'a> {
    fn new(rules: &'a SqlScanRules) -> Self {
        Self {
            rules,
            state: ScanState::Code,
        }
    }

    fn in_code(&self) -> bool {
        self.state == ScanState::Code
    }

    /// Reads from byte `at` of `text`. Returns how many bytes it read and,
    /// when they are a plain code character (not part of a quote or a
    /// comment), that character.
    fn step(&mut self, text: &str, at: usize) -> (usize, Option<char>) {
        let rest = &text[at..];
        let Some(ch) = rest.chars().next() else {
            return (0, None);
        };
        let len = ch.len_utf8();
        let rules = self.rules;
        match &mut self.state {
            ScanState::Code => {
                if rest.starts_with("--")
                    && (!rules.line_comment_requires_space
                        || rest[2..].chars().next().is_none_or(char::is_whitespace))
                {
                    self.state = ScanState::LineComment;
                    return (2, None);
                }
                if rules.hash_comments && ch == '#' {
                    self.state = ScanState::LineComment;
                    return (1, None);
                }
                if rest.starts_with("/*") {
                    self.state = ScanState::BlockComment(1);
                    return (2, None);
                }
                if rules.dollar_quoting && ch == '$' && !previous_is_word(text, at) {
                    if let Some(tag) = dollar_tag(rest) {
                        let tag_len = tag.len();
                        self.state = ScanState::DollarQuote(tag.to_string());
                        return (tag_len, None);
                    }
                }
                for quote in &rules.quotes {
                    if rules.triple_quoted_strings && quote.string {
                        let triple = quote.open.repeat(3);
                        if rest.starts_with(&triple) {
                            self.state = ScanState::Quote {
                                close: quote.close.repeat(3),
                                doubled: false,
                                backslash: quote.backslash,
                            };
                            return (triple.len(), None);
                        }
                    }
                    if rest.starts_with(&quote.open) {
                        let escape_string = rules.e_strings
                            && quote.string
                            && quote.open == "'"
                            && (text[..at].ends_with('e') || text[..at].ends_with('E'))
                            && !previous_is_word(text, at - 1);
                        self.state = ScanState::Quote {
                            close: quote.close.clone(),
                            doubled: quote.doubled,
                            backslash: quote.backslash || escape_string,
                        };
                        return (quote.open.len(), None);
                    }
                }
                (len, Some(ch))
            }
            ScanState::Quote {
                close,
                doubled,
                backslash,
            } => {
                if *backslash && ch == '\\' {
                    let escaped = rest[1..].chars().next().map_or(0, char::len_utf8);
                    return (1 + escaped, None);
                }
                if rest.starts_with(close.as_str()) {
                    let close_len = close.len();
                    if *doubled && rest[close_len..].starts_with(close.as_str()) {
                        return (close_len * 2, None);
                    }
                    self.state = ScanState::Code;
                    return (close_len, None);
                }
                (len, None)
            }
            ScanState::LineComment => {
                if ch == '\n' {
                    self.state = ScanState::Code;
                }
                (len, None)
            }
            ScanState::BlockComment(depth) => {
                if rules.nested_block_comments && rest.starts_with("/*") {
                    *depth += 1;
                    return (2, None);
                }
                if rest.starts_with("*/") {
                    *depth -= 1;
                    if *depth == 0 {
                        self.state = ScanState::Code;
                    }
                    return (2, None);
                }
                (len, None)
            }
            ScanState::DollarQuote(tag) => {
                if rest.starts_with(tag.as_str()) {
                    let tag_len = tag.len();
                    self.state = ScanState::Code;
                    return (tag_len, None);
                }
                (len, None)
            }
        }
    }
}

/// Whether the character before byte `at` is part of a word, so a `$` or
/// a qualifier there doesn't start a token.
fn previous_is_word(text: &str, at: usize) -> bool {
    text[..at]
        .chars()
        .next_back()
        .is_some_and(|ch| ch.is_alphanumeric() || ch == '_' || ch == '$')
}

/// The `$tag$` opening a PostgreSQL dollar quote at the start of `text`.
fn dollar_tag(text: &str) -> Option<&str> {
    let mut chars = text.char_indices().skip(1);
    for (index, ch) in chars.by_ref() {
        if ch == '$' {
            return Some(&text[..index + 1]);
        }
        let valid = ch.is_alphabetic() || ch == '_' || (index > 1 && ch.is_ascii_digit());
        if !valid {
            return None;
        }
    }
    None
}
