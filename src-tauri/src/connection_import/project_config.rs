//! Importer that discovers database connection candidates from project configuration files
//! (`.env`, `.env.*`, `compose.yaml`, `docker-compose.yml`, etc.).
//!
//! Enforces safe bounded directory traversal (max depth 3, max 50 files, max 1MB per file),
//! ignores heavy/runtime directories (`node_modules`, `.git`, `target`, `vendor`, `.venv`),
//! skips symlinks, and performs zero shell/command execution.
//! Variable interpolation in `.env` and Compose is hermetic: OS process env is never read,
//! default `${VAR:-default}` (unset or empty) and `${VAR-default}` (unset only) syntax is supported,
//! cycles are detected and warned per-variable, and container vs. published host ports are
//! distinguished with explicit warnings.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use url::Url;

use super::types::{ImportEnvelope, ImportedConnection, ImportedCredentials, ImportedSsl};
use super::ForeignImportError;

const MAX_SCAN_DEPTH: usize = 3;
const MAX_CANDIDATE_FILES: usize = 50;
const MAX_FILE_SIZE_BYTES: u64 = 1_048_576; // 1 MB

/// Discovers connections from project configuration files.
#[derive(Default)]
pub struct ProjectConfigImporter;

#[async_trait::async_trait]
impl super::ForeignAppImporter for ProjectConfigImporter {
    fn id(&self) -> &'static str {
        "project_config"
    }

    fn display_name(&self) -> &'static str {
        "Project Configuration (.env / Compose)"
    }

    fn reads_passwords_from_keychain(&self) -> bool {
        false
    }

    fn import_file_types(&self) -> Option<Vec<&'static str>> {
        Some(vec!["env", "yaml", "yml"])
    }

    fn supports_manual_path(&self) -> bool {
        true
    }

    async fn is_available(&self) -> bool {
        false
    }

    async fn connection_count(&self) -> usize {
        0
    }

    async fn import(
        &self,
        include_passwords: bool,
        file: Option<&Path>,
    ) -> Result<ImportEnvelope, ForeignImportError> {
        let root = file.ok_or_else(|| {
            ForeignImportError::FileNotFound("Project configuration directory or file".to_string())
        })?;

        discover_and_import(root, include_passwords)
    }
}

/// Discover files and import candidates from a directory or single file.
pub fn discover_and_import(
    path: &Path,
    include_passwords: bool,
) -> Result<ImportEnvelope, ForeignImportError> {
    if !path.exists() {
        return Err(ForeignImportError::FileNotFound(path.display().to_string()));
    }

    let is_single_file = path.is_file();
    let files = if is_single_file {
        vec![path.to_path_buf()]
    } else {
        collect_config_files(path)
    };

    if files.is_empty() {
        return Err(ForeignImportError::NoConnectionsFound);
    }

    let mut connections = Vec::new();
    let mut credentials_by_index = HashMap::new();
    let mut group_names = Vec::new();

    let root_name = if is_single_file {
        path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Project".to_string())
    } else {
        path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Project".to_string())
    };

    group_names.push(root_name.clone());

    // First collect all .env variables in the project tree for interpolation
    let mut env_by_dir: HashMap<PathBuf, HashMap<String, String>> = HashMap::new();
    if !is_single_file {
        for file in &files {
            if is_env_file(file) {
                let parent = file.parent().unwrap_or(path).to_path_buf();
                if let Ok(content) = read_bounded_file(file) {
                    let parsed = parse_env_content(&content);
                    env_by_dir.entry(parent).or_default().extend(parsed);
                }
            }
        }
    }

    for file in &files {
        let parent = file.parent().unwrap_or(path);
        let local_env = env_by_dir.get(parent);
        let rel_path = file
            .strip_prefix(path)
            .unwrap_or(file)
            .to_string_lossy()
            .to_string();

        let display_rel = if rel_path.is_empty() {
            file.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "config".to_string())
        } else {
            rel_path
        };

        let content = match read_bounded_file(file) {
            Ok(c) => c,
            Err(_) => continue,
        };

        if is_single_file {
            // For single-file upload (web or manual), file might have an opaque name.
            // Check content and try both Compose and .env parsing.
            let mut single_candidates = Vec::new();
            if looks_like_compose(&content) || is_compose_file(file) {
                single_candidates =
                    extract_compose_candidates(&content, &display_rel, &root_name, local_env);
            }

            if single_candidates.is_empty() {
                let raw_entries = parse_raw_env_lines(&content);
                let evaluated = evaluate_env_variables(&raw_entries);
                single_candidates = extract_env_candidates(&evaluated, &display_rel, &root_name);
            }

            for (conn, password) in single_candidates {
                let index = connections.len();
                if include_passwords {
                    if let Some(pwd) = password {
                        credentials_by_index.insert(
                            index,
                            ImportedCredentials {
                                password: Some(pwd),
                                ssh_password: None,
                                ssh_key_passphrase: None,
                            },
                        );
                    }
                }
                connections.push(conn);
            }
        } else if is_env_file(file) {
            let raw_entries = parse_raw_env_lines(&content);
            let evaluated = evaluate_env_variables(&raw_entries);
            let candidates = extract_env_candidates(&evaluated, &display_rel, &root_name);

            for (conn, password) in candidates {
                let index = connections.len();
                if include_passwords {
                    if let Some(pwd) = password {
                        credentials_by_index.insert(
                            index,
                            ImportedCredentials {
                                password: Some(pwd),
                                ssh_password: None,
                                ssh_key_passphrase: None,
                            },
                        );
                    }
                }
                connections.push(conn);
            }
        } else if is_compose_file(file) {
            let candidates =
                extract_compose_candidates(&content, &display_rel, &root_name, local_env);

            for (conn, password) in candidates {
                let index = connections.len();
                if include_passwords {
                    if let Some(pwd) = password {
                        credentials_by_index.insert(
                            index,
                            ImportedCredentials {
                                password: Some(pwd),
                                ssh_password: None,
                                ssh_key_passphrase: None,
                            },
                        );
                    }
                }
                connections.push(conn);
            }
        }
    }

    if connections.is_empty() {
        return Err(ForeignImportError::NoConnectionsFound);
    }

    Ok(ImportEnvelope {
        source_name: format!("Project Config ({})", root_name),
        connections,
        credentials_by_index,
        group_names,
        credentials_aborted: false,
    })
}

