//! Command-line interface for the Tabularis binary.
//!
//! Keeping this in its own module means `lib.rs` does not have to know about
//! clap. The surface is split across focused submodules:
//! - argument/subcommand definitions and parsing live here,
//! - subcommand execution lives in [`run`],
//! - result formatting (table/json/csv) lives in [`output`],
//! - the interactive SQL shell lives in [`repl`].

use clap::{Parser, Subcommand, ValueEnum};

pub mod complete;
pub mod install;
pub mod output;
pub mod pager;
pub mod repl;
pub mod run;
pub mod statements;

#[cfg(test)]
pub mod args_tests;
#[cfg(test)]
pub mod complete_tests;
#[cfg(all(test, unix))]
pub mod install_tests;
#[cfg(test)]
pub mod output_tests;
#[cfg(test)]
pub mod pager_tests;
#[cfg(test)]
pub mod run_tests;
#[cfg(test)]
pub mod statements_tests;

pub use run::run_command;

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
pub struct Args {
    /// Start in MCP Server mode (Model Context Protocol)
    #[arg(long)]
    pub mcp: bool,

    /// Enable debug logging (including sqlx queries)
    #[arg(long)]
    pub debug: bool,

    /// Open a Visual Explain window for a previously-saved EXPLAIN file
    /// (Postgres `EXPLAIN (FORMAT JSON)` output).
    #[arg(long, value_name = "FILE")]
    pub explain: Option<String>,

    /// Terminal subcommand; when present the GUI is never started.
    #[command(subcommand)]
    pub command: Option<CliCommand>,
}

/// Output format for query results.
#[derive(ValueEnum, Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputFormat {
    /// Aligned ASCII table (psql-like)
    Table,
    /// One block per record with `column | value` lines (psql `\x` style)
    Expanded,
    /// JSON array of row objects
    Json,
    /// RFC 4180 CSV with a header row
    Csv,
}

#[derive(Subcommand, Debug)]
pub enum CliCommand {
    /// List saved database connections
    #[command(visible_alias = "ls")]
    Connections {
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },

    /// List databases available on a connection
    Databases {
        /// Connection ID or name
        connection: String,
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },

    /// List schemas on a connection
    Schemas {
        /// Connection ID or name
        connection: String,
        /// Database to target (multi-database connections default to the first one)
        #[arg(long, short = 'd')]
        database: Option<String>,
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },

    /// List tables on a connection
    Tables {
        /// Connection ID or name
        connection: String,
        /// Database to target (multi-database connections default to the first one)
        #[arg(long, short = 'd')]
        database: Option<String>,
        /// Schema name (defaults to the driver's default schema)
        #[arg(long)]
        schema: Option<String>,
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },

    /// Show columns, indexes and foreign keys of a table
    Describe {
        /// Connection ID or name
        connection: String,
        /// Table name
        table: String,
        /// Database to target (multi-database connections default to the first one)
        #[arg(long, short = 'd')]
        database: Option<String>,
        /// Schema name (defaults to the driver's default schema)
        #[arg(long)]
        schema: Option<String>,
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },

    /// Execute a SQL query, or open an interactive shell when no SQL is given
    #[command(visible_alias = "q")]
    Query {
        /// Connection ID or name
        connection: String,
        /// SQL to execute. When omitted, opens an interactive shell
        /// (or reads the SQL from stdin when piped)
        sql: Option<String>,
        /// Read the SQL from a file instead; every `;`-terminated statement
        /// in it runs in order, stopping at the first error
        #[arg(long, short = 'f', value_name = "FILE", conflicts_with = "sql")]
        file: Option<std::path::PathBuf>,
        /// Database to target (multi-database connections default to the
        /// first one; changeable inside the shell with \use)
        #[arg(long, short = 'd')]
        database: Option<String>,
        /// Maximum number of rows to return (0 = unlimited)
        #[arg(long, default_value_t = 100)]
        limit: u32,
        /// Output format (changeable inside the shell with \f)
        #[arg(long, value_enum, default_value_t = OutputFormat::Table)]
        format: OutputFormat,
        /// Schema name (defaults to the driver's default schema)
        #[arg(long)]
        schema: Option<String>,
    },

    /// Install the 'tabularis' command into your PATH
    InstallCli {
        /// Target bin directory (defaults to /usr/local/bin, then ~/.local/bin)
        #[arg(long, value_name = "DIR")]
        dir: Option<std::path::PathBuf>,
        /// Replace an existing 'tabularis' entry in the target directory
        #[arg(long)]
        force: bool,
    },
}

impl Args {
    fn defaults() -> Self {
        Self {
            mcp: false,
            debug: false,
            explain: None,
            command: None,
        }
    }
}

/// Parse the process arguments, with platform-friendly fallback behaviour.
///
/// - `--help` / `--version` surface as `Err(DisplayHelp|DisplayVersion)` with the
///   formatted message attached; let clap print them and exit cleanly.
/// - Unknown arguments fall back to defaults so that GUI launches (e.g.
///   macOS passing `-psn_*`) still reach the Tauri builder.
/// - Every other parse failure (misspelled subcommand, missing required
///   argument, bad flag value) is a CLI mistake: print clap's error and exit
///   instead of silently opening the GUI.
pub fn parse() -> Args {
    Args::try_parse().unwrap_or_else(|err| match err.kind() {
        clap::error::ErrorKind::UnknownArgument => Args::defaults(),
        _ => err.exit(),
    })
}
