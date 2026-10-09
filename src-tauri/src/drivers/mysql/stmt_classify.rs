/// For `CREATE [OR REPLACE] DEFINER = …` statements the object-type
/// keyword (`PROCEDURE`/`FUNCTION`/`VIEW`/`TRIGGER`/`EVENT`/`TABLE`)
/// follows the definer clause. Returns the slice starting at that
/// keyword, or `None` if the definer clause cannot be skipped.
///
/// The definer value is NOT always a single token: MySQL accepts spaced
/// quoted forms such as `'root' @ 'localhost'`, backtick-quoted
/// identifiers like `` `root`@`localhost` ``, bare `user@host`, and
/// `CURRENT_USER` / `CURRENT_USER()`. Splitting on the first whitespace
/// would stop inside a spaced definer and mistake the host part for the
/// object keyword, so we scan the remainder character by character —
/// tracking single-quote, double-quote, backtick and paren state — and
/// stop at the first top-level object-type keyword that appears outside
/// any quoting and outside parentheses. A keyword is only accepted when
/// followed by whitespace or end-of-string, so a username like
/// `procedure@localhost` is not mistaken for the `PROCEDURE` keyword.
pub(super) fn after_definer_clause(head: &str) -> Option<&str> {
    // `head` is already uppercased and known to start with
    // `CREATE [OR REPLACE] DEFINER`, so a plain `find` is sufficient
    // here — there is no risk of matching `DEFINER` inside a quoted
    // body before the clause itself.
    let definer_idx = head.find("DEFINER")?;
    let after_eq = head[definer_idx + "DEFINER".len()..]
        .trim_start()
        .strip_prefix('=')?
        .trim_start();
    find_first_top_level_object_keyword(after_eq)
}

/// Scans `s` character by character, tracking single-quote, double-quote,
/// backtick and paren depth, and returns the slice starting at the first
/// top-level object-type keyword (`PROCEDURE`, `FUNCTION`, `VIEW`,
/// `TRIGGER`, `EVENT`, `TABLE`) that is followed by whitespace or
/// end-of-string. Returns `None` when no such keyword appears at the top
/// level before the string ends. This keeps the scan focused on the
/// statement head and avoids re-introducing the full-statement
/// `contains` overmatching that would fire on `PROCEDURE`/`FUNCTION`
/// words appearing inside a VIEW's `SELECT` body.
pub(super) fn find_first_top_level_object_keyword(s: &str) -> Option<&str> {
    const KEYWORDS: &[&str] = &["PROCEDURE", "FUNCTION", "VIEW", "TRIGGER", "EVENT", "TABLE"];
    let bytes = s.as_bytes();
    let mut i = 0;
    let mut in_single = false;
    let mut in_double = false;
    let mut in_backtick = false;
    let mut paren: u32 = 0;
    let mut word_start: Option<usize> = None;

    while i < bytes.len() {
        let c = bytes[i];

        if in_single {
            if c == b'\'' {
                in_single = false;
            }
            i += 1;
            continue;
        }
        if in_double {
            if c == b'"' {
                in_double = false;
            }
            i += 1;
            continue;
        }
        if in_backtick {
            if c == b'`' {
                in_backtick = false;
            }
            i += 1;
            continue;
        }

        if paren > 0 {
            match c {
                b'\'' => in_single = true,
                b'"' => in_double = true,
                b'`' => in_backtick = true,
                b'(' => paren += 1,
                b')' => paren -= 1,
                _ => {}
            }
            i += 1;
            continue;
        }

        match c {
            b'\'' => {
                in_single = true;
                i += 1;
                continue;
            }
            b'"' => {
                in_double = true;
                i += 1;
                continue;
            }
            b'`' => {
                in_backtick = true;
                i += 1;
                continue;
            }
            b'(' => {
                paren += 1;
                i += 1;
                continue;
            }
            b')' => {
                i += 1;
                continue;
            }
            _ => {}
        }

        if c.is_ascii_alphanumeric() || c == b'_' {
            if word_start.is_none() {
                word_start = Some(i);
            }
            i += 1;
            continue;
        }

        if let Some(start) = word_start.take() {
            let word = &s[start..i];
            if KEYWORDS.contains(&word) && is_keyword_boundary(bytes, i) {
                return Some(&s[start..]);
            }
        }
        i += 1;
    }

    if let Some(start) = word_start.take() {
        let word = &s[start..];
        if KEYWORDS.contains(&word) {
            return Some(&s[start..]);
        }
    }
    None
}

