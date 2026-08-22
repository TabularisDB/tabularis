//! Command-line argument parsing for the Tabularis binary.
//!
//! Keeping this in its own module means `lib.rs` does not have to know about
//! clap, and the command surface (`--mcp`, `web`, `--debug`, `--explain`,
//! `--help`, `--version`) lives in one place.

use clap::{Args as ClapArgs, Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

#[cfg(test)]
mod tests;

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub enum WebAuthMode {
    /// Authenticate remote users with a password.
    Password,
    /// Trust authentication performed by a configured reverse proxy.
    Proxy,
}

#[derive(Parser, Debug)]
#[command(version, about, long_about = None, args_conflicts_with_subcommands = true)]
pub struct Args {
    /// Start in MCP Server mode (Model Context Protocol)
    #[arg(long)]
    pub mcp: bool,

    #[command(subcommand)]
    pub command: Option<Command>,

    /// Enable debug logging (including sqlx queries)
    #[arg(long, global = true)]
    pub debug: bool,

    /// Open a Visual Explain window for a previously-saved EXPLAIN file
    /// (Postgres `EXPLAIN (FORMAT JSON)` output).
    #[arg(long, value_name = "FILE")]
    pub explain: Option<String>,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Start the browser-based Web UI
    Web(WebArgs),
}

#[derive(Debug, ClapArgs)]
pub struct WebArgs {
    /// Address for the Web UI server to bind
    #[arg(long, value_name = "HOST", default_value = "127.0.0.1")]
    pub host: String,

    /// Port for the Web UI server to bind
    #[arg(long, value_name = "PORT", default_value_t = 8080)]
    pub port: u16,

    /// Do not open the Web UI in the default browser
    #[arg(long)]
    pub no_open: bool,

    /// Override the directory containing built Web UI assets
    #[arg(long, value_name = "PATH")]
    pub web_root: Option<PathBuf>,

    /// Authentication mode for explicitly configured remote Web UI access
    #[arg(
        long,
        value_name = "MODE",
        value_enum,
        requires_all = ["public_url", "allowed_origins"]
    )]
    pub auth: Option<WebAuthMode>,

    /// Public HTTPS origin used by browsers through the trusted reverse proxy
    #[arg(long, value_name = "URL", requires = "auth")]
    pub public_url: Option<String>,

    /// Browser origin allowed to access remote Web UI sessions; repeat as needed
    #[arg(
        long = "allowed-origin",
        value_name = "ORIGIN",
        action = clap::ArgAction::Append,
        requires = "auth"
    )]
    pub allowed_origins: Vec<String>,

    /// Grant remote sessions high-risk local-administrator capabilities
    #[arg(long, requires = "auth")]
    pub allow_high_risk: bool,
}

impl Args {
    fn defaults() -> Self {
        Self {
            mcp: false,
            command: None,
            debug: false,
            explain: None,
        }
    }
}

/// Parse the process arguments, with platform-friendly fallback behaviour.
///
/// Platform launch metadata (for example macOS `-psn_*` arguments or a
/// registered `tabularis:` URL) falls back to desktop defaults. User-facing
/// parse failures, including mode conflicts, are printed by clap and exit.
pub fn parse() -> Args {
    try_parse_from(std::env::args_os()).unwrap_or_else(|err| err.exit())
}

fn try_parse_from<I, T>(arguments: I) -> Result<Args, clap::Error>
where
    I: IntoIterator<Item = T>,
    T: Into<std::ffi::OsString>,
{
    let arguments: Vec<std::ffi::OsString> = arguments.into_iter().map(Into::into).collect();
    match Args::try_parse_from(arguments.clone()) {
        Err(_) if has_only_platform_launch_arguments(&arguments) => Ok(Args::defaults()),
        result => result,
    }
}

fn has_only_platform_launch_arguments(arguments: &[std::ffi::OsString]) -> bool {
    let mut launch_arguments = arguments.iter().skip(1);
    let Some(first) = launch_arguments.next() else {
        return false;
    };

    std::iter::once(first)
        .chain(launch_arguments)
        .all(|argument| {
            argument
                .to_str()
                .is_some_and(|value| value.starts_with("-psn_") || value.starts_with("tabularis:"))
        })
}