/// Collect configuration files with bounded traversal.
fn collect_config_files(root: &Path) -> Vec<PathBuf> {
    let mut results = Vec::new();
    let mut dirs_to_visit = vec![(root.to_path_buf(), 0)];

    while let Some((dir, depth)) = dirs_to_visit.pop() {
        if depth > MAX_SCAN_DEPTH || results.len() >= MAX_CANDIDATE_FILES {
            continue;
        }

        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            if results.len() >= MAX_CANDIDATE_FILES {
                break;
            }

            // Symlink check: never follow symlinks
            let file_type = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if file_type.is_symlink() {
                continue;
            }

            let file_name = entry.file_name();
            let name_str = file_name.to_string_lossy();

            if file_type.is_dir() {
                if depth < MAX_SCAN_DEPTH && !should_skip_dir(&name_str) {
                    dirs_to_visit.push((entry.path(), depth + 1));
                }
            } else if file_type.is_file() {
                let path = entry.path();
                if (is_env_file(&path) || is_compose_file(&path)) && is_size_ok(&path) {
                    results.push(path);
                }
            }
        }
    }

    results.sort();
    results
}

fn should_skip_dir(name: &str) -> bool {
    if name.starts_with('.') {
        return true;
    }
    matches!(
        name,
        "node_modules" | "target" | "vendor" | "dist" | "build" | "__pycache__" | "venv"
    )
}

fn is_size_ok(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|m| m.len() <= MAX_FILE_SIZE_BYTES)
        .unwrap_or(false)
}

fn read_bounded_file(path: &Path) -> Result<String, ForeignImportError> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) => {
            return Err(ForeignImportError::FileNotFound(format!(
                "{}: {}",
                path.display(),
                e
            )))
        }
    };

    if metadata.file_type().is_symlink() {
        return Err(ForeignImportError::ParseError(format!(
            "Symlinks are not allowed: {}",
            path.display()
        )));
    }

    if metadata.len() > MAX_FILE_SIZE_BYTES {
        return Err(ForeignImportError::ParseError(format!(
            "File exceeds maximum size limit (1MB): {}",
            path.display()
        )));
    }

    std::fs::read_to_string(path).map_err(|e| ForeignImportError::ParseError(e.to_string()))
}

fn is_env_file(path: &Path) -> bool {
    let file_name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return false,
    };
    file_name == ".env" || file_name.starts_with(".env.")
}

fn is_compose_file(path: &Path) -> bool {
    let file_name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return false,
    };
    matches!(
        file_name,
        "docker-compose.yml" | "docker-compose.yaml" | "compose.yml" | "compose.yaml"
    ) || ((file_name.starts_with("docker-compose.") || file_name.starts_with("compose."))
        && (file_name.ends_with(".yml") || file_name.ends_with(".yaml")))
}

fn looks_like_compose(content: &str) -> bool {
    let lower = content.to_ascii_lowercase();
    lower.contains("services:")
        || (lower.contains("image:")
            && (lower.contains("postgres") || lower.contains("mysql") || lower.contains("mariadb")))
}

// ── .env parser & variable interpolation ───────────────────────────────────

#[derive(Debug, Clone)]
pub(crate) enum RawValue {
    SingleQuoted(String),
    DoubleQuoted(String),
    Unquoted(String),
}

/// Parse raw lines preserving quote semantics.
fn parse_raw_env_lines(content: &str) -> Vec<(String, RawValue)> {
    let mut entries = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // Optional leading 'export '
        let line_content = trimmed.strip_prefix("export ").unwrap_or(trimmed).trim();
        let eq_idx = match line_content.find('=') {
            Some(i) => i,
            None => continue,
        };

        let key = line_content[..eq_idx].trim().to_string();
        if key.is_empty() {
            continue;
        }

        let val_part = line_content[eq_idx + 1..].trim();
        let raw_val = if val_part.starts_with('\'') {
            // Single quotes: preserve verbatim until next closing single quote
            if let Some(end_idx) = val_part[1..].find('\'') {
                RawValue::SingleQuoted(val_part[1..=end_idx].to_string())
            } else {
                RawValue::SingleQuoted(val_part[1..].to_string())
            }
        } else if val_part.starts_with('"') {
            // Double quotes: unescape escapes and keep for interpolation
            let inner = if let Some(end_idx) = find_closing_quote(&val_part[1..]) {
                &val_part[1..=end_idx]
            } else {
                &val_part[1..]
            };
            RawValue::DoubleQuoted(unescape_double_quotes(inner))
        } else {
            // Unquoted: strip inline comments preceded by whitespace
            let comment_free = strip_inline_comment(val_part);
            RawValue::Unquoted(comment_free.to_string())
        };

        entries.push((key, raw_val));
    }

    entries
}

fn find_closing_quote(s: &str) -> Option<usize> {
    let mut escaped = false;
    for (i, c) in s.char_indices() {
        if escaped {
            escaped = false;
        } else if c == '\\' {
            escaped = true;
        } else if c == '"' {
            return Some(i);
        }
    }
    None
}

