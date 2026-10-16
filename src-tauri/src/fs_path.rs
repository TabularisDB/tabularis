use crate::models::DatabaseSelection;

/// Sanitize a pasted local filesystem path into something usable for open/exists checks.
///
/// This is the single cleanup entry point for SQLite / DuckDB / CSV / Excel / Parquet
/// (and other file/folder) connection paths. It:
/// 1. Removes BOM / zero-width characters
/// 2. Trims surrounding whitespace and peels matching outer quotes
///    (`"…"` `'…'` `` `…` `` and common curly/fullwidth pairs)
/// 3. Converts a `file:` URI into a local path (authority and percent-encoding
///    are handled by the `url` parser)
///
/// It does **not** delete characters from the middle of the path. Windows-illegal
/// chars like `<>:|?*` inside a name are left alone so we don't silently corrupt
/// a path; the OS / driver will report those.
pub fn sanitize_local_file_path(raw: &str) -> String {
    let without_invisible: String = raw
        .chars()
        .filter(|c| !is_invisible_path_noise(*c))
        .collect();
    let unquoted = peel_outer_quotes(&without_invisible);
    match file_uri_to_path(&unquoted) {
        Some(path) => peel_outer_quotes(&path),
        None => unquoted,
    }
}

/// Sanitize every entry in a [`DatabaseSelection`].
pub fn sanitize_database_selection(selection: &DatabaseSelection) -> DatabaseSelection {
    match selection {
        DatabaseSelection::Single(path) => {
            DatabaseSelection::Single(sanitize_local_file_path(path))
        }
        DatabaseSelection::Multiple(paths) => {
            DatabaseSelection::Multiple(paths.iter().map(|p| sanitize_local_file_path(p)).collect())
        }
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

/// Convert a `file:` URI into a local path, or `None` when `value` is not one.
///
/// Handles `file:/p`, `file:///p`, `file://localhost/p` (the WHATWG parser drops
/// the `localhost` authority), UNC-style `file://server/share/p` (→ `//server/share/p`),
/// Windows drive letters (`file:///C:/p` → `C:/p`) and percent-encoding.
/// The conversion is done by hand on top of the parsed URL instead of
/// `Url::to_file_path` so the result is the same on every host OS.
pub(crate) fn file_uri_to_path(value: &str) -> Option<String> {
    let scheme = value.get(..5)?;
    if !scheme.eq_ignore_ascii_case("file:") {
        return None;
    }
    let url = url::Url::parse(value).ok()?;
    let path = urlencoding::decode(url.path())
        .map(|p| p.into_owned())
        .unwrap_or_else(|_| url.path().to_string());

    let bytes = path.as_bytes();
    if bytes.len() >= 3
        && bytes[0] == b'/'
        && bytes[1].is_ascii_alphabetic()
        && (bytes[2] == b':' || bytes[2] == b'|')
    {
        return Some(format!("{}:{}", &path[1..2], &path[3..]));
    }

    match url.host_str() {
        Some(host) if !host.is_empty() => Some(format!("//{host}{path}")),
        _ => Some(path),
    }
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
    let mut current = raw.trim();
    loop {
        let mut chars = current.chars();
        let (Some(open), Some(close)) = (chars.next(), chars.next_back()) else {
            return current.to_string();
        };
        if matching_quote_close(open) != Some(close) {
            return current.to_string();
        }
        current = current[open.len_utf8()..current.len() - close.len_utf8()].trim();
    }
}
