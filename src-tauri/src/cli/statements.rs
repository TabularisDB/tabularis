//! Splitting a SQL script into individual statements.
//!
//! The splitter understands just enough SQL lexing to never cut a statement
//! inside a string (`'…'`, `"…"`, `` `…` ``), a comment (`-- …`, `/* … */`
//! with nesting) or a Postgres dollar-quoted body (`$tag$ … $tag$`); a `;`
//! anywhere else ends the current statement. Everything is copied through
//! verbatim, so the returned statements are exactly what was written, minus
//! the terminating semicolons. Backslashes inside quotes are treated as
//! escapes (MySQL-style); strict-SQL scripts relying on a literal `\` right
//! before a closing quote should use doubled quotes instead.

/// Split `sql` into trimmed, non-empty statements. Statement-less fragments
/// (whitespace or comments only) are dropped, and a final statement without a
/// trailing `;` is included.
pub fn split_sql_statements(sql: &str) -> Vec<String> {
    let chars: Vec<char> = sql.chars().collect();
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        match c {
            ';' => {
                push_statement(&mut statements, &mut current);
                i += 1;
            }
            '\'' | '"' | '`' => i = copy_quoted(&chars, i, &mut current),
            '-' if chars.get(i + 1) == Some(&'-') => i = copy_line_comment(&chars, i, &mut current),
            '/' if chars.get(i + 1) == Some(&'*') => {
                i = copy_block_comment(&chars, i, &mut current)
            }
            '$' => i = copy_dollar_quoted(&chars, i, &mut current),
            _ => {
                current.push(c);
                i += 1;
            }
        }
    }
    push_statement(&mut statements, &mut current);
    statements
}

fn push_statement(statements: &mut Vec<String>, current: &mut String) {
    let statement = current.trim();
    if !statement.is_empty() && !is_comment_or_blank(statement) {
        statements.push(statement.to_string());
    }
    current.clear();
}

/// True when `statement` contains only whitespace and comments, i.e. nothing
/// a database server could execute.
fn is_comment_or_blank(statement: &str) -> bool {
    let chars: Vec<char> = statement.chars().collect();
    let mut i = 0;
    let mut sink = String::new();
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
        } else if c == '-' && chars.get(i + 1) == Some(&'-') {
            i = copy_line_comment(&chars, i, &mut sink);
        } else if c == '/' && chars.get(i + 1) == Some(&'*') {
            i = copy_block_comment(&chars, i, &mut sink);
        } else {
            return false;
        }
    }
    true
}

/// Copy a quoted span starting at `start` (which holds the quote character),
/// honouring doubled quotes (`''`, `""`, ``` `` ```) and, for `'`/`"`,
/// backslash escapes. Returns the index after the closing quote; an
/// unterminated quote consumes the rest of the input.
fn copy_quoted(chars: &[char], start: usize, out: &mut String) -> usize {
    let quote = chars[start];
    out.push(quote);
    let mut i = start + 1;
    while i < chars.len() {
        let c = chars[i];
        if c == '\\' && quote != '`' {
            out.push(c);
            i += 1;
            if i < chars.len() {
                out.push(chars[i]);
                i += 1;
            }
            continue;
        }
        if c == quote {
            if chars.get(i + 1) == Some(&quote) {
                out.push(c);
                out.push(c);
                i += 2;
                continue;
            }
            out.push(c);
            return i + 1;
        }
        out.push(c);
        i += 1;
    }
    i
}

/// Copy a `--` comment up to and including the newline that ends it.
fn copy_line_comment(chars: &[char], start: usize, out: &mut String) -> usize {
    let mut i = start;
    while i < chars.len() {
        out.push(chars[i]);
        if chars[i] == '\n' {
            return i + 1;
        }
        i += 1;
    }
    i
}

/// Copy a `/* … */` comment, honouring nesting (Postgres nests them).
fn copy_block_comment(chars: &[char], start: usize, out: &mut String) -> usize {
    out.push('/');
    out.push('*');
    let mut i = start + 2;
    let mut depth = 1usize;
    while i < chars.len() && depth > 0 {
        if chars[i] == '/' && chars.get(i + 1) == Some(&'*') {
            depth += 1;
            out.push('/');
            out.push('*');
            i += 2;
        } else if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
            depth -= 1;
            out.push('*');
            out.push('/');
            i += 2;
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    i
}

/// Copy a Postgres dollar-quoted span (`$$ … $$` or `$tag$ … $tag$`). When the
/// `$` at `start` does not open a valid delimiter (e.g. a `$1` placeholder),
/// it is copied as a plain character instead.
fn copy_dollar_quoted(chars: &[char], start: usize, out: &mut String) -> usize {
    // A delimiter is `$` + optional tag + `$`, where the tag must not start
    // with a digit (that is how `$1$` placeholders-ish text stays untouched).
    let mut j = start + 1;
    while j < chars.len() && (chars[j].is_ascii_alphanumeric() || chars[j] == '_') {
        j += 1;
    }
    let tag_starts_with_digit = chars
        .get(start + 1)
        .is_some_and(|c| c.is_ascii_digit() && j > start + 1);
    if chars.get(j) != Some(&'$') || tag_starts_with_digit {
        out.push('$');
        return start + 1;
    }

    let delimiter: Vec<char> = chars[start..=j].to_vec();
    out.extend(delimiter.iter());
    let mut i = j + 1;
    while i < chars.len() {
        if chars[i] == '$' && chars[i..].starts_with(&delimiter[..]) {
            out.extend(delimiter.iter());
            return i + delimiter.len();
        }
        out.push(chars[i]);
        i += 1;
    }
    i
}