fn unescape_double_quotes(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('r') => out.push('\r'),
                Some('t') => out.push('\t'),
                Some('"') => out.push('"'),
                Some('\\') => {
                    // Escaped backslash: preserve so expand_string can distinguish \\ from \
                    out.push('\\');
                    out.push('\\');
                }
                Some('$') => {
                    // Preserve the escape sequence so interpolation preserves the literal dollar!
                    out.push('\\');
                    out.push('$');
                }
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn strip_inline_comment(s: &str) -> &str {
    let bytes = s.as_bytes();
    for i in 0..bytes.len() {
        if bytes[i] == b'#' {
            if i == 0 || bytes[i - 1] == b' ' || bytes[i - 1] == b'\t' {
                return s[..i].trim_end();
            }
        }
    }
    s.trim_end()
}

const MAX_INTERPOLATION_DEPTH: usize = 16;
const MAX_EXPANDED_VALUE_LEN: usize = 65_536;
const MAX_TOTAL_EXPANSION_STEPS: usize = 10_000;

#[derive(Clone, Debug)]
pub(crate) struct ExpansionBudget {
    depth: usize,
    total_steps: usize,
    exhausted: bool,
}

impl Default for ExpansionBudget {
    fn default() -> Self {
        Self {
            depth: 0,
            total_steps: MAX_TOTAL_EXPANSION_STEPS,
            exhausted: false,
        }
    }
}

pub(crate) struct EvaluatedEnv {
    pub map: HashMap<String, String>,
    pub var_warnings: HashMap<String, Vec<String>>,
}

/// Evaluates environment variables with cycle detection and fallback default expansion.
/// Never reads from OS environment (`std::env::var`).
pub(crate) fn evaluate_env_variables(raw_entries: &[(String, RawValue)]) -> EvaluatedEnv {
    let mut raw_map = HashMap::new();
    for (k, v) in raw_entries {
        raw_map.insert(k.clone(), v.clone());
    }

    let mut evaluated = HashMap::new();
    let mut var_warnings: HashMap<String, Vec<String>> = HashMap::new();
    let mut deps: HashMap<String, HashSet<String>> = HashMap::new();
    let mut budget = ExpansionBudget::default();

    for (k, _) in raw_entries {
        let mut active = HashSet::new();
        let val = expand_key(
            k,
            &raw_map,
            &mut evaluated,
            &mut active,
            &mut var_warnings,
            &mut deps,
            &mut budget,
            k,
        );
        evaluated.insert(k.clone(), val);
    }

    // Propagate warnings transitively through referenced dependencies.
    // E.g. if DATABASE_URL references A (or B), any warnings encountered while evaluating
    // A or B are also visible on DATABASE_URL.
    for (k, _) in raw_entries {
        let mut visited = HashSet::new();
        let mut queue = Vec::new();
        if let Some(direct) = deps.get(k) {
            for dep in direct {
                queue.push(dep.clone());
            }
        }
        let mut transitive_warnings = Vec::new();
        while let Some(current) = queue.pop() {
            if visited.insert(current.clone()) {
                if let Some(w) = var_warnings.get(&current) {
                    transitive_warnings.extend(w.clone());
                }
                if let Some(next_deps) = deps.get(&current) {
                    for d in next_deps {
                        queue.push(d.clone());
                    }
                }
            }
        }
        if !transitive_warnings.is_empty() {
            let target = var_warnings.entry(k.clone()).or_default();
            for tw in transitive_warnings {
                if !target.contains(&tw) {
                    target.push(tw);
                }
            }
        }
    }

    EvaluatedEnv {
        map: evaluated,
        var_warnings,
    }
}

fn expand_key(
    key: &str,
    raw_map: &HashMap<String, RawValue>,
    evaluated: &mut HashMap<String, String>,
    active: &mut HashSet<String>,
    var_warnings: &mut HashMap<String, Vec<String>>,
    deps: &mut HashMap<String, HashSet<String>>,
    budget: &mut ExpansionBudget,
    current_root_key: &str,
) -> String {
    deps.entry(current_root_key.to_string())
        .or_default()
        .insert(key.to_string());

    if let Some(val) = evaluated.get(key) {
        return val.clone();
    }

    if budget.exhausted {
        return String::new();
    }

    if budget.total_steps == 0 {
        budget.exhausted = true;
        var_warnings
            .entry(current_root_key.to_string())
            .or_default()
            .push(
                "Variable interpolation exceeded total work budget; stopping further expansion"
                    .to_string(),
            );
        return String::new();
    }
    budget.total_steps -= 1;

    if budget.depth >= MAX_INTERPOLATION_DEPTH {
        var_warnings
            .entry(current_root_key.to_string())
            .or_default()
            .push(format!(
                "Variable interpolation exceeded maximum reference depth ({}) for \"{}\"",
                MAX_INTERPOLATION_DEPTH, key
            ));
        return String::new();
    }

    let raw = match raw_map.get(key) {
        Some(r) => r,
        None => return String::new(),
    };

    match raw {
        RawValue::SingleQuoted(s) => s.clone(),
        RawValue::DoubleQuoted(s) | RawValue::Unquoted(s) => {
            if active.contains(key) {
                var_warnings
                    .entry(current_root_key.to_string())
                    .or_default()
                    .push(format!(
                        "Variable interpolation cycle detected for \"{}\"",
                        key
                    ));
                return String::new();
            }
            active.insert(key.to_string());
            budget.depth += 1;
            let expanded = expand_string(
                s,
                raw_map,
                evaluated,
                active,
                var_warnings,
                deps,
                budget,
                current_root_key,
            );
            budget.depth -= 1;
            active.remove(key);
            expanded
        }
    }
}

fn append_bounded_str(
    dest: &mut String,
    src: &str,
    max_len: usize,
    var_warnings: &mut HashMap<String, Vec<String>>,
    current_root_key: &str,
) -> bool {
    let remaining = max_len.saturating_sub(dest.len());
    if src.len() <= remaining {
        dest.push_str(src);
        true
    } else {
        let mut split_idx = remaining;
        while split_idx > 0 && !src.is_char_boundary(split_idx) {
            split_idx -= 1;
        }
        dest.push_str(&src[..split_idx]);
        var_warnings
            .entry(current_root_key.to_string())
            .or_default()
            .push(format!(
                "Variable interpolation exceeded maximum value size limit ({} bytes) for \"{}\"",
                max_len, current_root_key
            ));
        false
    }
}

fn append_bounded_char(
    dest: &mut String,
    c: char,
    max_len: usize,
    var_warnings: &mut HashMap<String, Vec<String>>,
    current_root_key: &str,
) -> bool {
    if dest.len() + c.len_utf8() <= max_len {
        dest.push(c);
        true
    } else {
        var_warnings
            .entry(current_root_key.to_string())
            .or_default()
            .push(format!(
                "Variable interpolation exceeded maximum value size limit ({} bytes) for \"{}\"",
                max_len, current_root_key
            ));
        false
    }
}

fn expand_string(
    input: &str,
    raw_map: &HashMap<String, RawValue>,
    evaluated: &mut HashMap<String, String>,
    active: &mut HashSet<String>,
    var_warnings: &mut HashMap<String, Vec<String>>,
    deps: &mut HashMap<String, HashSet<String>>,
    budget: &mut ExpansionBudget,
    current_root_key: &str,
) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.char_indices().peekable();

    while let Some((_, c)) = chars.next() {
        if budget.exhausted || result.len() >= MAX_EXPANDED_VALUE_LEN {
            if result.len() >= MAX_EXPANDED_VALUE_LEN {
                var_warnings
                    .entry(current_root_key.to_string())
                    .or_default()
                    .push(format!(
                        "Variable interpolation exceeded maximum value size limit ({} bytes) for \"{}\"",
                        MAX_EXPANDED_VALUE_LEN, current_root_key
                    ));
            }
            break;
        }

        if c == '\\' {
            if let Some(&(_, '$')) = chars.peek() {
                // Escaped dollar sign (\$): treat as literal '$' without variable interpolation
                chars.next();
                if !append_bounded_char(
                    &mut result,
                    '$',
                    MAX_EXPANDED_VALUE_LEN,
                    var_warnings,
                    current_root_key,
                ) {
                    break;
                }
            } else if let Some(&(_, '\\')) = chars.peek() {
                // Escaped backslash (\\): output single '\'
                chars.next();
                if !append_bounded_char(
                    &mut result,
                    '\\',
                    MAX_EXPANDED_VALUE_LEN,
                    var_warnings,
                    current_root_key,
                ) {
                    break;
                }
            } else if !append_bounded_char(
                &mut result,
                '\\',
                MAX_EXPANDED_VALUE_LEN,
                var_warnings,
                current_root_key,
            ) {
                break;
            }
        } else if c == '$' {
            if let Some(&(_, '{')) = chars.peek() {
                chars.next(); // consume '{'
                              // Find closing '}'
                let mut var_expr = String::new();
                let mut found_end = false;
                while let Some((_, inner_c)) = chars.next() {
                    if inner_c == '}' {
                        found_end = true;
                        break;
                    }
                    var_expr.push(inner_c);
                }

                if found_end {
                    let (var_name, default_val, default_on_empty) = parse_var_expr(&var_expr);
                    deps.entry(current_root_key.to_string())
                        .or_default()
                        .insert(var_name.to_string());
                    let is_defined = raw_map.contains_key(var_name);
                    let expanded_val = if is_defined {
                        expand_key(
                            var_name,
                            raw_map,
                            evaluated,
                            active,
                            var_warnings,
                            deps,
                            budget,
                            current_root_key,
                        )
                    } else {
                        String::new()
                    };

                    let should_use_default = if is_defined {
                        default_on_empty && expanded_val.is_empty()
                    } else {
                        true
                    };

                    if should_use_default && default_val.is_some() {
                        let def = default_val.unwrap();
                        let expanded_def = expand_string(
                            def,
                            raw_map,
                            evaluated,
                            active,
                            var_warnings,
                            deps,
                            budget,
                            current_root_key,
                        );
                        if !append_bounded_str(
                            &mut result,
                            &expanded_def,
                            MAX_EXPANDED_VALUE_LEN,
                            var_warnings,
                            current_root_key,
                        ) {
                            break;
                        }
                    } else if is_defined {
                        if !append_bounded_str(
                            &mut result,
                            &expanded_val,
                            MAX_EXPANDED_VALUE_LEN,
                            var_warnings,
                            current_root_key,
                        ) {
                            break;
                        }
                    } else {
                        var_warnings
                            .entry(current_root_key.to_string())
                            .or_default()
                            .push(format!(
                                "Unresolved environment variable: \"${{{}}}\"",
                                var_name
                            ));
                    }
                } else {
                    if !append_bounded_char(
                        &mut result,
                        '$',
                        MAX_EXPANDED_VALUE_LEN,
                        var_warnings,
                        current_root_key,
                    ) {
                        break;
                    }
                    if !append_bounded_char(
                        &mut result,
                        '{',
                        MAX_EXPANDED_VALUE_LEN,
                        var_warnings,
                        current_root_key,
                    ) {
                        break;
                    }
                    if !append_bounded_str(
                        &mut result,
                        &var_expr,
                        MAX_EXPANDED_VALUE_LEN,
                        var_warnings,
                        current_root_key,
                    ) {
                        break;
                    }
                }
            } else {
                // Bare $VAR: [A-Za-z_][A-Za-z0-9_]*
                let mut var_name = String::new();
                while let Some(&(_, next_c)) = chars.peek() {
                    if next_c.is_alphanumeric() || next_c == '_' {
                        var_name.push(next_c);
                        chars.next();
                    } else {
                        break;
                    }
                }

                if var_name.is_empty() {
                    if !append_bounded_char(
                        &mut result,
                        '$',
                        MAX_EXPANDED_VALUE_LEN,
                        var_warnings,
                        current_root_key,
                    ) {
                        break;
                    }
                } else {
                    deps.entry(current_root_key.to_string())
                        .or_default()
                        .insert(var_name.clone());
                    if raw_map.contains_key(&var_name) {
                        let expanded_val = expand_key(
                            &var_name,
                            raw_map,
                            evaluated,
                            active,
                            var_warnings,
                            deps,
                            budget,
                            current_root_key,
                        );
                        if !append_bounded_str(
                            &mut result,
                            &expanded_val,
                            MAX_EXPANDED_VALUE_LEN,
                            var_warnings,
                            current_root_key,
                        ) {
                            break;
                        }
                    } else {
                        var_warnings
                            .entry(current_root_key.to_string())
                            .or_default()
                            .push(format!(
                                "Unresolved environment variable: \"${}\"",
                                var_name
                            ));
                    }
                }
            }
        } else if !append_bounded_char(
            &mut result,
            c,
            MAX_EXPANDED_VALUE_LEN,
            var_warnings,
            current_root_key,
        ) {
            break;
        }
    }

    result
}

