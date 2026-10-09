//! Command-line argument parsing for the Tabularis binary.
//!
//! Keeping this in its own module means `lib.rs` does not have to know about
//! clap, and the flag surface (`--mcp`, `--debug`, `--explain`, `--help`,
//! `--version`) lives in one place.

use clap::Parser;

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
pub struct Args {
    /// Start in MCP Server mode (Model Context Protocol)
    #[arg(long)]
    pub mcp: bool,

    /// Enable debug logging (including sqlx queries and other dependencies)
    #[arg(long)]
    pub debug: bool,

    /// Open a Visual Explain window for a previously-saved EXPLAIN file
    /// (Postgres `EXPLAIN (FORMAT JSON)` output).
    #[arg(long, value_name = "FILE")]
    pub explain: Option<String>,
}

impl Args {
    /// Log level for this run: `Debug` with `--debug` (which also lets sqlx's
    /// query logging through), `Info` otherwise.
    pub fn log_level(&self) -> log::LevelFilter {
        if self.debug {
            log::LevelFilter::Debug
        } else {
            log::LevelFilter::Info
        }
    }

    fn defaults() -> Self {
        Self {
            mcp: false,
            debug: false,
            explain: None,
        }
    }
}

/// Parse the process arguments, with platform-friendly fallback behaviour.
///
/// - `--help` / `--version` surface as `Err(DisplayHelp|DisplayVersion)` with the
///   formatted message attached; let clap print them and exit cleanly.
/// - Any other parse failure falls back to defaults so that GUI launches (e.g.
///   macOS passing `-psn_*`) still reach the Tauri builder.
pub fn parse() -> Args {
    Args::try_parse().unwrap_or_else(|err| {
        if matches!(
            err.kind(),
            clap::error::ErrorKind::DisplayHelp | clap::error::ErrorKind::DisplayVersion
        ) {
            err.exit();
        }
        Args::defaults()
    })
}

#[cfg(test)]
#[path = "cli_tests.rs"]
mod tests;
