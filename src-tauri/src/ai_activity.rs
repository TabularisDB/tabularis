//! AI Activity audit log.
//!
//! Records every MCP tool call to a JSON Lines file. The MCP subprocess is
//! the only writer; the main Tauri app is the reader. No IPC required —
//! both processes touch the same files.
//!
//! Storage layout under the application config directory:
//!   - `ai_activity.jsonl` — active log (append-only, one event per line)
//!   - `ai_activity.{1..5}.jsonl` — rotated archives (1 = most recent)
//!   - `.mcp_session_state.json` — current session id + last activity timestamp

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use crate::drivers::driver_trait::SqlDialect;
use crate::paths::get_app_config_dir;

const ACTIVITY_FILENAME: &str = "ai_activity.jsonl";
const SESSION_STATE_FILENAME: &str = ".mcp_session_state.json";
const MAX_ROTATED_FILES: usize = 5;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiActivityEvent {
    pub id: String,
    pub session_id: String,
    pub timestamp: String,
    pub tool: String,
    pub connection_id: Option<String>,
    pub connection_name: Option<String>,
    /// Database the call targeted, when the caller picked one on a connection
    /// with several databases selected. Absent in events from older builds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    pub query: Option<String>,
    pub query_kind: Option<String>,
    pub duration_ms: u64,
    pub status: String,
    pub rows: Option<usize>,
    pub error: Option<String>,
    pub client_hint: Option<String>,
    pub approval_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub session_id: String,
    pub started_at: String,
    pub ended_at: String,
    pub event_count: usize,
    pub run_query_count: usize,
    pub connection_names: Vec<String>,
    pub client_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EventFilter {
    pub session_id: Option<String>,
    pub connection_id: Option<String>,
    pub tool: Option<String>,
    pub status: Option<String>,
    pub query_contains: Option<String>,
    pub since: Option<String>,
    pub until: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    pub session_id: String,
    pub last_activity_at: String,
    pub client_hint: Option<String>,
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

fn activity_path_in(dir: &Path) -> PathBuf {
    dir.join(ACTIVITY_FILENAME)
}

fn rotated_path_in(dir: &Path, index: usize) -> PathBuf {
    dir.join(format!("ai_activity.{}.jsonl", index))
}

fn session_state_path_in(dir: &Path) -> PathBuf {
    dir.join(SESSION_STATE_FILENAME)
}

fn ensure_dir(dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Append + rotation (testable; take a directory)
// ---------------------------------------------------------------------------

pub fn append_event_in(dir: &Path, event: &AiActivityEvent) -> Result<(), String> {
    ensure_dir(dir)?;
    let path = activity_path_in(dir);
    let line = serde_json::to_string(event).map_err(|e| e.to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{}", line).map_err(|e| e.to_string())
}

fn count_lines(path: &Path) -> Result<usize, String> {
    if !path.exists() {
        return Ok(0);
    }
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    Ok(reader.lines().count())
}

pub fn rotate_if_needed_in(dir: &Path, max_entries: usize) -> Result<bool, String> {
    if max_entries == 0 {
        return Ok(false);
    }
    let active = activity_path_in(dir);
    if count_lines(&active)? < max_entries {
        return Ok(false);
    }
    // Drop the oldest, then shift each archived file by one.
    for i in (1..=MAX_ROTATED_FILES).rev() {
        let src = rotated_path_in(dir, i);
        if i == MAX_ROTATED_FILES {
            if src.exists() {
                fs::remove_file(&src).map_err(|e| e.to_string())?;
            }
        } else if src.exists() {
            let dst = rotated_path_in(dir, i + 1);
            fs::rename(&src, &dst).map_err(|e| e.to_string())?;
        }
    }
    if active.exists() {
        let dst = rotated_path_in(dir, 1);
        fs::rename(&active, &dst).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

pub fn append_and_rotate_in(
    dir: &Path,
    event: &AiActivityEvent,
    max_entries: usize,
) -> Result<(), String> {
    append_event_in(dir, event)?;
    if max_entries > 0 {
        rotate_if_needed_in(dir, max_entries)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Read + filter
// ---------------------------------------------------------------------------

fn read_all_events_in(dir: &Path) -> Result<Vec<AiActivityEvent>, String> {
    let mut paths: Vec<PathBuf> = Vec::new();
    // Oldest archive first → newest archive → active. Within each file events
    // are already in chronological order.
    for i in (1..=MAX_ROTATED_FILES).rev() {
        let p = rotated_path_in(dir, i);
        if p.exists() {
            paths.push(p);
        }
    }
    let active = activity_path_in(dir);
    if active.exists() {
        paths.push(active);
    }

    let mut events: Vec<AiActivityEvent> = Vec::new();
    for p in paths {
        let file = fs::File::open(&p).map_err(|e| e.to_string())?;
        let reader = BufReader::new(file);
        for line in reader.lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => continue,
            };
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            match serde_json::from_str::<AiActivityEvent>(trimmed) {
                Ok(ev) => events.push(ev),
                Err(_) => {
                    log::warn!("Skipping unparsable ai_activity entry");
                }
            }
        }
    }
    Ok(events)
}

pub fn read_events_in(dir: &Path, filter: &EventFilter) -> Result<Vec<AiActivityEvent>, String> {
    let events = read_all_events_in(dir)?;
    Ok(events
        .into_iter()
        .filter(|e| matches_filter(e, filter))
        .collect())
}

pub fn read_session_events_in(
    dir: &Path,
    session_id: &str,
) -> Result<Vec<AiActivityEvent>, String> {
    let mut events = read_all_events_in(dir)?;
    events.retain(|e| e.session_id == session_id);
    events.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    Ok(events)
}

pub fn read_sessions_in(dir: &Path) -> Result<Vec<SessionSummary>, String> {
    let events = read_all_events_in(dir)?;
    let mut by_session: BTreeMap<String, Vec<AiActivityEvent>> = BTreeMap::new();
    for e in events {
        by_session.entry(e.session_id.clone()).or_default().push(e);
    }
    let mut summaries: Vec<SessionSummary> = by_session
        .into_iter()
        .map(|(sid, evs)| build_summary(&sid, &evs))
        .collect();
    summaries.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(summaries)
}

pub fn clear_in(dir: &Path) -> Result<(), String> {
    let active = activity_path_in(dir);
    if active.exists() {
        fs::remove_file(&active).map_err(|e| e.to_string())?;
    }
    for i in 1..=MAX_ROTATED_FILES {
        let p = rotated_path_in(dir, i);
        if p.exists() {
            fs::remove_file(&p).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn matches_filter(e: &AiActivityEvent, f: &EventFilter) -> bool {
    if let Some(s) = &f.session_id {
        if e.session_id != *s {
            return false;
        }
    }
    if let Some(c) = &f.connection_id {
        if e.connection_id.as_deref() != Some(c.as_str()) {
            return false;
        }
    }
    if let Some(t) = &f.tool {
        if e.tool != *t {
            return false;
        }
    }
    if let Some(s) = &f.status {
        if e.status != *s {
            return false;
        }
    }
    if let Some(q) = &f.query_contains {
        let needle = q.to_lowercase();
        match &e.query {
            Some(query) if query.to_lowercase().contains(&needle) => {}
            _ => return false,
        }
    }
    if let Some(since) = &f.since {
        if e.timestamp < *since {
            return false;
        }
    }
    if let Some(until) = &f.until {
        if e.timestamp > *until {
            return false;
        }
    }
    true
}

fn build_summary(session_id: &str, events: &[AiActivityEvent]) -> SessionSummary {
    let started_at = events
        .iter()
        .map(|e| e.timestamp.clone())
        .min()
        .unwrap_or_default();
    let ended_at = events
        .iter()
        .map(|e| e.timestamp.clone())
        .max()
        .unwrap_or_default();
    let run_query_count = events.iter().filter(|e| e.tool == "run_query").count();
    let mut names = HashSet::new();
    for e in events {
        if let Some(n) = &e.connection_name {
            names.insert(n.clone());
        }
    }
    let mut connection_names: Vec<String> = names.into_iter().collect();
    connection_names.sort();
    let client_hint = events.iter().find_map(|e| e.client_hint.clone());
    SessionSummary {
        session_id: session_id.to_string(),
        started_at,
        ended_at,
        event_count: events.len(),
        run_query_count,
        connection_names,
        client_hint,
    }
}

// ---------------------------------------------------------------------------
// Public default-dir wrappers (used at runtime)
// ---------------------------------------------------------------------------

pub fn append_and_rotate(event: &AiActivityEvent, max_entries: usize) -> Result<(), String> {
    append_and_rotate_in(&get_app_config_dir(), event, max_entries)
}

pub fn read_events(filter: &EventFilter) -> Result<Vec<AiActivityEvent>, String> {
    read_events_in(&get_app_config_dir(), filter)
}

pub fn read_sessions() -> Result<Vec<SessionSummary>, String> {
    read_sessions_in(&get_app_config_dir())
}

pub fn read_session_events(session_id: &str) -> Result<Vec<AiActivityEvent>, String> {
    read_session_events_in(&get_app_config_dir(), session_id)
}

pub fn clear() -> Result<(), String> {
    clear_in(&get_app_config_dir())
}

// ---------------------------------------------------------------------------
// SQL classification
// ---------------------------------------------------------------------------

/// Classify the kind of SQL: `"select"`, `"write"`, `"ddl"`, or `"unknown"`.
///
/// Conservative on purpose: any input we cannot confidently identify as a
/// read returns `"unknown"`, so callers can fail closed when enforcing
/// safety policies (read-only mode, approval gates).
///
/// The dialect is not known here, so the statement is lexed under every
/// dialect's rules (see [`classify_query_kind_for_dialect`]). Callers that
/// know the connection's `sql_dialect` should use that function instead: it
/// is just as strict for that dialect and avoids false positives caused by
/// syntax that only another dialect would read differently.
pub fn classify_query_kind(sql: &str) -> &'static str {
    classify_query_kind_for_dialect(sql, None)
}

/// Classify `sql` as [`classify_query_kind`] does, for a connection whose
/// driver declares `dialect` (its `sql_dialect` capability).
///
/// Where a string literal, quoted identifier or comment ends depends on the
/// dialect (and, for MySQL, on server modes such as `NO_BACKSLASH_ESCAPES`
/// and `ANSI_QUOTES`). A payload can exploit any disagreement between how
/// this classifier and the server tokenize it to hide a `;` and a second
/// statement — e.g. `SELECT 1 # '` + newline + `; DROP TABLE t` on MySQL,
/// where `#` starts a comment. So the statement is lexed once per plausible
/// tokenization of the dialect ([`lex_profiles_for`]) and classified under
/// each; it is a read only if EVERY pass sees exactly one read statement.
/// Any pass that sees a write, DDL, an unrecognised statement or a second
/// statement wins, which also covers passes disagreeing on the statement
/// count. `None`, `Generic`, `Oracle` and any dialect without a dedicated
/// profile set are lexed under all profiles.
pub fn classify_query_kind_for_dialect(sql: &str, dialect: Option<SqlDialect>) -> &'static str {
    for profile in lex_profiles_for(dialect) {
        let kind = classify_with_profile(sql, profile);
        if kind != "select" {
            return kind;
        }
    }
    "select"
}

/// Whether `sql` holds more than one statement under any tokenization
/// plausible for `dialect` (`None` = every known dialect). Fails closed: a
/// `;` that only one dialect sees as a separator still counts.
pub(crate) fn has_multiple_statements(sql: &str, dialect: Option<SqlDialect>) -> bool {
    lex_profiles_for(dialect)
        .iter()
        .any(|profile| has_trailing_statements(&strip_with_profile(sql, profile, false)))
}

/// Classify `sql` as tokenized by a single lexer profile.
fn classify_with_profile(sql: &str, profile: &LexProfile) -> &'static str {
    let stripped = strip_with_profile(sql, profile, false);
    let trimmed = stripped.trim_start();
    if trimmed.is_empty() {
        return "unknown";
    }
    let trimmed_upper = trimmed.to_uppercase();

    if is_create_compound_routine(&trimmed_upper) {
        return "ddl";
    }

    // Fail closed for multi-statement payloads: a leading `SELECT 1; DROP …`
    // must NOT be tagged as a clean read just because the first keyword is
    // SELECT — the read-only and approval gates rely on this classification.
    // Dialect disagreements over where a literal or comment ends are handled
    // by running this once per profile, see `classify_query_kind_for_dialect`.
    if has_trailing_statements(&stripped) {
        return "unknown";
    }
    // Peel any leading `(` (and surrounding whitespace) before reading the
    // first keyword. A parenthesized query expression such as
    // `(SELECT ...) UNION ALL (SELECT ...)` — the shape you get when each
    // UNION branch needs its own ORDER BY / LIMIT — starts with `(`, so the
    // first keyword would otherwise come back empty and fall through to
    // "unknown", needlessly tripping the read-only and approval gates for a
    // pure read. Multi-statement payloads are already rejected above, so the
    // inner leading keyword is a safe basis for classification.
    let peeled_upper = trimmed
        .trim_start_matches(|c: char| c == '(' || c.is_whitespace())
        .to_uppercase();
    let first = first_keyword(&peeled_upper);

    let kind = match first.as_str() {
        // EXPLAIN needs option-aware handling: plain EXPLAIN only plans, but
        // EXPLAIN ANALYZE (and EXPLAIN (ANALYZE ...)) *executes* the wrapped
        // statement. Classifying it blindly as a read would let
        // `EXPLAIN ANALYZE DELETE …` run past read-only mode and the approval
        // gate. See `classify_explain`.
        "EXPLAIN" => classify_explain(&peeled_upper),
        // A leading SELECT is not proof of a read: `SELECT … INTO` creates a
        // table (PostgreSQL) or writes a file (MySQL `INTO OUTFILE`), locking
        // clauses take row locks, and some functions act on the server.
        "SELECT" | "VALUES" => classify_select_side_effects(&peeled_upper),
        // `PRAGMA x = …` and `PRAGMA x(…)` change database settings (SQLite).
        "PRAGMA" => classify_pragma(&peeled_upper),
        "SHOW" | "DESCRIBE" | "DESC" => "select",
        "INSERT" | "UPDATE" | "DELETE" | "MERGE" | "REPLACE" => "write",
        "CREATE" | "DROP" | "ALTER" | "TRUNCATE" | "RENAME" | "GRANT" | "REVOKE" | "COMMENT" => {
            "ddl"
        }
        "WITH" => classify_cte(&peeled_upper),
        _ => "unknown",
    };

    // A statement classified as a clean read must not reach a side-effecting
    // function through a quoted name, which the denylist (matching bare names)
    // would miss. Fail closed: the engine read-only backstop does not stop
    // every such function (e.g. `lo_export` writes a file even inside a
    // read-only transaction), so the classifier is the last line of defence.
    if kind == "select" && has_quoted_function_call(sql, profile) {
        return "unknown";
    }
    kind
}

fn is_create_compound_routine(upper_sql: &str) -> bool {
    if first_keyword(upper_sql) != "CREATE" {
        return false;
    }

    let header = upper_sql.split("BEGIN").next().unwrap_or(upper_sql);
    let is_routine = ["PROCEDURE", "FUNCTION", "TRIGGER", "EVENT"]
        .iter()
        .any(|keyword| contains_keyword(header, keyword));
    if !is_routine {
        return false;
    }

    let without_terminal_semicolon = upper_sql.trim_end().trim_end_matches(';').trim_end();
    if !without_terminal_semicolon.ends_with("END") {
        return false;
    }

    !has_complete_end_before_terminal_statement(without_terminal_semicolon)
}

fn has_complete_end_before_terminal_statement(upper_sql: &str) -> bool {
    let terminal_end = match upper_sql.rfind("END") {
        Some(index) => index,
        None => return false,
    };
    let before_terminal = &upper_sql[..terminal_end];
    let bytes = before_terminal.as_bytes();
    let is_word = |b: u8| b.is_ascii_alphanumeric() || b == b'_';

    for i in 0..bytes.len().saturating_sub(2) {
        if &bytes[i..i + 3] != b"END" {
            continue;
        }
        let prev_ok = i == 0 || !is_word(bytes[i - 1]);
        let next_ok = i + 3 == bytes.len() || !is_word(bytes[i + 3]);
        if !prev_ok || !next_ok {
            continue;
        }

        let mut cursor = i + 3;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() || bytes[cursor] != b';' {
            continue;
        }
        cursor += 1;
        while cursor < bytes.len()
            && (bytes[cursor].is_ascii_whitespace() || bytes[cursor] == b';')
        {
            cursor += 1;
        }
        if cursor < bytes.len() && bytes[cursor].is_ascii_alphabetic() {
            return true;
        }
    }

    false
}

/// Returns true when `stripped` contains a semicolon followed by additional
/// non-whitespace SQL content — i.e., more than one statement.
///
/// The input must already have been run through `strip_impl`, which replaces
/// string-literal, comment, and quoted-identifier bytes with whitespace, so
/// any `;` that survives here is a real statement terminator under the
/// escaping interpretation used to produce `stripped`.
pub(crate) fn has_trailing_statements(stripped: &str) -> bool {
    let mut found_semi = false;
    for c in stripped.chars() {
        if found_semi && !c.is_whitespace() {
            return true;
        }
        if c == ';' {
            found_semi = true;
        }
    }
    false
}

fn first_keyword(upper: &str) -> String {
    upper
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect()
}

fn classify_cte(stripped_upper: &str) -> &'static str {
    let ddl = ["CREATE", "DROP", "ALTER", "TRUNCATE", "RENAME"];
    let dml = ["INSERT", "UPDATE", "DELETE", "MERGE", "REPLACE"];
    for kw in &ddl {
        if contains_keyword(stripped_upper, kw) {
            return "ddl";
        }
    }
    for kw in &dml {
        if contains_keyword(stripped_upper, kw) {
            return "write";
        }
    }
    classify_select_side_effects(stripped_upper)
}

/// PostgreSQL functions that act outside the current transaction (signal
/// other sessions, reload config, touch server files, open a second
/// connection). A read-only transaction does not stop them, so a query that
/// calls one is never a clean read.
const SIDE_EFFECT_FUNCTIONS: &[&str] = &[
    "PG_TERMINATE_BACKEND",
    "PG_CANCEL_BACKEND",
    "PG_RELOAD_CONF",
    "PG_ROTATE_LOGFILE",
    "PG_SWITCH_WAL",
    "PG_PROMOTE",
    "PG_CREATE_RESTORE_POINT",
    "PG_LOG_BACKEND_MEMORY_CONTEXTS",
    "LO_IMPORT",
    "LO_EXPORT",
    "LO_UNLINK",
    "LO_CREATE",
    "LO_CREAT",
    "LO_PUT",
    "LO_FROM_BYTEA",
    "LO_TRUNCATE",
    "LOWRITE",
    "DBLINK",
    "DBLINK_EXEC",
    "DBLINK_CONNECT",
    "DBLINK_CONNECT_U",
    "DBLINK_SEND_QUERY",
    "SETVAL",
    "NEXTVAL",
];

/// Classify a statement that reads like a query (`SELECT …`, `VALUES …`, or
/// the final statement of a CTE) by looking for clauses that make it write.
///
/// `stripped_upper` must have string literals, quoted identifiers and
/// comments removed, so a column alias or literal cannot trigger a match.
fn classify_select_side_effects(stripped_upper: &str) -> &'static str {
    // `SELECT … INTO new_table` (PostgreSQL), `INTO OUTFILE` / `INTO DUMPFILE`
    // (MySQL). `INSERT … SELECT` never gets here: it starts with INSERT.
    if contains_keyword(stripped_upper, "INTO") {
        return "write";
    }
    let words: Vec<&str> = stripped_upper
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .filter(|w| !w.is_empty())
        .collect();
    let has_locking_clause = words
        .windows(2)
        .any(|pair| pair[0] == "FOR" && matches!(pair[1], "UPDATE" | "SHARE" | "NO" | "KEY"))
        || words
            .windows(4)
            .any(|w| w == ["LOCK", "IN", "SHARE", "MODE"]);
    if has_locking_clause {
        return "write";
    }
    if SIDE_EFFECT_FUNCTIONS
        .iter()
        .any(|name| calls_function(stripped_upper, name))
    {
        return "write";
    }
    "select"
}

/// Whether `haystack` contains a call to `name`: the whole word followed,
/// after optional whitespace, by `(`.
fn calls_function(haystack: &str, name: &str) -> bool {
    let mut offset = 0;
    while let Some(index) = keyword_index(&haystack[offset..], name) {
        let after = &haystack[offset + index + name.len()..];
        if after.trim_start().starts_with('(') {
            return true;
        }
        offset += index + name.len();
    }
    false
}

/// SQLite pragmas that only report information, even when given an argument
/// (`PRAGMA table_info(t)`). Any other pragma called with an argument sets a
/// value.
const INTROSPECTION_PRAGMAS: &[&str] = &[
    "TABLE_INFO",
    "TABLE_XINFO",
    "TABLE_LIST",
    "INDEX_LIST",
    "INDEX_INFO",
    "INDEX_XINFO",
    "FOREIGN_KEY_LIST",
    "FOREIGN_KEY_CHECK",
    "INTEGRITY_CHECK",
    "QUICK_CHECK",
];

/// SQLite pragmas that do work even without an argument.
const ACTION_PRAGMAS: &[&str] = &[
    "OPTIMIZE",
    "WAL_CHECKPOINT",
    "INCREMENTAL_VACUUM",
    "SHRINK_MEMORY",
];

/// Classify a `PRAGMA` statement. Reading a pragma (`PRAGMA user_version`) or
/// calling an introspection pragma (`PRAGMA table_info(t)`) is a read;
/// assigning one (`PRAGMA user_version = 42`), passing a value to any other
/// pragma (`PRAGMA journal_mode(DELETE)`) or running an action pragma
/// (`PRAGMA optimize`) is a write.
///
/// `pragma_upper` must be the stripped, upper-cased SQL whose first keyword
/// is `PRAGMA`.
fn classify_pragma(pragma_upper: &str) -> &'static str {
    let body = pragma_upper["PRAGMA".len()..].trim();
    let body = body.trim_end_matches(';').trim_end();
    if body.contains('=') {
        return "write";
    }
    // Drop an optional `schema.` prefix.
    let name_part = body.split('(').next().unwrap_or("").trim();
    let name = name_part.rsplit('.').next().unwrap_or("").trim();
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return "unknown";
    }
    if ACTION_PRAGMAS.contains(&name) {
        return "write";
    }
    if body.contains('(') && !INTROSPECTION_PRAGMAS.contains(&name) {
        return "write";
    }
    "select"
}

fn contains_keyword(haystack: &str, needle: &str) -> bool {
    keyword_index(haystack, needle).is_some()
}

/// Byte offset of the first whole-word occurrence of `needle` in `haystack`,
/// or `None`. "Whole word" means the match is not flanked by an identifier
/// byte on either side, so `ANALYZE` does not match inside `analyze_runs`.
fn keyword_index(haystack: &str, needle: &str) -> Option<usize> {
    let bytes = haystack.as_bytes();
    let nbytes = needle.as_bytes();
    let nlen = nbytes.len();
    if nlen == 0 || bytes.len() < nlen {
        return None;
    }
    let is_word = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
    for i in 0..=bytes.len() - nlen {
        if &bytes[i..i + nlen] == nbytes {
            let prev_ok = i == 0 || !is_word(bytes[i - 1]);
            let next_ok = i + nlen == bytes.len() || !is_word(bytes[i + nlen]);
            if prev_ok && next_ok {
                return Some(i);
            }
        }
    }
    None
}

/// Classify an `EXPLAIN …` statement, whose kind depends on its options.
///
/// A plain `EXPLAIN` only produces a plan and never touches data, so it is a
/// read. But `EXPLAIN ANALYZE …` (legacy syntax) and `EXPLAIN (ANALYZE …) …`
/// (parenthesized options) *run* the wrapped statement to gather actual timing
/// — so an `ANALYZE` option makes the whole thing as dangerous as the wrapped
/// statement itself. We therefore detect an `ANALYZE` option and, when present,
/// classify the wrapped statement (`write`/`ddl`/`unknown`) instead of `select`.
///
/// `explain_upper` must be the stripped, upper-cased SQL whose first keyword is
/// `EXPLAIN`.
fn classify_explain(explain_upper: &str) -> &'static str {
    let after = explain_upper["EXPLAIN".len()..].trim_start();
    let (options, wrapped) = split_explain_options(after);

    // Only ANALYZE causes execution; every other option (VERBOSE, BUFFERS,
    // FORMAT …, SQLite's QUERY PLAN, MySQL's FORMAT=JSON) is plan-only.
    if !contains_keyword(options, "ANALYZE") {
        return "select";
    }
    classify_wrapped_statement(wrapped)
}

/// Split the text following `EXPLAIN` into `(options, wrapped_statement)`.
///
/// Handles both the parenthesized form `(ANALYZE, BUFFERS) SELECT …` and the
/// bare form `ANALYZE VERBOSE SELECT …`. For the bare form the option list runs
/// up to the wrapped statement's first keyword. Fails closed (everything is
/// "options", wrapped is empty) when a leading `(` is never closed.
fn split_explain_options(after: &str) -> (&str, &str) {
    if after.starts_with('(') {
        let bytes = after.as_bytes();
        let mut depth = 0usize;
        for (i, &b) in bytes.iter().enumerate() {
            match b {
                b'(' => depth += 1,
                b')' => {
                    depth -= 1;
                    if depth == 0 {
                        return (&after[1..i], after[i + 1..].trim_start());
                    }
                }
                _ => {}
            }
        }
        return (after, "");
    }
    match first_wrapped_statement_index(after) {
        Some(idx) => (&after[..idx], &after[idx..]),
        None => (after, ""),
    }
}

/// Byte offset of the earliest statement keyword that could begin the target of
/// an `EXPLAIN`, used to find where a bare option list ends.
fn first_wrapped_statement_index(upper: &str) -> Option<usize> {
    const KEYWORDS: &[&str] = &[
        "SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "REPLACE", "VALUES", "TABLE", "WITH",
        "CREATE", "DROP", "ALTER", "TRUNCATE", "RENAME",
    ];
    KEYWORDS
        .iter()
        .filter_map(|kw| keyword_index(upper, kw))
        .min()
}

/// Classify the statement wrapped by an executing `EXPLAIN ANALYZE`, as if it
/// had been submitted directly. Unrecognized/empty input is `"unknown"` so the
/// safety gates fail closed.
fn classify_wrapped_statement(wrapped_upper: &str) -> &'static str {
    let peeled = wrapped_upper.trim_start_matches(|c: char| c == '(' || c.is_whitespace());
    match first_keyword(peeled).as_str() {
        "SELECT" | "VALUES" => classify_select_side_effects(peeled),
        "PRAGMA" => classify_pragma(peeled),
        "SHOW" | "DESCRIBE" | "DESC" | "TABLE" => "select",
        "INSERT" | "UPDATE" | "DELETE" | "MERGE" | "REPLACE" => "write",
        "CREATE" | "DROP" | "ALTER" | "TRUNCATE" | "RENAME" | "GRANT" | "REVOKE" | "COMMENT" => {
            "ddl"
        }
        "WITH" => classify_cte(peeled),
        _ => "unknown",
    }
}