/// Parses `${VAR:-default}` (unset or empty) or `${VAR-default}` (unset only).
/// Returns (var_name, default, default_on_empty).
fn parse_var_expr(expr: &str) -> (&str, Option<&str>, bool) {
    if let Some(idx) = expr.find(":-") {
        (&expr[..idx], Some(&expr[idx + 2..]), true)
    } else if let Some(idx) = expr.find('-') {
        let name = &expr[..idx];
        if !name.is_empty() && name.chars().all(|c| c.is_alphanumeric() || c == '_') {
            (name, Some(&expr[idx + 1..]), false)
        } else {
            (expr, None, false)
        }
    } else {
        (expr, None, false)
    }
}

fn parse_env_content(content: &str) -> HashMap<String, String> {
    let raw = parse_raw_env_lines(content);
    let eval = evaluate_env_variables(&raw);
    eval.map
}

// ── Candidate extraction from .env ──────────────────────────────────────────

fn extract_env_candidates(
    env: &EvaluatedEnv,
    file_rel_path: &str,
    group_name: &str,
) -> Vec<(ImportedConnection, Option<String>)> {
    let mut candidates = Vec::new();
    let mut processed_discrete = HashSet::new();

    // 1. URL candidates
    for (key, val) in &env.map {
        let upper_key = key.to_ascii_uppercase();
        let is_url_candidate = upper_key == "DATABASE_URL"
            || upper_key == "DB_URL"
            || upper_key == "POSTGRES_URL"
            || upper_key == "POSTGRESQL_URL"
            || upper_key == "MYSQL_URL"
            || upper_key == "MARIADB_URL"
            || upper_key == "SQLITE_URL"
            || upper_key == "SPRING_DATASOURCE_URL"
            || upper_key.ends_with("_DATABASE_URL")
            || upper_key.ends_with("_DB_URL")
            || upper_key.ends_with("_POSTGRES_URL")
            || upper_key.ends_with("_MYSQL_URL")
            || upper_key.ends_with("_SQLITE_URL");

        if is_url_candidate && (val.contains("://") || val.starts_with("sqlite:")) {
            let key_warnings = env.var_warnings.get(key).cloned().unwrap_or_default();
            if let Some(candidate) =
                parse_connection_url(val, key, file_rel_path, group_name, &key_warnings)
            {
                candidates.push(candidate);
            }
        }
    }

    // 2. Discrete candidates (Postgres, MySQL, or generic DB_*)
    let prefix_groups = [
        ("POSTGRES_", "PostgreSQL", 5432),
        ("MYSQL_", "MySQL", 3306),
        ("DB_", "", 0),
    ];

    for (prefix, default_driver, default_port) in prefix_groups {
        let get = |suffix: &str| -> Option<String> {
            let k = format!("{}{}", prefix, suffix);
            env.map.get(&k).cloned()
        };

        let host = get("HOST");
        let port_str = get("PORT");
        let db = get("DATABASE")
            .or_else(|| get("DB"))
            .or_else(|| get("NAME"));
        let user = get("USER").or_else(|| get("USERNAME"));
        let pass = get("PASSWORD").or_else(|| get("PASS"));

        if host.is_some() || db.is_some() {
            let discrete_id = format!("{}:{}:{:?}", prefix, host.as_deref().unwrap_or(""), db);
            if processed_discrete.contains(&discrete_id) {
                continue;
            }
            processed_discrete.insert(discrete_id);

            let driver_type = get("CONNECTION")
                .or_else(|| get("TYPE"))
                .or_else(|| get("DRIVER"))
                .unwrap_or_default()
                .to_ascii_lowercase();

            let (driver_label, port) =
                if driver_type.contains("postgres") || driver_type.contains("pgsql") {
                    ("PostgreSQL", 5432)
                } else if driver_type.contains("mysql") || driver_type.contains("mariadb") {
                    ("MySQL", 3306)
                } else if driver_type.contains("sqlite") {
                    ("SQLite", 0)
                } else if !default_driver.is_empty() {
                    (default_driver, default_port)
                } else {
                    let parsed_port = port_str.as_deref().and_then(|p| p.parse::<u16>().ok());
                    if parsed_port == Some(3306) {
                        ("MySQL", 3306)
                    } else {
                        ("PostgreSQL", 5432)
                    }
                };

            let port = port_str.and_then(|p| p.parse::<u16>().ok()).unwrap_or(port);

            let host_val = host.unwrap_or_else(|| "127.0.0.1".to_string());
            let db_val = db.unwrap_or_default();
            let user_val = user.unwrap_or_default();

            let name = if !db_val.is_empty() {
                format!("{} ({})", db_val, file_rel_path)
            } else {
                format!("{} ({})", host_val, file_rel_path)
            };

            // Collect only warnings relevant to the keys in this discrete configuration
            let mut warnings = Vec::new();
            for suffix in [
                "HOST",
                "PORT",
                "DATABASE",
                "DB",
                "NAME",
                "USER",
                "USERNAME",
                "PASSWORD",
                "PASS",
                "CONNECTION",
                "TYPE",
                "DRIVER",
            ] {
                let k = format!("{}{}", prefix, suffix);
                if let Some(w) = env.var_warnings.get(&k) {
                    warnings.extend(w.clone());
                }
            }

            if host_val.is_empty() && port == 0 && db_val.is_empty() {
                warnings.push("Incomplete connection configuration".to_string());
            }

            let conn = ImportedConnection {
                name,
                host: host_val,
                port,
                database: db_val,
                username: user_val,
                driver_label: driver_label.to_string(),
                ssh: None,
                ssl: None,
                group_name: Some(group_name.to_string()),
                warnings,
            };

            candidates.push((conn, pass));
        }
    }

    candidates
}

