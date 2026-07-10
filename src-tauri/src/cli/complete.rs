//! Tab completion for the interactive shell.
//!
//! Candidates come from three sources: the shell's meta commands, a static
//! SQL keyword list, and a catalog of table/column names. The catalog is
//! loaded by a background task ([`spawn_catalog_refresh`]) so the prompt
//! never waits on metadata queries — completion simply gets richer as
//! results land.

use crate::drivers::driver_trait::DatabaseDriver;
use crate::models::ConnectionParams;
use rustyline::completion::{Completer, Pair};
use rustyline::highlight::Highlighter;
use rustyline::hint::Hinter;
use rustyline::validate::Validator;
use rustyline::{Context, Helper};
use std::collections::BTreeMap;
use std::sync::{Arc, RwLock};

/// Table and column names known for the current database/schema.
#[derive(Default)]
pub struct Catalog {
    pub tables: Vec<String>,
    /// Table name -> its column names.
    pub columns: BTreeMap<String, Vec<String>>,
}

/// How many tables get their columns prefetched. Keeps the background
/// refresh cheap on very large schemas; tables beyond the cap still complete
/// by name, just without their columns.
const COLUMN_PREFETCH_CAP: usize = 200;

const SQL_KEYWORDS: &[&str] = &[
    "ALTER", "AND", "AS", "ASC", "BEGIN", "BETWEEN", "BY", "CASE", "COMMIT", "COUNT", "CREATE",
    "CROSS", "DELETE", "DESC", "DISTINCT", "DROP", "ELSE", "END", "EXISTS", "EXPLAIN", "FROM",
    "FULL", "GROUP", "HAVING", "IN", "INDEX", "INNER", "INSERT", "INTO", "IS", "JOIN", "LEFT",
    "LIKE", "LIMIT", "NOT", "NULL", "OFFSET", "ON", "OR", "ORDER", "OUTER", "PRIMARY", "RIGHT",
    "ROLLBACK", "SELECT", "SET", "TABLE", "THEN", "TRUNCATE", "UNION", "UPDATE", "VALUES", "VIEW",
    "WHEN", "WHERE",
];

const META_COMMANDS: &[&str] = &[
    "\\q", "\\?", "\\use", "\\l", "\\dn", "\\dt", "\\d", "\\f", "\\limit", "\\schema", "\\x",
    "\\i", "\\pager",
];

const FORMATS: &[&str] = &["table", "expanded", "json", "csv"];

/// Byte offset where the word being completed starts: scan back from `pos`
/// to the previous token boundary (whitespace, punctuation, `.` of a
/// qualified name).
pub fn completion_start(line: &str, pos: usize) -> usize {
    line[..pos]
        .char_indices()
        .rev()
        .find(|(_, c)| {
            c.is_whitespace()
                || matches!(
                    c,
                    '(' | ')' | ',' | ';' | '=' | '<' | '>' | '+' | '*' | '/' | '.'
                )
        })
        .map(|(i, c)| i + c.len_utf8())
        .unwrap_or(0)
}

/// Compute the candidates for `word`, the token under the cursor in `line`.
pub fn candidates(line: &str, word: &str, catalog: &Catalog) -> Vec<String> {
    if line.starts_with('\\') {
        return meta_candidates(line, word, catalog);
    }
    if word.is_empty() {
        // A bare Tab would dump every keyword/table; stay quiet instead.
        return Vec::new();
    }

    let lower = word.to_lowercase();
    let mut out: Vec<String> = SQL_KEYWORDS
        .iter()
        .filter(|kw| kw.to_lowercase().starts_with(&lower))
        .map(|kw| match_case(kw, word))
        .collect();
    out.extend(
        catalog
            .tables
            .iter()
            .filter(|t| t.to_lowercase().starts_with(&lower))
            .cloned(),
    );
    let mut columns: Vec<String> = catalog
        .columns
        .values()
        .flatten()
        .filter(|c| c.to_lowercase().starts_with(&lower))
        .cloned()
        .collect();
    columns.sort();
    out.extend(columns);
    out.dedup();
    out
}

