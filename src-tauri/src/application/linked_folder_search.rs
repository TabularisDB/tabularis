use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

use super::linked_folders::{MAX_RELATIVE_DEPTH, is_sql_file_name, linked_git_root};
use crate::sql_file::MAX_SQL_FILE_BYTES;

pub const MAX_SEARCH_RESULTS: usize = 200;
pub const MAX_MATCHES_PER_FILE: usize = 50;
pub const MAX_LINE_SNIPPET_CHARS: usize = 250;
pub const MAX_FILES_SEARCHED: usize = 5_000;
pub const MAX_TOTAL_BYTES_READ: u64 = 100 * 1024 * 1024;
pub const LINKED_SEARCH_CANCELLED: &str = "linked_search_cancelled";

static SEARCH_GENERATION: AtomicU64 = AtomicU64::new(0);

pub fn begin_search_generation() -> u64 {
    SEARCH_GENERATION.fetch_add(1, Ordering::SeqCst) + 1
}

pub fn cancel_active_search() {
    SEARCH_GENERATION.fetch_add(1, Ordering::SeqCst);
}

pub fn is_search_generation_current(gen: u64) -> bool {
    SEARCH_GENERATION.load(Ordering::SeqCst) == gen
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedFolderSearchMatch {
    pub relative_path: String,
    pub line_number: usize,
    pub column_number: usize,
    pub match_length: usize,
    pub line_content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedFolderSearchResult {
    pub folder_id: String,
    pub query: String,
    pub matches: Vec<LinkedFolderSearchMatch>,
    pub files_searched: usize,
    pub files_skipped: usize,
    pub truncated: bool,
}

/// Bounded snippet centered around the match when a line is exceptionally long.
fn make_snippet(line: &str, match_char_idx: usize) -> String {
    let chars: Vec<char> = line.chars().collect();
    let total_chars = chars.len();

    if total_chars <= MAX_LINE_SNIPPET_CHARS {
        return line.to_string();
    }

    // Keep roughly half before and half after the match
    let half_window = MAX_LINE_SNIPPET_CHARS / 2;
    let start = match_char_idx.saturating_sub(half_window);
    let end = (start + MAX_LINE_SNIPPET_CHARS).min(total_chars);
    let actual_start = if end - start < MAX_LINE_SNIPPET_CHARS {
        end.saturating_sub(MAX_LINE_SNIPPET_CHARS)
    } else {
        start
    };

    let mut snippet = String::new();

    if actual_start > 0 {
        snippet.push_str("...");
    }

    let slice: String = chars[actual_start..end].iter().collect();
    snippet.push_str(&slice);

    if end < total_chars {
        snippet.push_str("...");
    }

    snippet
}

/// Finds all character match offsets in a single line.
/// Works completely on char sequences to prevent any UTF-8 slicing boundary panics.
fn find_matches_in_line(
    line: &str,
    query_chars: &[char],
    case_sensitive: bool,
) -> Vec<(usize, usize)> {
    let line_chars: Vec<char> = line.chars().collect();
    let q_len = query_chars.len();
    if q_len == 0 || line_chars.len() < q_len {
        return Vec::new();
    }

    let mut matches = Vec::new();
    let mut i = 0;
    while i + q_len <= line_chars.len() {
        let is_match = if case_sensitive {
            line_chars[i..i + q_len] == *query_chars
        } else {
            line_chars[i..i + q_len]
                .iter()
                .zip(query_chars.iter())
                .all(|(lc, qc)| lc.to_lowercase().eq(qc.to_lowercase()))
        };

        if is_match {
            matches.push((i, q_len));
            i += q_len.max(1);
        } else {
            i += 1;
        }
    }

    matches
}

struct FileSearchResults {
    matches: Vec<LinkedFolderSearchMatch>,
    has_more: bool,
}

fn search_file_content(
    relative_path: &str,
    content: &str,
    query_chars: &[char],
    case_sensitive: bool,
    max_file_matches: usize,
) -> FileSearchResults {
    let mut matches = Vec::new();
    let mut has_more = false;

    for (line_idx, raw_line) in content.lines().enumerate() {
        let line_num = line_idx + 1;
        let clean_line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        if clean_line.is_empty() {
            continue;
        }

        let line_matches = find_matches_in_line(clean_line, query_chars, case_sensitive);
        for (char_idx, match_char_len) in line_matches {
            if matches.len() >= max_file_matches {
                has_more = true;
                break;
            }

            let snippet = make_snippet(clean_line, char_idx);
            matches.push(LinkedFolderSearchMatch {
                relative_path: relative_path.to_string(),
                line_number: line_num,
                column_number: char_idx + 1,
                match_length: match_char_len,
                line_content: snippet,
            });
        }

        if has_more {
            break;
        }
    }

    FileSearchResults { matches, has_more }
}

fn has_hidden_component(rel: &Path) -> bool {
    rel.components().any(|c| match c {
        Component::Normal(os) => os.to_string_lossy().starts_with('.'),
        _ => false,
    })
}

fn to_forward_slash_relative(rel: &Path, fallback: &str) -> String {
    rel.to_str()
        .map(|s| s.replace('\\', "/"))
        .unwrap_or_else(|| fallback.to_string())
}

pub fn search_linked_folder_root(
    folder_id: &str,
    root: &Path,
    query: &str,
    case_sensitive: bool,
) -> Result<LinkedFolderSearchResult, String> {
    search_linked_folder_root_with_cancel(folder_id, root, query, case_sensitive, || false)
}

pub fn search_linked_folder_root_with_cancel(
    folder_id: &str,
    root: &Path,
    query: &str,
    case_sensitive: bool,
    is_cancelled: impl Fn() -> bool,
) -> Result<LinkedFolderSearchResult, String> {
    let trimmed_query = query.trim();
    if trimmed_query.is_empty() {
        return Ok(LinkedFolderSearchResult {
            folder_id: folder_id.to_string(),
            query: query.to_string(),
            matches: Vec::new(),
            files_searched: 0,
            files_skipped: 0,
            truncated: false,
        });
    }

    if is_cancelled() {
        return Err(LINKED_SEARCH_CANCELLED.to_string());
    }

    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let query_chars: Vec<char> = trimmed_query.chars().collect();

    let mut matches = Vec::new();
    let mut files_searched = 0;
    let mut files_skipped = 0;
    let mut total_bytes_read: u64 = 0;
    let mut truncated = false;

    let mut visited_dirs: HashSet<PathBuf> = HashSet::new();
    let mut dirs_to_visit: Vec<(PathBuf, PathBuf)> = vec![(root.clone(), root.clone())];

    'search_loop: while let Some((walked_dir, canonical_dir)) = dirs_to_visit.pop() {
        if is_cancelled() {
            return Err(LINKED_SEARCH_CANCELLED.to_string());
        }

        if !visited_dirs.insert(canonical_dir.clone()) {
            continue;
        }

        let dir_rel = match walked_dir.strip_prefix(&root) {
            Ok(rel) => rel,
            Err(_) => continue,
        };
        let dir_depth = dir_rel.components().count();
        if dir_depth >= MAX_RELATIVE_DEPTH {
            continue;
        }

        let Ok(read_dir) = fs::read_dir(&walked_dir) else {
            continue;
        };

        let mut entries = Vec::new();
        for entry in read_dir {
            if let Ok(e) = entry {
                entries.push(e);
            }
        }

        // Sort entries deterministically by filename
        entries.sort_by(|a, b| a.file_name().cmp(&b.file_name()));

        for entry in &entries {
            if is_cancelled() {
                return Err(LINKED_SEARCH_CANCELLED.to_string());
            }

            let file_name = match entry.file_name().into_string() {
                Ok(name) => name,
                Err(_) => continue,
            };

            // Skip hidden files/directories (starting with `.`)
            if file_name.starts_with('.') {
                continue;
            }

            let walked_path = entry.path();
            let Ok(canonical) = fs::canonicalize(&walked_path) else {
                files_skipped += 1;
                continue;
            };

            // Strictly prevent symlink escapes outside the approved root
            let Ok(canonical_rel) = canonical.strip_prefix(&root) else {
                continue;
            };

            // Also reject symlinks whose canonical target lives under a hidden component
            if has_hidden_component(canonical_rel) {
                continue;
            }

            if canonical.is_dir() {
                if !visited_dirs.contains(&canonical) && dir_depth + 1 < MAX_RELATIVE_DEPTH {
                    dirs_to_visit.push((walked_path, canonical));
                }
                continue;
            }

            if !canonical.is_file() || !is_sql_file_name(&file_name) {
                continue;
            }

            // Ensure symlink target also has an allowed SQL extension (blocks e.g. x.sql -> notes.txt)
            let target_is_sql = canonical
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(is_sql_file_name);
            if !target_is_sql {
                continue;
            }

            if files_searched >= MAX_FILES_SEARCHED || total_bytes_read >= MAX_TOTAL_BYTES_READ {
                truncated = true;
                break 'search_loop;
            }

            let Ok(meta) = fs::metadata(&canonical) else {
                files_skipped += 1;
                continue;
            };

            if meta.len() > MAX_SQL_FILE_BYTES {
                files_skipped += 1;
                continue;
            }

            let Ok(content) = fs::read_to_string(&canonical) else {
                files_skipped += 1;
                continue;
            };

            files_searched += 1;
            total_bytes_read = total_bytes_read.saturating_add(meta.len());

            let rel_path_str = match walked_path.strip_prefix(&root) {
                Ok(rel) => to_forward_slash_relative(rel, &file_name),
                Err(_) => file_name.clone(),
            };

            if matches.len() >= MAX_SEARCH_RESULTS {
                let probe = search_file_content(&rel_path_str, &content, &query_chars, case_sensitive, 1);
                if !probe.matches.is_empty() || probe.has_more {
                    truncated = true;
                    break 'search_loop;
                }
                continue;
            }

            let remaining_budget = MAX_SEARCH_RESULTS - matches.len();
            let limit_for_file = MAX_MATCHES_PER_FILE.min(remaining_budget);

            let file_results = search_file_content(
                &rel_path_str,
                &content,
                &query_chars,
                case_sensitive,
                limit_for_file,
            );

            if file_results.has_more {
                truncated = true;
            }

            matches.extend(file_results.matches);
        }
    }

    Ok(LinkedFolderSearchResult {
        folder_id: folder_id.to_string(),
        query: trimmed_query.to_string(),
        matches,
        files_searched,
        files_skipped,
        truncated,
    })
}

pub fn search_linked_folder(
    store: &Path,
    folder_id: &str,
    query: &str,
    case_sensitive: bool,
) -> Result<LinkedFolderSearchResult, String> {
    let gen = begin_search_generation();
    let root = linked_git_root(store, folder_id)?;
    search_linked_folder_root_with_cancel(folder_id, &root, query, case_sensitive, || {
        !is_search_generation_current(gen)
    })
}

#[cfg(test)]
#[path = "linked_folder_search_tests.rs"]
mod tests;