fn parse_connection_url(
    raw_url: &str,
    var_name: &str,
    file_rel_path: &str,
    group_name: &str,
    var_warnings: &[String],
) -> Option<(ImportedConnection, Option<String>)> {
    let mut warnings = var_warnings.to_vec();

    // SQLite url: sqlite://path/to/db.sqlite or sqlite:path/to/db.sqlite
    if let Some(sqlite_path) = raw_url
        .strip_prefix("sqlite://")
        .or_else(|| raw_url.strip_prefix("sqlite:"))
    {
        let clean_path = sqlite_path.split('?').next().unwrap_or(sqlite_path);
        let name = format!("{} ({}: {})", clean_path, file_rel_path, var_name);
        let conn = ImportedConnection {
            name,
            host: String::new(),
            port: 0,
            database: clean_path.to_string(),
            username: String::new(),
            driver_label: "SQLite".to_string(),
            ssh: None,
            ssl: None,
            group_name: Some(group_name.to_string()),
            warnings,
        };
        return Some((conn, None));
    }

    let parsed = match Url::parse(raw_url) {
        Ok(u) => u,
        Err(e) => {
            warnings.push(format!(
                "Malformed connection URL in \"{}\": {} ({})",
                var_name,
                e,
                mask_url(raw_url)
            ));
            return None;
        }
    };

    let scheme = parsed.scheme().to_ascii_lowercase();
    let (driver_label, default_port) = match scheme.as_str() {
        "postgres" | "postgresql" => ("PostgreSQL", 5432),
        "mysql" | "mariadb" => ("MySQL", 3306),
        _ => {
            log::debug!(
                "Skipping unsupported URL scheme \"{}\" in \"{}\"",
                scheme,
                var_name
            );
            return None;
        }
    };

    let host = parsed.host_str().unwrap_or("127.0.0.1").to_string();
    let port = parsed.port().unwrap_or(default_port);
    let database = parsed.path().trim_start_matches('/').to_string();
    let database = urlencoding::decode(&database)
        .map(|s| s.to_string())
        .unwrap_or(database);
    let username = urlencoding::decode(parsed.username())
        .map(|s| s.to_string())
        .unwrap_or_else(|_| parsed.username().to_string());
    let password = parsed
        .password()
        .and_then(|p| urlencoding::decode(p).ok().map(|s| s.to_string()));

    let ssl = parsed
        .query_pairs()
        .find(|(k, _)| k.eq_ignore_ascii_case("sslmode"))
        .map(|(_, v)| ImportedSsl {
            mode: v.to_string(),
            ca_certificate_path: None,
            client_certificate_path: None,
            client_key_path: None,
        });

    let display_db = if !database.is_empty() {
        database.clone()
    } else {
        host.clone()
    };

    let name = format!("{} ({}: {})", display_db, file_rel_path, var_name);

    let conn = ImportedConnection {
        name,
        host,
        port,
        database,
        username,
        driver_label: driver_label.to_string(),
        ssh: None,
        ssl,
        group_name: Some(group_name.to_string()),
        warnings,
    };

    Some((conn, password))
}