/// Replace string literals and SQL comments with whitespace so keyword
/// scanning cannot be fooled by tokens that live inside a value, comment,
/// or quoted identifier.
///
/// Uses the SQL-standard reading of single-quoted strings (only `''` escapes
/// a quote) plus PostgreSQL escape strings and dollar quotes. The classifier
/// itself lexes under several dialect profiles, see [`lex_profiles_for`].
pub fn strip_strings_and_comments(sql: &str) -> String {
    strip_with_profile(sql, &LEGACY_STANDARD, false)
}

/// How one SQL dialect (or server mode) tokenizes the parts of a statement
/// the classifier must skip: string literals, quoted identifiers, comments.
///
/// Every flag describes a rule a real engine applies. A rule that is wrong for
/// the engine actually running the query can only hide or reveal text in that
/// one pass; because a statement is a read only when every pass of its
/// dialect agrees (see [`classify_query_kind_for_dialect`]), extra passes make
/// the classifier stricter, never laxer.
#[derive(Debug, Clone, Copy)]
pub(crate) struct LexProfile {
    /// `\` escapes the next byte inside `'…'` (MySQL default, PostgreSQL
    /// with `standard_conforming_strings = off`, BigQuery).
    backslash_in_single: bool,
    /// `\` escapes the next byte inside `"…"` (MySQL strings without
    /// `ANSI_QUOTES`, BigQuery).
    backslash_in_double: bool,
    /// `\` escapes the next byte inside `` `…` `` (BigQuery).
    backslash_in_backtick: bool,
    /// `#` starts a line comment (MySQL, MariaDB, BigQuery).
    hash_comments: bool,
    /// `--` only starts a comment when followed by whitespace, a control byte
    /// or end of input (MySQL: `1--1` is arithmetic).
    dash_comment_needs_space: bool,
    /// A carriage return also ends a line comment (PostgreSQL, SQL Server).
    line_comment_ends_at_cr: bool,
    /// `/* … */` comments nest (PostgreSQL, SQL Server).
    nested_block_comments: bool,
    /// `/*! … */` and `/*M! … */` bodies are executed (MySQL, MariaDB), so
    /// they are scanned as code rather than skipped.
    executable_comments: bool,
    /// `'''…'''` and `"""…"""` delimit strings (BigQuery).
    triple_quotes: bool,
    /// PostgreSQL `E'…'` escape strings and `$tag$…$tag$` dollar quotes.
    postgres_strings: bool,
    /// `[…]` delimits an identifier (SQL Server, SQLite).
    bracket_identifiers: bool,
}