/// Returns `true` when the byte at `idx` is a valid terminator for an
/// object-type keyword (whitespace or end-of-string). This prevents
/// matching a username like `procedure@localhost` as the `PROCEDURE`
/// keyword, since `@` is not a keyword boundary.
fn is_keyword_boundary(bytes: &[u8], idx: usize) -> bool {
    idx >= bytes.len() || bytes[idx].is_ascii_whitespace()
}

/// Returns `true` when a `CREATE [OR REPLACE] DEFINER = …` statement's
/// object-type keyword — the first top-level object keyword after the
/// definer clause — is `PROCEDURE` or `FUNCTION`. This is tighter than
/// `contains` over the full statement, which would overmatch when a
/// VIEW's `SELECT` body mentions ` PROCEDURE`/` FUNCTION`, and it
/// tolerates spaced definer forms such as `'root' @ 'localhost'`.
pub(super) fn definer_stmt_is_routine(head: &str) -> bool {
    matches!(
        after_definer_clause(head).and_then(|rest| rest.split_whitespace().next()),
        Some("PROCEDURE" | "FUNCTION")
    )
}

/// Returns `true` when the leading whitespace-delimited tokens of `head`
/// match `keywords` in order. A token matches a keyword when it is exactly
/// the keyword, or begins with the keyword immediately followed by a
/// non-identifier character (e.g. `=` or `(`). This is whitespace-normalized
/// (so `CREATE  DEFINER` and `CREATE OR  REPLACE` route correctly) while
/// still accepting the common `DEFINER=\`root\`@\`localhost\`` form where
/// `=` is glued to `DEFINER` with no surrounding whitespace — a plain
/// `split_whitespace().eq(...)` would treat `DEFINER=…` as one token and
/// miss it. `DEFINERX` is rejected because `X` is an identifier character.
fn starts_with_keywords(head: &str, keywords: &[&str]) -> bool {
    let mut tokens = head.split_whitespace();
    for kw in keywords {
        let Some(tok) = tokens.next() else {
            return false;
        };
        if !token_matches(tok, kw) {
            return false;
        }
    }
    true
}

fn token_matches(tok: &str, kw: &str) -> bool {
    if tok == kw {
        return true;
    }
    match tok.strip_prefix(kw) {
        None => false,
        Some(rest) => rest.chars().next().map_or(true, |c| {
            !(c.is_ascii_alphanumeric() || c == '_')
        }),
    }
}

pub(super) fn is_text_protocol_stmt(query: &str) -> bool {
    let head = crate::drivers::common::strip_leading_sql_comments(query).to_uppercase();
    let is_create_definer_routine =
        starts_with_keywords(&head, &["CREATE", "DEFINER"]) && definer_stmt_is_routine(&head);
    // MariaDB allows `CREATE OR REPLACE [DEFINER = …] PROCEDURE|FUNCTION`,
    // which is likewise rejected by the prepared-statement protocol. MySQL
    // does NOT support `OR REPLACE` for routines, but the same text-protocol
    // routing applies whenever such a statement is submitted against a
    // MariaDB backend.
    let is_create_or_replace_routine =
        starts_with_keywords(&head, &["CREATE", "OR", "REPLACE", "DEFINER"])
            && definer_stmt_is_routine(&head);

    head.starts_with("BEGIN")
        || head.starts_with("START TRANSACTION")
        || head.starts_with("COMMIT")
        || head.starts_with("ROLLBACK")
        || head.starts_with("SAVEPOINT")
        || head.starts_with("RELEASE SAVEPOINT")
        || head.starts_with("LOCK TABLES")
        || head.starts_with("UNLOCK TABLES")
        || head.starts_with("DROP PROCEDURE")
        || head.starts_with("CREATE PROCEDURE")
        || head.starts_with("ALTER PROCEDURE")
        || head.starts_with("DROP FUNCTION")
        || head.starts_with("CREATE FUNCTION")
        || head.starts_with("ALTER FUNCTION")
        // Token-based (whitespace-normalized) so repeated whitespace such
        // as `CREATE OR  REPLACE PROCEDURE` still routes correctly — the
        // fragile `starts_with` form would miss the double space.
        || starts_with_keywords(&head, &["CREATE", "OR", "REPLACE", "PROCEDURE"])
        || starts_with_keywords(&head, &["CREATE", "OR", "REPLACE", "FUNCTION"])
        || is_create_definer_routine
        || is_create_or_replace_routine
}