pub fn mask_url(raw_url: &str) -> String {
    if let Ok(mut parsed) = Url::parse(raw_url) {
        if parsed.password().is_some() {
            let _ = parsed.set_password(Some("***"));
        }
        parsed.to_string()
    } else {
        // Fallback simple masking
        if let Some(at_idx) = raw_url.find('@') {
            if let Some(colon_idx) = raw_url[..at_idx].rfind(':') {
                if let Some(slash_idx) = raw_url[..colon_idx].find("://") {
                    if colon_idx > slash_idx + 3 {
                        return format!("{}:***{}", &raw_url[..colon_idx], &raw_url[at_idx..]);
                    }
                }
            }
        }
        raw_url.to_string()
    }
}

// ── Docker Compose Parser ──────────────────────────────────────────────────

fn extract_compose_candidates(
    yaml_content: &str,
    file_rel_path: &str,
    group_name: &str,
    local_env: Option<&HashMap<String, String>>,
) -> Vec<(ImportedConnection, Option<String>)> {
    let root_val: serde_yaml::Value = match serde_yaml::from_str(yaml_content) {
        Ok(v) => v,
        Err(e) => {
            log::warn!(
                "Failed to parse YAML content in \"{}\": {}",
                file_rel_path,
                e
            );
            return Vec::new();
        }
    };

    let services = match root_val.get("services").and_then(|s| s.as_mapping()) {
        Some(m) => m,
        None => return Vec::new(),
    };

    let mut candidates = Vec::new();

    for (service_key, service_val) in services {
        let service_name = service_key.as_str().unwrap_or("db");
        let service_map = match service_val.as_mapping() {
            Some(m) => m,
            None => continue,
        };

        let image = service_map
            .get(&serde_yaml::Value::String("image".to_string()))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_ascii_lowercase();

        let (driver_label, default_container_port) = if image.starts_with("postgres")
            || image.contains("/postgres")
            || image.contains("timescaledb")
            || image.contains("postgis")
            || image.contains("postgresql")
        {
            ("PostgreSQL", 5432)
        } else if image.starts_with("mysql")
            || image.contains("/mysql")
            || image.starts_with("mariadb")
            || image.contains("/mariadb")
        {
            ("MySQL", 3306)
        } else {
            // Check if service name strongly suggests database
            let s_lower = service_name.to_ascii_lowercase();
            if s_lower.contains("postgres")
                || s_lower.contains("pgsql")
                || s_lower == "pg"
                || s_lower == "db"
                || s_lower == "database"
            {
                ("PostgreSQL", 5432)
            } else if s_lower.contains("mysql") || s_lower.contains("mariadb") {
                ("MySQL", 3306)
            } else {
                continue;
            }
        };

        // Extract environment
        let mut env_map = HashMap::new();
        if let Some(env_val) =
            service_map.get(&serde_yaml::Value::String("environment".to_string()))
        {
            if let Some(m) = env_val.as_mapping() {
                for (k, v) in m {
                    if let Some(k_str) = k.as_str() {
                        let v_str = match v {
                            serde_yaml::Value::String(s) => s.clone(),
                            serde_yaml::Value::Number(n) => n.to_string(),
                            serde_yaml::Value::Bool(b) => b.to_string(),
                            _ => String::new(),
                        };
                        env_map.insert(k_str.to_string(), v_str);
                    }
                }
            } else if let Some(seq) = env_val.as_sequence() {
                for item in seq {
                    if let Some(line) = item.as_str() {
                        if let Some((k, v)) = line.split_once('=') {
                            env_map.insert(k.trim().to_string(), v.trim().to_string());
                        }
                    }
                }
            }
        }

        // Interpolate compose environment values using local .env if available
        let mut warnings = Vec::new();
        let mut resolved_env = HashMap::new();
        for (k, v) in &env_map {
            let expanded = expand_compose_variable(v, local_env, &mut warnings);
            resolved_env.insert(k.clone(), expanded);
        }

        // Parse ports: container endpoint vs host-published
        let ports_val = service_map.get(&serde_yaml::Value::String("ports".to_string()));
        let (host, port, port_warnings) =
            parse_compose_ports(ports_val, service_name, default_container_port, local_env);
        warnings.extend(port_warnings);

        // Resolve database name, user, password
        let (database, username, password) = if driver_label == "PostgreSQL" {
            let db = resolved_env
                .get("POSTGRES_DB")
                .cloned()
                .unwrap_or_else(|| "postgres".to_string());
            let user = resolved_env
                .get("POSTGRES_USER")
                .cloned()
                .unwrap_or_else(|| "postgres".to_string());
            let pwd = resolved_env.get("POSTGRES_PASSWORD").cloned();
            (db, user, pwd)
        } else {
            let db = resolved_env
                .get("MYSQL_DATABASE")
                .cloned()
                .unwrap_or_default();
            let user = resolved_env
                .get("MYSQL_USER")
                .cloned()
                .unwrap_or_else(|| "root".to_string());
            let pwd = resolved_env
                .get("MYSQL_PASSWORD")
                .or_else(|| resolved_env.get("MYSQL_ROOT_PASSWORD"))
                .cloned();
            (db, user, pwd)
        };

        let name = format!("{} ({})", service_name, file_rel_path);

        let conn = ImportedConnection {
            name,
            host,
            port,
            database,
            username,
            driver_label: driver_label.to_string(),
            ssh: None,
            ssl: None,
            group_name: Some(group_name.to_string()),
            warnings,
        };

        candidates.push((conn, password));
    }

    candidates
}