const BASE_PROFILE: LexProfile = LexProfile {
    backslash_in_single: false,
    backslash_in_double: false,
    backslash_in_backtick: false,
    hash_comments: false,
    dash_comment_needs_space: false,
    line_comment_ends_at_cr: false,
    nested_block_comments: false,
    executable_comments: false,
    triple_quotes: false,
    postgres_strings: false,
    bracket_identifiers: false,
};

/// The historical single-pass reading: SQL-standard strings, PostgreSQL
/// escape strings and dollar quotes, non-nesting block comments.
const LEGACY_STANDARD: LexProfile = LexProfile {
    postgres_strings: true,
    ..BASE_PROFILE
};

/// [`LEGACY_STANDARD`] with backslash escapes in `'…'`.
const LEGACY_BACKSLASH: LexProfile = LexProfile {
    backslash_in_single: true,
    postgres_strings: true,
    ..BASE_PROFILE
};

/// PostgreSQL proper: nesting block comments, `--` ends at CR or LF.
const POSTGRES: LexProfile = LexProfile {
    nested_block_comments: true,
    line_comment_ends_at_cr: true,
    postgres_strings: true,
    ..BASE_PROFILE
};

/// PostgreSQL with `standard_conforming_strings = off`.
const POSTGRES_BACKSLASH: LexProfile = LexProfile {
    backslash_in_single: true,
    ..POSTGRES
};

