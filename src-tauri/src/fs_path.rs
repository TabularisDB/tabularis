use crate::models::DatabaseSelection;

/// Sanitize a pasted local filesystem path into something usable for open/exists checks.
///
/// This is the single cleanup entry point for SQLite / DuckDB / CSV / Excel / Parquet
/// (and other file/folder) connection paths. It:
/// 1. Removes BOM / zero-width characters
/// 2. Trims surrounding whitespace
/// 3. Strips a `file:` URI prefix when present
/// 4. Peels matching outer quotes (`"…"` `'…'` `` `…` `` and common curly/fullwidth pairs)
///
/// It does **not** delete characters from the middle of the path. Windows-illegal
/// chars like `<>:|?*` inside a name are left alone so we don't silently corrupt
/// a path; the OS / driver will report those.
pub fn sanitize_local_file_path(raw: &str) -> String {
    let without_invisible: String = raw.chars().filter(|c| !is_invisible_path_noise(*c)).collect();
    let mut current = without_invisible.trim().to_string();
    current = strip_file_uri_prefix(&current);
    current = current.trim().to_string();
    peel_outer_quotes(&current)
}

/// Alias kept for call sites that only need quote peeling; delegates to
/// [`sanitize_local_file_path`].
pub fn unwrap_quoted_path(raw: &str) -> String {
    sanitize_local_file_path(raw)
}

/// Sanitize every entry in a [`DatabaseSelection`].
pub fn unwrap_database_selection_paths(selection: &DatabaseSelection) -> DatabaseSelection {
    match selection {
        DatabaseSelection::Single(path) => {
            DatabaseSelection::Single(sanitize_local_file_path(path))
        }
        DatabaseSelection::Multiple(paths) => DatabaseSelection::Multiple(
            paths.iter().map(|p| sanitize_local_file_path(p)).collect(),
        ),
    }
}

fn is_invisible_path_noise(c: char) -> bool {
    matches!(
        c,
        '\u{FEFF}' // BOM
            | '\u{200B}' // ZERO WIDTH SPACE
            | '\u{200C}' // ZERO WIDTH NON-JOINER
            | '\u{200D}' // ZERO WIDTH JOINER
            | '\u{2060}' // WORD JOINER
            | '\u{00AD}' // SOFT HYPHEN
    )
}

fn strip_file_uri_prefix(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    if !lower.starts_with("file:") {
        return value.to_string();
    }

    // file:/path, file:///path, file://localhost/path
    let after_scheme = value.get(5..).unwrap_or("");
    let rest = after_scheme.trim_start_matches('/');
    // Windows: file:///C:/Users/... → C:/Users/...
    // Unix:    file:///home/u/...  → /home/u/...
    if rest.len() >= 2 {
        let bytes = rest.as_bytes();
        // Drive letter form: C:/ or C|\
        if bytes[0].is_ascii_alphabetic() && (bytes[1] == b':' || bytes[1] == b'|') {
            return rest.replace('|', ":");
        }
    }
    format!("/{}", rest.trim_start_matches('/'))
}

fn matching_quote_close(open: char) -> Option<char> {
    match open {
        '"' | '\'' | '`' => Some(open),
        '\u{201C}' => Some('\u{201D}'), // “ ”
        '\u{2018}' => Some('\u{2019}'), // ‘ ’
        '\u{201F}' => Some('\u{201D}'), // ‟ ”
        '\u{201B}' => Some('\u{2019}'), // ‛ ’
        '\u{FF02}' => Some('\u{FF02}'), // fullwidth "
        '\u{FF07}' => Some('\u{FF07}'), // fullwidth '
        '\u{00AB}' => Some('\u{00BB}'), // « »
        '\u{2039}' => Some('\u{203A}'), // ‹ ›
        _ => None,
    }
}

fn peel_outer_quotes(raw: &str) -> String {
    let mut current = raw.trim().to_string();
    loop {
        let trimmed = current.trim();
        let mut chars = trimmed.chars();
        let Some(open) = chars.next() else {
            return trimmed.to_string();
        };
        let Some(close_expected) = matching_quote_close(open) else {
            return trimmed.to_string();
        };
        let Some(close) = trimmed.chars().next_back() else {
            return trimmed.to_string();
        };
        if close != close_expected || trimmed.chars().count() < 2 {
            return trimmed.to_string();
        }
        let open_len = open.len_utf8();
        let close_len = close.len_utf8();
        if trimmed.len() < open_len + close_len {
            return trimmed.to_string();
        }
        current = trimmed[open_len..trimmed.len() - close_len].to_string();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaves_plain_paths_alone() {
        assert_eq!(
            sanitize_local_file_path(r"C:\Users\Administrator\Downloads\companies.db"),
            r"C:\Users\Administrator\Downloads\companies.db"
        );
        assert_eq!(sanitize_local_file_path("  /tmp/data.db  "), "/tmp/data.db");
    }

    #[test]
    fn strips_ascii_and_curly_quotes() {
        assert_eq!(
            sanitize_local_file_path(r#""C:\Users\Administrator\Downloads\companies.db""#),
            r"C:\Users\Administrator\Downloads\companies.db"
        );
        assert_eq!(
            sanitize_local_file_path("'C:/data/file.parquet'"),
            "C:/data/file.parquet"
        );
        assert_eq!(
            sanitize_local_file_path("`/home/u/sheet.xlsx`"),
            "/home/u/sheet.xlsx"
        );
        assert_eq!(
            sanitize_local_file_path("\u{201C}/tmp/a.csv\u{201D}"),
            "/tmp/a.csv"
        );
    }

    #[test]
    fn strips_nested_matching_quotes() {
        assert_eq!(sanitize_local_file_path(r#"'"/tmp/a.csv"'"#), "/tmp/a.csv");
        assert_eq!(sanitize_local_file_path(r#""""/tmp/a.csv""""#), "/tmp/a.csv");
    }

    #[test]
    fn strips_file_uri_and_invisible_noise() {
        assert_eq!(
            sanitize_local_file_path("file:///C:/Users/a/companies.db"),
            "C:/Users/a/companies.db"
        );
        assert_eq!(
            sanitize_local_file_path("file:///home/u/a.db"),
            "/home/u/a.db"
        );
        assert_eq!(
            sanitize_local_file_path("\u{FEFF}\u{200B}\"/tmp/a.db\""),
            "/tmp/a.db"
        );
    }

    #[test]
    fn ignores_unmatched_or_internal_quotes() {
        assert_eq!(sanitize_local_file_path(r#""/tmp/a.csv"#), r#""/tmp/a.csv"#);
        assert_eq!(
            sanitize_local_file_path(r#"C:\data\file"name.db"#),
            r#"C:\data\file"name.db"#
        );
        assert_eq!(sanitize_local_file_path(""), "");
        assert_eq!(sanitize_local_file_path("\""), "\"");
    }

    #[test]
    fn unwraps_database_selection_entries() {
        let single = DatabaseSelection::Single(r#"'/tmp/a.db'"#.into());
        assert_eq!(
            unwrap_database_selection_paths(&single).primary(),
            "/tmp/a.db"
        );

        let multi = DatabaseSelection::Multiple(vec![
            r#""/tmp/a.csv""#.into(),
            "`/tmp/b.parquet`".into(),
        ]);
        assert_eq!(
            unwrap_database_selection_paths(&multi).as_vec(),
            vec!["/tmp/a.csv".to_string(), "/tmp/b.parquet".to_string()]
        );
    }
}