fn expand_compose_variable(
    val: &str,
    local_env: Option<&HashMap<String, String>>,
    warnings: &mut Vec<String>,
) -> String {
    if !val.contains('$') {
        return val.to_string();
    }

    let mut result = String::with_capacity(val.len());
    let mut chars = val.char_indices().peekable();

    while let Some((_, c)) = chars.next() {
        if c == '$' {
            if let Some(&(_, '{')) = chars.peek() {
                chars.next();
                let mut expr = String::new();
                let mut closed = false;
                while let Some((_, inner_c)) = chars.next() {
                    if inner_c == '}' {
                        closed = true;
                        break;
                    }
                    expr.push(inner_c);
                }

                if closed {
                    let (var_name, default_val, default_on_empty) = parse_var_expr(&expr);
                    let found = local_env.and_then(|m| m.get(var_name)).cloned();
                    let is_defined = found.is_some();
                    let val_str = found.unwrap_or_default();

                    let should_use_default = if is_defined {
                        default_on_empty && val_str.is_empty()
                    } else {
                        true
                    };

                    if should_use_default && default_val.is_some() {
                        result.push_str(default_val.unwrap());
                    } else if is_defined {
                        result.push_str(&val_str);
                    } else {
                        warnings.push(format!(
                            "Unresolved compose variable: \"${{{}}}\"",
                            var_name
                        ));
                    }
                } else {
                    result.push('$');
                    result.push('{');
                    result.push_str(&expr);
                }
            } else {
                let mut var_name = String::new();
                while let Some(&(_, next_c)) = chars.peek() {
                    if next_c.is_alphanumeric() || next_c == '_' {
                        var_name.push(next_c);
                        chars.next();
                    } else {
                        break;
                    }
                }
                if let Some(v) = local_env.and_then(|m| m.get(&var_name)) {
                    result.push_str(v);
                } else {
                    warnings.push(format!("Unresolved compose variable: \"${}\"", var_name));
                }
            }
        } else {
            result.push(c);
        }
    }

    result
}