/// MySQL / MariaDB default SQL mode: `"…"` is a string, backslash escapes in
/// both string kinds, `#` and `-- ` comments, executable comments.
const MYSQL: LexProfile = LexProfile {
    backslash_in_single: true,
    backslash_in_double: true,
    hash_comments: true,
    dash_comment_needs_space: true,
    executable_comments: true,
    ..BASE_PROFILE
};

/// MySQL with `ANSI_QUOTES`: `"…"` is an identifier (no backslash escapes).
const MYSQL_ANSI_QUOTES: LexProfile = LexProfile {
    backslash_in_double: false,
    ..MYSQL
};

/// MySQL with `NO_BACKSLASH_ESCAPES`.
const MYSQL_NO_BACKSLASH: LexProfile = LexProfile {
    backslash_in_single: false,
    backslash_in_double: false,
    ..MYSQL
};

/// SQL Server: `[…]` identifiers, nesting block comments.
const MSSQL: LexProfile = LexProfile {
    bracket_identifiers: true,
    nested_block_comments: true,
    line_comment_ends_at_cr: true,
    ..BASE_PROFILE
};

/// SQLite: `[…]` and `` `…` `` identifiers, no backslash escapes, no nesting.
const SQLITE: LexProfile = LexProfile {
    bracket_identifiers: true,
    ..BASE_PROFILE
};

