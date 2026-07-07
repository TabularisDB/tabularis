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
pub fn classify_query_kind(sql: &str) -> &'static str {
    let stripped = strip_strings_and_comments(sql);
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
    //
    // SQL dialects disagree on backslash escaping inside string literals:
    // MySQL/MariaDB treat `\'` as an escaped quote by default, while
    // PostgreSQL standard-conforming strings treat `\` as a literal byte.
    // That disagreement shifts where a string literal ends, and therefore
    // where a `;` becomes a visible statement separator — e.g. MySQL reads
    // `SELECT '\''; DROP TABLE users` as two statements, the standard reading
    // as one. We strip under both interpretations and fail closed if EITHER
    // reveals a trailing statement, so a payload cannot hide an injected
    // separator by exploiting whichever dialect we happen not to assume.
    if has_trailing_statements(&stripped)
        || has_trailing_statements(&strip_impl(sql, true))
    {
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

    match first.as_str() {
        "SELECT" | "SHOW" | "EXPLAIN" | "DESCRIBE" | "DESC" | "PRAGMA" | "VALUES" => "select",
        "INSERT" | "UPDATE" | "DELETE" | "MERGE" | "REPLACE" => "write",
        "CREATE" | "DROP" | "ALTER" | "TRUNCATE" | "RENAME" | "GRANT" | "REVOKE" | "COMMENT" => {
            "ddl"
        }
        "WITH" => classify_cte(&peeled_upper),
        _ => "unknown",
    }
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
fn has_trailing_statements(stripped: &str) -> bool {
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
    "select"
}

fn contains_keyword(haystack: &str, needle: &str) -> bool {
    let bytes = haystack.as_bytes();
    let nbytes = needle.as_bytes();
    let nlen = nbytes.len();
    if nlen == 0 || bytes.len() < nlen {
        return false;
    }
    let is_word = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
    for i in 0..=bytes.len() - nlen {
        if &bytes[i..i + nlen] == nbytes {
            let prev_ok = i == 0 || !is_word(bytes[i - 1]);
            let next_ok = i + nlen == bytes.len() || !is_word(bytes[i + nlen]);
            if prev_ok && next_ok {
                return true;
            }
        }
    }
    false
}

/// Replace string literals and SQL comments with whitespace so keyword
/// scanning cannot be fooled by tokens that live inside a value, comment,
/// or quoted identifier.
///
/// Uses the SQL-standard reading of single-quoted strings (only `''` escapes
/// a quote). For the backslash-aware reading used to harden multi-statement
/// detection against MySQL-style escaping, see [`strip_impl`].
pub fn strip_strings_and_comments(sql: &str) -> String {
    strip_impl(sql, false)
}

/// Backing implementation for [`strip_strings_and_comments`].
///
/// When `backslash_escapes` is true, a `\` inside a single-quoted string
/// escapes the following byte (MySQL/MariaDB default). When false, backslash
/// is an ordinary literal byte (SQL standard / PostgreSQL standard strings).
/// Only single-quoted string scanning honours the flag — comments and quoted
/// identifiers are dialect-independent here.
fn strip_impl(sql: &str, backslash_escapes: bool) -> String {
    let bytes = sql.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        // Line comment
        if c == b'-' && i + 1 < bytes.len() && bytes[i + 1] == b'-' {
            while i < bytes.len() && bytes[i] != b'\n' {
                out.push(b' ');
                i += 1;
            }
            continue;
        }
        // Block comment (non-nesting; sufficient for classification)
        if c == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'*' {
            out.push(b' ');
            out.push(b' ');
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                out.push(b' ');
                i += 1;
            }
            if i + 1 < bytes.len() {
                out.push(b' ');
                out.push(b' ');
                i += 2;
            } else {
                while i < bytes.len() {
                    out.push(b' ');
                    i += 1;
                }
            }
            continue;
        }
        // Single-quoted string literal (SQL-style escaped quote: '')
        if c == b'\'' {
            out.push(b' ');
            i += 1;
            while i < bytes.len() {
                if backslash_escapes && bytes[i] == b'\\' && i + 1 < bytes.len() {
                    // MySQL-style backslash escape: the next byte is part of
                    // the string regardless of what it is (including `'`).
                    out.push(b' ');
                    out.push(b' ');
                    i += 2;
                } else if bytes[i] == b'\'' && i + 1 < bytes.len() && bytes[i + 1] == b'\'' {
                    out.push(b' ');
                    out.push(b' ');
                    i += 2;
                } else if bytes[i] == b'\'' {
                    out.push(b' ');
                    i += 1;
                    break;
                } else {
                    out.push(b' ');
                    i += 1;
                }
            }
            continue;
        }
        // Double-quoted identifier (PostgreSQL / ANSI)
        if c == b'"' {
            out.push(b' ');
            i += 1;
            while i < bytes.len() && bytes[i] != b'"' {
                out.push(b' ');
                i += 1;
            }
            if i < bytes.len() {
                out.push(b' ');
                i += 1;
            }
            continue;
        }
        // Backtick-quoted identifier (MySQL)
        if c == b'`' {
            out.push(b' ');
            i += 1;
            while i < bytes.len() && bytes[i] != b'`' {
                out.push(b' ');
                i += 1;
            }
            if i < bytes.len() {
                out.push(b' ');
                i += 1;
            }
            continue;
        }
        out.push(c);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_default()
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