/// Parses Docker Compose ports specification.
/// Returns (host, port, warnings).
fn parse_compose_ports(
    ports_val: Option<&serde_yaml::Value>,
    service_name: &str,
    default_container_port: u16,
    local_env: Option<&HashMap<String, String>>,
) -> (String, u16, Vec<String>) {
    let mut warnings = Vec::new();

    let seq = match ports_val.and_then(|v| v.as_sequence()) {
        Some(s) if !s.is_empty() => s,
        _ => {
            warnings.push(format!(
                "Container endpoint \"{}:{}\" is not published to host; a published port is required to connect from your host",
                service_name, default_container_port
            ));
            return (service_name.to_string(), default_container_port, warnings);
        }
    };

    struct PortMapping {
        host_ip: Option<String>,
        published: u16,
        target: u16,
    }

    let mut published_mappings = Vec::new();
    let mut unpublished_target = None;

    for item in seq {
        match item {
            // Short syntax: "5432:5432", "127.0.0.1:5433:5432", "5432"
            serde_yaml::Value::String(s) => {
                let mut dummy_warnings = Vec::new();
                let expanded = expand_compose_variable(s, local_env, &mut dummy_warnings);
                let parts: Vec<&str> = expanded.split(':').collect();
                match parts.len() {
                    3 => {
                        let ip = parts[0].trim();
                        let pub_port = parts[1].trim().parse::<u16>().ok();
                        let tgt_port = parts[2].trim().parse::<u16>().ok();
                        if let (Some(p), Some(t)) = (pub_port, tgt_port) {
                            published_mappings.push(PortMapping {
                                host_ip: Some(ip.to_string()),
                                published: p,
                                target: t,
                            });
                        }
                    }
                    2 => {
                        let pub_port = parts[0].trim().parse::<u16>().ok();
                        let tgt_port = parts[1].trim().parse::<u16>().ok();
                        if let (Some(p), Some(t)) = (pub_port, tgt_port) {
                            published_mappings.push(PortMapping {
                                host_ip: None,
                                published: p,
                                target: t,
                            });
                        }
                    }
                    1 => {
                        if let Ok(tgt) = parts[0].trim().parse::<u16>() {
                            unpublished_target = Some(tgt);
                        }
                    }
                    _ => {}
                }
            }
            serde_yaml::Value::Number(n) => {
                if let Some(tgt) = n.as_u64().and_then(|u| u16::try_from(u).ok()) {
                    unpublished_target = Some(tgt);
                }
            }
            // Long syntax: { target: 5432, published: "5433", host_ip: "127.0.0.1" }
            serde_yaml::Value::Mapping(m) => {
                let tgt = m
                    .get(&serde_yaml::Value::String("target".to_string()))
                    .and_then(|v| v.as_u64())
                    .and_then(|u| u16::try_from(u).ok());
                let pub_port = m
                    .get(&serde_yaml::Value::String("published".to_string()))
                    .and_then(|v| {
                        v.as_u64()
                            .and_then(|u| u16::try_from(u).ok())
                            .or_else(|| v.as_str().and_then(|s| s.parse::<u16>().ok()))
                    });
                let host_ip = m
                    .get(&serde_yaml::Value::String("host_ip".to_string()))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                match (pub_port, tgt) {
                    (Some(p), Some(t)) => {
                        published_mappings.push(PortMapping {
                            host_ip,
                            published: p,
                            target: t,
                        });
                    }
                    (None, Some(t)) => {
                        unpublished_target = Some(t);
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    if let Some(mapping) = published_mappings
        .iter()
        .find(|m| m.target == default_container_port)
        .or_else(|| published_mappings.first())
    {
        if published_mappings.len() > 1 {
            warnings.push(format!(
                "Multiple published ports found for service \"{}\"; selected port {}",
                service_name, mapping.published
            ));
        }

        let host = match mapping.host_ip.as_deref() {
            Some("0.0.0.0") | Some("::") | Some("") | None => "127.0.0.1".to_string(),
            Some(ip) => ip.to_string(),
        };

        (host, mapping.published, warnings)
    } else {
        let tgt = unpublished_target.unwrap_or(default_container_port);
        warnings.push(format!(
            "Container endpoint \"{}:{}\" is not published to host; a published port is required to connect from your host",
            service_name, tgt
        ));
        (service_name.to_string(), tgt, warnings)
    }
}
