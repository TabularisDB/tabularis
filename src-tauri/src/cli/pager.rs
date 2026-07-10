//! Piping long output through a pager, psql-style.
//!
//! Table-like query results go through `$TABULARIS_PAGER`, `$PAGER` or
//! `less -RSFX` when stdout is an interactive terminal and the output is long
//! enough to scroll away. Piped/redirected output is never paged, so
//! `tabularis query … > out.txt` stays byte-exact.

use std::io::{IsTerminal, Write};
use std::process::{Command, Stdio};

/// Outputs shorter than this never engage the pager. It matches the smallest
/// common terminal height; longer output is delegated to the pager, which
/// (with `less -F`) still exits immediately when the text fits the real
/// screen.
const PAGER_MIN_LINES: usize = 24;

/// Decide whether `text` should go through the pager.
pub fn should_page(text: &str, enabled: bool, stdout_is_tty: bool) -> bool {
    enabled && stdout_is_tty && text.lines().count() >= PAGER_MIN_LINES
}

/// Resolve the pager command line from the given environment values:
/// `$TABULARIS_PAGER` wins over `$PAGER`, a set-but-blank value disables
/// paging, and the fallback is `less -RSFX` (`-F`: quit if one screen,
/// `-S`: chop long table rows instead of wrapping, `-X`: no screen clear).
pub fn pager_command_from(
    tabularis_pager: Option<&str>,
    pager: Option<&str>,
) -> Option<Vec<String>> {
    let value = match (tabularis_pager, pager) {
        (Some(v), _) | (None, Some(v)) => v,
        (None, None) => "less -RSFX",
    };
    let parts: Vec<String> = value.split_whitespace().map(String::from).collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts)
    }
}

fn pager_command() -> Option<Vec<String>> {
    let tabularis_pager = std::env::var("TABULARIS_PAGER").ok();
    let pager = std::env::var("PAGER").ok();
    pager_command_from(tabularis_pager.as_deref(), pager.as_deref())
}

/// Print `text` followed by a newline, going through the pager when the
/// output is long and stdout is an interactive terminal. Every pager problem
/// (disabled, unresolvable, spawn failure) falls back to plain printing.
pub fn print_paged(text: &str, enabled: bool) {
    if !should_page(text, enabled, std::io::stdout().is_terminal()) {
        println!("{}", text);
        return;
    }
    let Some(command) = pager_command() else {
        println!("{}", text);
        return;
    };

    match Command::new(&command[0])
        .args(&command[1..])
        .stdin(Stdio::piped())
        .spawn()
    {
        Ok(mut child) => {
            if let Some(mut stdin) = child.stdin.take() {
                // Write errors (EPIPE) just mean the user quit the pager early.
                let _ = stdin.write_all(text.as_bytes());
                let _ = stdin.write_all(b"\n");
            }
            let _ = child.wait();
        }
        Err(e) => {
            log::debug!("Failed to spawn pager {:?}: {}", command, e);
            println!("{}", text);
        }
    }
}
