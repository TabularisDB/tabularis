//! Expansion of environment variables and `~` inside user-entered paths.
//!
//! Users type SSH key paths like `%USERPROFILE%\ssh_keys\id_ed25519`,
//! `$HOME/.ssh/id_rsa` or `~/.ssh/id_rsa`, and expect them to work. Expansion
//! happens at *use* time, never when the path is saved: the stored value keeps
//! the variable in it, which is what lets the same profile work on a
//! colleague's machine — and matters doubly for the SSH profiles shared
//! through [`crate::team_share`].
//!
//! Every syntax is accepted on every platform, and `HOME`/`USERPROFILE` both
//! resolve to the home directory wherever the app runs, so a path written on
//! Windows still resolves on macOS and Linux.
//!
//! A name that resolves to nothing is left exactly as typed rather than
//! replaced with an empty string: the user then sees the unresolved variable
//! in the error instead of a silently broken path.

/// Expand `%VAR%`, `${VAR}`, `$VAR` and a leading `~` using the process
/// environment.
pub fn expand(raw: &str) -> String {
    let home = home_dir();
    expand_with(
        raw,
        |name| match name {
            // Cross-platform aliases: the home directory answers to both
            // spellings everywhere, so a shared profile survives the trip.
            "HOME" | "USERPROFILE" => home.clone().or_else(|| std::env::var(name).ok()),
            _ => std::env::var(name).ok(),
        },
        home.as_deref(),
    )
}

/// The user's home directory, whichever variable the platform sets.
fn home_dir() -> Option<String> {
    std::env::var("HOME")
        .ok()
        .or_else(|| std::env::var("USERPROFILE").ok())
        .filter(|value| !value.is_empty())
}

/// Pure core of [`expand`]: `lookup` resolves a variable name, `home` is what
/// a leading `~` stands for. Both are injected so this is testable without
/// touching the real environment.
pub fn expand_with<F>(raw: &str, lookup: F, home: Option<&str>) -> String
where
    F: Fn(&str) -> Option<String>,
{
    let chars: Vec<char> = raw.chars().collect();
    let mut out = String::with_capacity(raw.len());
    let mut i = 0;

    // A leading `~` only counts when it stands for the whole first segment,
    // so `~user/x` (another account's home, which we cannot resolve) and a
    // file literally named `~note.txt` are left alone.
    if let Some(home) = home {
        if chars.first() == Some(&'~')
            && chars.get(1).is_none_or(|c| *c == '/' || *c == '\\')
        {
            out.push_str(home);
            i = 1;
        }
    }

    while i < chars.len() {
        let consumed = match chars[i] {
            '%' => expand_percent(&chars, i, &lookup, &mut out),
            '$' => expand_dollar(&chars, i, &lookup, &mut out),
            _ => None,
        };
        match consumed {
            Some(next) => i = next,
            None => {
                out.push(chars[i]);
                i += 1;
            }
        }
    }
    out
}

/// `%NAME%`. Returns the index just past the closing `%` when it expanded.
fn expand_percent<F>(chars: &[char], start: usize, lookup: &F, out: &mut String) -> Option<usize>
where
    F: Fn(&str) -> Option<String>,
{
    let end = find(chars, start + 1, '%')?;
    let name: String = chars[start + 1..end].iter().collect();
    if !is_var_name(&name) {
        return None;
    }
    out.push_str(&lookup(&name)?);
    Some(end + 1)
}

/// `${NAME}` or `$NAME`.
fn expand_dollar<F>(chars: &[char], start: usize, lookup: &F, out: &mut String) -> Option<usize>
where
    F: Fn(&str) -> Option<String>,
{
    if chars.get(start + 1) == Some(&'{') {
        let end = find(chars, start + 2, '}')?;
        let name: String = chars[start + 2..end].iter().collect();
        if !is_var_name(&name) {
            return None;
        }
        out.push_str(&lookup(&name)?);
        return Some(end + 1);
    }

    let mut end = start + 1;
    while end < chars.len() && is_name_char(chars[end], end == start + 1) {
        end += 1;
    }
    if end == start + 1 {
        return None;
    }
    let name: String = chars[start + 1..end].iter().collect();
    out.push_str(&lookup(&name)?);
    Some(end)
}

fn find(chars: &[char], from: usize, needle: char) -> Option<usize> {
    (from..chars.len()).find(|i| chars[*i] == needle)
}

fn is_name_char(c: char, first: bool) -> bool {
    c == '_' || c.is_ascii_alphabetic() || (!first && c.is_ascii_digit())
}

fn is_var_name(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if is_name_char(c, true) => chars.all(|c| is_name_char(c, false)),
        _ => false,
    }
}