/// BigQuery GoogleSQL: `#` comments, backslash escapes in every quote kind
/// (including backtick identifiers), triple-quoted strings.
const BIGQUERY: LexProfile = LexProfile {
    backslash_in_single: true,
    backslash_in_double: true,
    backslash_in_backtick: true,
    hash_comments: true,
    triple_quotes: true,
    ..BASE_PROFILE
};

const POSTGRES_PROFILES: &[LexProfile] = &[
    LEGACY_STANDARD,
    LEGACY_BACKSLASH,
    POSTGRES,
    POSTGRES_BACKSLASH,
];
const MYSQL_PROFILES: &[LexProfile] = &[MYSQL, MYSQL_ANSI_QUOTES, MYSQL_NO_BACKSLASH];
const MSSQL_PROFILES: &[LexProfile] = &[MSSQL, SQLITE];
const SQLITE_PROFILES: &[LexProfile] = &[SQLITE];
const ALL_PROFILES: &[LexProfile] = &[
    LEGACY_STANDARD,
    LEGACY_BACKSLASH,
    POSTGRES,
    POSTGRES_BACKSLASH,
    MYSQL,
    MYSQL_ANSI_QUOTES,
    MYSQL_NO_BACKSLASH,
    MSSQL,
    SQLITE,
    BIGQUERY,
];