fn meta_candidates(line: &str, word: &str, catalog: &Catalog) -> Vec<String> {
    // Still typing the command itself.
    if word.starts_with('\\') {
        return META_COMMANDS
            .iter()
            .filter(|m| m.starts_with(word))
            .map(|m| m.to_string())
            .collect();
    }
    // Typing an argument: complete by command.
    let lower = word.to_lowercase();
    match line.split_whitespace().next().unwrap_or("") {
        "\\d" => catalog
            .tables
            .iter()
            .filter(|t| t.to_lowercase().starts_with(&lower))
            .cloned()
            .collect(),
        "\\f" => FORMATS
            .iter()
            .filter(|f| f.starts_with(&lower))
            .map(|f| f.to_string())
            .collect(),
        "\\pager" => ["on", "off"]
            .iter()
            .filter(|v| v.starts_with(&lower))
            .map(|v| v.to_string())
            .collect(),
        _ => Vec::new(),
    }
}

/// Render a keyword in the case the user is typing: an all-lowercase prefix
/// completes to lowercase, anything else to the canonical uppercase.
fn match_case(keyword: &str, word: &str) -> String {
    if word.chars().all(|c| !c.is_uppercase()) {
        keyword.to_lowercase()
    } else {
        keyword.to_string()
    }
}

/// rustyline helper wiring [`candidates`] into line editing.
pub struct ShellHelper {
    pub catalog: Arc<RwLock<Catalog>>,
}

impl Completer for ShellHelper {
    type Candidate = Pair;

    fn complete(
        &self,
        line: &str,
        pos: usize,
        _ctx: &Context<'_>,
    ) -> rustyline::Result<(usize, Vec<Pair>)> {
        let start = completion_start(line, pos);
        let word = &line[start..pos];
        let catalog = self.catalog.read().unwrap_or_else(|e| e.into_inner());
        let pairs = candidates(line, word, &catalog)
            .into_iter()
            .map(|c| Pair {
                display: c.clone(),
                replacement: c,
            })
            .collect();
        Ok((start, pairs))
    }
}

impl Hinter for ShellHelper {
    type Hint = String;
}

impl Highlighter for ShellHelper {}
impl Validator for ShellHelper {}
impl Helper for ShellHelper {}

/// Reload the catalog in the background. The shell's readline blocks its own
/// thread, so this runs on the runtime's other workers and fills `catalog`
/// while the user types. Errors only degrade completion and are logged at
/// debug level.
pub fn spawn_catalog_refresh(
    catalog: Arc<RwLock<Catalog>>,
    driver: Arc<dyn DatabaseDriver>,
    params: ConnectionParams,
    schema: Option<String>,
) {
    tokio::spawn(async move {
        let tables = match driver.get_tables(&params, schema.as_deref()).await {
            Ok(tables) => tables,
            Err(e) => {
                log::debug!("Completion catalog: get_tables failed: {}", e);
                return;
            }
        };
        let names: Vec<String> = tables.into_iter().map(|t| t.name).collect();
        {
            let mut cat = catalog.write().unwrap_or_else(|e| e.into_inner());
            cat.tables = names.clone();
            cat.columns.clear();
        }
        for table in names.iter().take(COLUMN_PREFETCH_CAP) {
            match driver.get_columns(&params, table, schema.as_deref()).await {
                Ok(columns) => {
                    let cols: Vec<String> = columns.into_iter().map(|c| c.name).collect();
                    let mut cat = catalog.write().unwrap_or_else(|e| e.into_inner());
                    cat.columns.insert(table.clone(), cols);
                }
                Err(e) => log::debug!("Completion catalog: columns for {} failed: {}", table, e),
            }
        }
    });
}