/// The lexer profiles a statement for `dialect` must be read as a single read
/// statement under. Dialects without a dedicated set (`generic`, `oracle`, an
/// undeclared dialect, or one added after this was written) get every profile,
/// which fails closed.
pub(crate) fn lex_profiles_for(dialect: Option<SqlDialect>) -> &'static [LexProfile] {
    match dialect {
        Some(SqlDialect::Postgres) => POSTGRES_PROFILES,
        Some(SqlDialect::Mysql) => MYSQL_PROFILES,
        Some(SqlDialect::Mssql) => MSSQL_PROFILES,
        Some(SqlDialect::Sqlite) => SQLITE_PROFILES,
        _ => ALL_PROFILES,
    }
}

/// Blank out string literals, comments and quoted identifiers of `sql` as
/// tokenized by `profile`, keeping byte offsets. Every other byte is copied.
///
/// When `mark_identifiers` is true, `"…"` and `` `…` `` regions become runs of
/// [`IDENT_MARK`] instead of spaces, so a later pass can tell a quoted
/// identifier apart from a blanked literal — needed to spot a function invoked
/// through a quoted name (`"lo_export"(…)`).
pub(crate) fn strip_with_profile(
    sql: &str,
    profile: &LexProfile,
    mark_identifiers: bool,
) -> String {
    let p = profile;
    let ident_fill = if mark_identifiers { IDENT_MARK } else { b' ' };
    let bytes = sql.as_bytes();
    let n = bytes.len();
    let mut out = Vec::with_capacity(n);
    let mut i = 0;
    while i < n {
        let c = bytes[i];
        // Line comments: `--` (MySQL needs a following space) and `#`.
        let dash_comment = c == b'-'
            && bytes.get(i + 1) == Some(&b'-')
            && (!p.dash_comment_needs_space
                || bytes
                    .get(i + 2)
                    .is_none_or(|b| b.is_ascii_whitespace() || b.is_ascii_control()));
        if dash_comment || (p.hash_comments && c == b'#') {
            while i < n && bytes[i] != b'\n' && !(p.line_comment_ends_at_cr && bytes[i] == b'\r') {
                out.push(b' ');
                i += 1;
            }
            continue;
        }
        if c == b'/' && bytes.get(i + 1) == Some(&b'*') {
            // MySQL executable comment: blank the opener (and its version
            // number) and keep scanning the body as code, because the server
            // runs it.
            if p.executable_comments {
                if let Some(len) = executable_comment_opener_len(&bytes[i..]) {
                    out.extend(std::iter::repeat(b' ').take(len));
                    i += len;
                    continue;
                }
            }
            let mut depth = 0usize;
            while i < n {
                if bytes[i] == b'/'
                    && bytes.get(i + 1) == Some(&b'*')
                    && (depth == 0 || p.nested_block_comments)
                {
                    depth += 1;
                    out.extend_from_slice(b"  ");
                    i += 2;
                } else if bytes[i] == b'*' && bytes.get(i + 1) == Some(&b'/') {
                    depth -= 1;
                    out.extend_from_slice(b"  ");
                    i += 2;
                    if depth == 0 {
                        break;
                    }
                } else {
                    out.push(b' ');
                    i += 1;
                }
            }
            continue;
        }
        // Escape string constant (`E'…'` / `e'…'`, PostgreSQL): a backslash
        // always escapes the next byte here. Without this, `E'\''`
        // desynchronises the scanner under the standard reading — the `\` is
        // treated as literal, the following `''` reads as an escaped quote,
        // and the string never closes — masking whatever comes after (e.g. a
        // side-effecting `lo_export(…)` call). The `E` must start a token:
        // `xE'…'` is the identifier `xE` followed by a standard string.
        if p.postgres_strings
            && (c == b'E' || c == b'e')
            && bytes.get(i + 1) == Some(&b'\'')
            && (i == 0 || !is_ident_continue(bytes[i - 1]))
        {
            out.push(b' ');
            i += 1;
            scan_quoted(bytes, &mut i, &mut out, b'\'', true, b' ');
            continue;
        }
        // Dollar-quoted string constant (`$tag$ … $tag$`, PostgreSQL). The body
        // is wholly literal — no escapes — so it ends only at the matching
        // delimiter. Scanning it as text (rather than skipping it) is what let
        // `$$'$$, lo_export(…)` hide the call: the `'` inside was read as an
        // ordinary string opener and swallowed the rest of the statement. A
        // `$` inside an identifier (`a$b$`) does not open one.
        if p.postgres_strings && c == b'$' && (i == 0 || !is_ident_continue(bytes[i - 1])) {
            if let Some(tag_len) = dollar_quote_tag_len(&bytes[i..]) {
                let delim = &bytes[i..i + tag_len];
                out.extend(std::iter::repeat(b' ').take(tag_len));
                i += tag_len;
                while i < n {
                    if bytes[i] == b'$' && bytes[i..].starts_with(delim) {
                        out.extend(std::iter::repeat(b' ').take(tag_len));
                        i += tag_len;
                        break;
                    }
                    out.push(b' ');
                    i += 1;
                }
                continue;
            }
        }
        // Triple-quoted string (BigQuery): ends only at three matching quotes.
        if p.triple_quotes
            && (c == b'\'' || c == b'"')
            && bytes.get(i + 1) == Some(&c)
            && bytes.get(i + 2) == Some(&c)
        {
            let backslash = if c == b'\'' {
                p.backslash_in_single
            } else {
                p.backslash_in_double
            };
            out.extend_from_slice(b"   ");
            i += 3;
            while i < n {
                if backslash && bytes[i] == b'\\' && i + 1 < n {
                    out.extend_from_slice(b"  ");
                    i += 2;
                } else if bytes[i..].starts_with(&[c, c, c]) {
                    out.extend_from_slice(b"   ");
                    i += 3;
                    break;
                } else {
                    out.push(b' ');
                    i += 1;
                }
            }
            continue;
        }
        match c {
            b'\'' => scan_quoted(bytes, &mut i, &mut out, c, p.backslash_in_single, b' '),
            b'"' => scan_quoted(
                bytes,
                &mut i,
                &mut out,
                c,
                p.backslash_in_double,
                ident_fill,
            ),
            b'`' => scan_quoted(
                bytes,
                &mut i,
                &mut out,
                c,
                p.backslash_in_backtick,
                ident_fill,
            ),
            // Brackets are blanked, not marked: SQL Server and SQLite have no
            // quoted-name bypass of the (PostgreSQL) side-effect denylist, and
            // `[dbo].[fn](…)` is an ordinary scalar function call.
            b'[' if p.bracket_identifiers => {
                scan_delimited(bytes, &mut i, &mut out, b'[', b']', b' ')
            }
            _ => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8(out).unwrap_or_default()
}

/// Blank a quoted run that opens with `quote` at `bytes[*i]` and ends at the
/// next unescaped, undoubled `quote` (or end of input). A doubled quote
/// (`''`, `""`, ``` `` ```) is always an escaped quote; with `backslash`, a
/// `\` also escapes the byte after it.
fn scan_quoted(
    bytes: &[u8],
    i: &mut usize,
    out: &mut Vec<u8>,
    quote: u8,
    backslash: bool,
    fill: u8,
) {
    scan_delimited_with(bytes, i, out, quote, quote, backslash, fill);
}

/// Like [`scan_quoted`] for a run with distinct open/close bytes (`[…]`),
/// where a doubled close byte (`]]`) escapes it.
fn scan_delimited(bytes: &[u8], i: &mut usize, out: &mut Vec<u8>, open: u8, close: u8, fill: u8) {
    scan_delimited_with(bytes, i, out, open, close, false, fill);
}

fn scan_delimited_with(
    bytes: &[u8],
    i: &mut usize,
    out: &mut Vec<u8>,
    open: u8,
    close: u8,
    backslash: bool,
    fill: u8,
) {
    debug_assert_eq!(bytes.get(*i), Some(&open));
    let n = bytes.len();
    out.push(fill);
    *i += 1;
    while *i < n {
        let b = bytes[*i];
        if backslash && b == b'\\' && *i + 1 < n {
            out.push(fill);
            out.push(fill);
            *i += 2;
        } else if b == close && bytes.get(*i + 1) == Some(&close) {
            out.push(fill);
            out.push(fill);
            *i += 2;
        } else if b == close {
            out.push(fill);
            *i += 1;
            return;
        } else {
            out.push(fill);
            *i += 1;
        }
    }
}

/// Length of a MySQL / MariaDB executable comment opener at the start of
/// `bytes` — `/*!`, `/*M!`, each optionally followed by a version number —
/// or `None` for an ordinary comment (including `/*+ hints */`).
fn executable_comment_opener_len(bytes: &[u8]) -> Option<usize> {
    let mut j = if bytes.starts_with(b"/*!") {
        3
    } else if bytes.starts_with(b"/*M!") {
        4
    } else {
        return None;
    };
    while j < bytes.len() && bytes[j].is_ascii_digit() {
        j += 1;
    }
    Some(j)
}

/// Marker byte that [`strip_with_profile`] leaves in place of a quoted
/// identifier when asked to. `0x01` cannot occur in the stripped output
/// otherwise (every other byte is either copied source or a blanking space),
/// so a run of it unambiguously marks where a quoted identifier stood.
const IDENT_MARK: u8 = 0x01;

/// Whether `b` can continue an unquoted identifier: ASCII alphanumerics, `_`,
/// `$` (PostgreSQL, MySQL) and any non-ASCII byte (identifiers may contain
/// Unicode letters). Used to tell an `E'…'` escape string or a `$tag$` dollar
/// quote apart from an identifier that merely ends in `E` or contains `$`.
fn is_ident_continue(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'$' || b >= 0x80
}

/// If `bytes` starts with a PostgreSQL dollar-quote opening delimiter
/// (`$$` or `$tag$`, where `tag` is an identifier without `$`), return its
/// length in bytes; otherwise `None` (e.g. a `$1` positional parameter).
fn dollar_quote_tag_len(bytes: &[u8]) -> Option<usize> {
    debug_assert_eq!(bytes.first(), Some(&b'$'));
    let is_tag_start = |b: u8| b.is_ascii_alphabetic() || b == b'_' || b >= 0x80;
    let is_tag_continue = |b: u8| b.is_ascii_alphanumeric() || b == b'_' || b >= 0x80;
    let mut j = 1;
    if j < bytes.len() && is_tag_start(bytes[j]) {
        j += 1;
        while j < bytes.len() && is_tag_continue(bytes[j]) {
            j += 1;
        }
    }
    if j < bytes.len() && bytes[j] == b'$' {
        Some(j + 1)
    } else {
        None
    }
}

/// Whether the statement, as tokenized by `profile`, calls a function through
/// a *quoted* identifier, i.e. a quoted identifier immediately followed by `(`
/// — `"lo_export"(…)`, `pg_catalog."lo_export"(…)`, `U&"lo_export"(…)`. The
/// side-effect-function denylist matches on the bare name, so quoting the name
/// slips a write-shaped call (file write via `lo_export`, backend signals,
/// `dblink_exec`, …) past it. A read-only transaction does not stop several of
/// those functions, so a query that calls one by a quoted name is never
/// treated as a clean read.
fn has_quoted_function_call(sql: &str, profile: &LexProfile) -> bool {
    let marked = strip_with_profile(sql, profile, true);
    let bytes = marked.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == IDENT_MARK {
            while i < bytes.len() && bytes[i] == IDENT_MARK {
                i += 1;
            }
            let next = bytes[i..].iter().find(|b| !b.is_ascii_whitespace());
            if next == Some(&b'(') {
                return true;
            }
        } else {
            i += 1;
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

pub fn load_session_state_in(dir: &Path) -> Option<SessionState> {
    let path = session_state_path_in(dir);
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

pub fn save_session_state_in(dir: &Path, state: &SessionState) -> Result<(), String> {
    ensure_dir(dir)?;
    let path = session_state_path_in(dir);
    let content = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// Returns the active MCP session id, generating a new one if none exists or
/// the gap since the last recorded activity exceeds `gap_minutes`.
/// Updates `last_activity_at` on every call.
pub fn compute_or_rotate_session_id_in(dir: &Path, gap_minutes: u32) -> String {
    let now = chrono::Utc::now();
    let now_str = now.to_rfc3339();
    let mut state = load_session_state_in(dir).unwrap_or_else(|| SessionState {
        session_id: new_uuid(),
        last_activity_at: now_str.clone(),
        client_hint: None,
    });

    let gap_exceeded = chrono::DateTime::parse_from_rfc3339(&state.last_activity_at)
        .map(|dt| {
            let diff = now.signed_duration_since(dt.with_timezone(&chrono::Utc));
            diff.num_minutes() > gap_minutes as i64
        })
        .unwrap_or(true);

    if gap_exceeded {
        state.session_id = new_uuid();
    }
    state.last_activity_at = now_str;
    let _ = save_session_state_in(dir, &state);
    state.session_id
}

pub fn set_client_hint_in(dir: &Path, hint: Option<String>) {
    let mut state = load_session_state_in(dir).unwrap_or_else(|| SessionState {
        session_id: new_uuid(),
        last_activity_at: chrono::Utc::now().to_rfc3339(),
        client_hint: None,
    });
    state.client_hint = hint;
    let _ = save_session_state_in(dir, &state);
}

pub fn get_client_hint_in(dir: &Path) -> Option<String> {
    load_session_state_in(dir).and_then(|s| s.client_hint)
}

pub fn compute_or_rotate_session_id(gap_minutes: u32) -> String {
    compute_or_rotate_session_id_in(&get_app_config_dir(), gap_minutes)
}

pub fn set_client_hint(hint: Option<String>) {
    set_client_hint_in(&get_app_config_dir(), hint)
}

pub fn get_client_hint() -> Option<String> {
    get_client_hint_in(&get_app_config_dir())
}

pub fn new_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn now_iso8601() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Convert a stored UTC RFC3339 timestamp to a display timezone, so exports and
/// human-readable summaries match what the UI shows. `tz` is an optional IANA
/// timezone name (e.g. `Asia/Tokyo`); when `None`, unset, `"auto"`, or
/// unrecognised, the OS local timezone is used. Falls back to the raw value if
/// the timestamp itself cannot be parsed.
pub fn to_local_rfc3339(ts: &str, tz: Option<&str>) -> String {
    let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) else {
        return ts.to_string();
    };
    match tz.filter(|t| !t.is_empty() && *t != "auto") {
        Some(name) => match name.parse::<chrono_tz::Tz>() {
            Ok(zone) => dt.with_timezone(&zone).to_rfc3339(),
            Err(_) => dt.with_timezone(&chrono::Local).to_rfc3339(),
        },
        None => dt.with_timezone(&chrono::Local).to_rfc3339(),
    }
}
