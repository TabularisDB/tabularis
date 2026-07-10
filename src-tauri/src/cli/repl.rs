//! Interactive SQL shell (`tabularis query <connection>`).
//!
//! Reads SQL statements terminated by `;` (multi-line input supported) and
//! psql-style backslash meta commands, executing them against the resolved
//! driver. Line editing, persistent history and tab completion come from
//! rustyline; completion candidates are filled in the background by
//! [`super::complete::spawn_catalog_refresh`].

use super::complete::{spawn_catalog_refresh, Catalog, ShellHelper};
use super::run::{effective_limit, override_database, print_query_result};
use super::{output, statements, OutputFormat};
use crate::drivers::driver_trait::DatabaseDriver;
use crate::headless;
use crate::models::{ConnectionParams, DatabaseSelection};
use rustyline::error::ReadlineError;
use rustyline::history::DefaultHistory;
use rustyline::Editor;
use std::sync::{Arc, RwLock};
use std::time::Instant;

const HISTORY_FILE: &str = "cli_history.txt";

struct ShellState {
    format: OutputFormat,
    limit: u32,
    schema: Option<String>,
    /// Page long table-like results through `$PAGER`/`less` (toggle: \pager).
    pager: bool,
    /// Include the current database in the prompt — on for multi-database
    /// connections and after a `\use` switch.
    show_db_in_prompt: bool,
    /// Shared with the rustyline helper; refreshed in the background on
    /// startup and after `\use`/`\schema` switches.
    catalog: Arc<RwLock<Catalog>>,
}

pub async fn run_shell(
    connection: &str,
    database: Option<String>,
    limit: u32,
    format: OutputFormat,
    schema: Option<String>,
) -> Result<(), String> {
    let (conn, mut params, driver) = headless::resolve_db_driver(connection).await?;
    let multi_db = conn.params.database.is_multi();
    let switched = database.is_some();
    override_database(&mut params, database);

    // Fail fast with a clear message instead of erroring on the first query.
    // `test_connection` (not `ping`): built-in drivers implement `ping` as a
    // check on an *existing* pool, which a fresh headless process never has.
    driver
        .test_connection(&params)
        .await
        .map_err(|e| format!("Could not connect to '{}': {}", conn.name, e))?;

    println!(
        "Connected to {} ({} — {})",
        conn.name,
        conn.params.driver,
        params.database.primary()
    );
    if multi_db {
        println!(
            "Databases on this connection: {} (switch with \\use <db>)",
            conn.params.database.as_vec().join(", ")
        );
    }
    println!("End SQL statements with ';'. Type \\? for help, \\q to quit.");

    let mut state = ShellState {
        format,
        limit,
        schema,
        pager: true,
        show_db_in_prompt: multi_db || switched,
        catalog: Arc::new(RwLock::new(Catalog::default())),
    };

    let mut editor: Editor<ShellHelper, DefaultHistory> =
        Editor::new().map_err(|e| e.to_string())?;
    editor.set_helper(Some(ShellHelper {
        catalog: state.catalog.clone(),
    }));
    spawn_catalog_refresh(
        state.catalog.clone(),
        driver.clone(),
        params.clone(),
        state.schema.clone(),
    );

    let history_path = crate::paths::get_app_config_dir().join(HISTORY_FILE);
    let _ = editor.load_history(&history_path);

    let mut buffer = String::new();
    loop {
        let prompt = if buffer.is_empty() {
            if state.show_db_in_prompt {
                format!("{}:{}> ", conn.name, params.database.primary())
            } else {
                format!("{}> ", conn.name)
            }
        } else {
            "... ".to_string()
        };

        match editor.readline(&prompt) {
            Ok(line) => {
                let trimmed = line.trim();
                if buffer.is_empty() {
                    if trimmed.is_empty() {
                        continue;
                    }
                    if trimmed.starts_with('\\')
                        || trimmed.eq_ignore_ascii_case("exit")
                        || trimmed.eq_ignore_ascii_case("quit")
                    {
                        let _ = editor.add_history_entry(trimmed);
                        if handle_meta(trimmed, &mut state, &mut params, &driver).await {
                            break;
                        }
                        continue;
                    }
                }

                buffer.push_str(&line);
                buffer.push('\n');

                if buffer.trim_end().ends_with(';') {
                    let statement = buffer.trim().to_string();
                    let _ = editor.add_history_entry(&statement);
                    buffer.clear();

                    let sql = statement.trim_end_matches(';').trim();
                    if sql.is_empty() {
                        continue;
                    }
                    execute_statement(sql, &state, &params, &driver).await;
                }
            }
            // Ctrl-C: drop any half-typed statement, keep the shell alive.
            Err(ReadlineError::Interrupted) => {
                buffer.clear();
            }
            // Ctrl-D: exit.
            Err(ReadlineError::Eof) => break,
            Err(e) => return Err(e.to_string()),
        }
    }

    if let Err(e) = editor.save_history(&history_path) {
        log::warn!("Failed to save shell history: {}", e);
    }
    println!("Bye");
    Ok(())
}

/// Execute one SQL statement and print its result or error.
async fn execute_statement(
    sql: &str,
    state: &ShellState,
    params: &ConnectionParams,
    driver: &Arc<dyn DatabaseDriver>,
) -> bool {
    let start = Instant::now();
    match driver
        .execute_query(
            params,
            sql,
            effective_limit(state.limit),
            1,
            state.schema.as_deref(),
        )
        .await
    {
        Ok(result) => {
            print_query_result(&result, state.format, start.elapsed(), state.pager);
            true
        }
        Err(e) => {
            print_error(&e);
            false
        }
    }
}

/// Run every statement of a SQL file (`\i <file>`), stopping at the first
/// error but keeping the shell alive.
async fn run_script(
    path: &str,
    state: &ShellState,
    params: &ConnectionParams,
    driver: &Arc<dyn DatabaseDriver>,
) {
    let script = match std::fs::read_to_string(path) {
        Ok(script) => script,
        Err(e) => {
            print_error(&format!("cannot read {}: {}", path, e));
            return;
        }
    };
    let statements = statements::split_sql_statements(&script);
    if statements.is_empty() {
        println!("No statements found in {}", path);
        return;
    }
    for (index, statement) in statements.iter().enumerate() {
        if !execute_statement(statement, state, params, driver).await {
            eprintln!(
                "(stopped at statement {} of {})",
                index + 1,
                statements.len()
            );
            return;
        }
    }
}

/// Handle a meta command. Returns `true` when the shell should exit.
async fn handle_meta(
    input: &str,
    state: &mut ShellState,
    params: &mut ConnectionParams,
    driver: &Arc<dyn DatabaseDriver>,
) -> bool {
    let mut parts = input.split_whitespace();
    let command = parts.next().unwrap_or("");
    let arg = parts.next();

    match command {
        "\\q" | "exit" | "quit" => return true,
        "\\?" | "\\h" | "\\help" => print_help(),
        "\\use" => match arg {
            Some(db) => {
                // Validate the switch on a throwaway copy so a typo'd
                // database name leaves the session on the current one.
                let mut candidate = params.clone();
                candidate.database = DatabaseSelection::Single(db.to_string());
                match driver.test_connection(&candidate).await {
                    Ok(()) => {
                        *params = candidate;
                        state.show_db_in_prompt = true;
                        spawn_catalog_refresh(
                            state.catalog.clone(),
                            driver.clone(),
                            params.clone(),
                            state.schema.clone(),
                        );
                        println!("Now using database {}", db);
                    }
                    Err(e) => print_error(&format!("cannot switch to {}: {}", db, e)),
                }
            }
            None => println!("Current database: {}", params.database.primary()),
        },
        "\\l" => match driver.get_databases(params).await {
            Ok(names) => print_name_list(&names),
            Err(e) => print_error(&e),
        },
        "\\dn" => match driver.get_schemas(params).await {
            Ok(names) => print_name_list(&names),
            Err(e) => print_error(&e),
        },
        "\\dt" => match driver.get_tables(params, state.schema.as_deref()).await {
            Ok(tables) => {
                let names: Vec<String> = tables.into_iter().map(|t| t.name).collect();
                print_name_list(&names);
            }
            Err(e) => print_error(&e),
        },
        "\\d" => match arg {
            Some(table) => describe_table(state, params, driver, table).await,
            None => eprintln!("Usage: \\d <table>"),
        },
        // The path is everything after the command, so paths with spaces work.
        "\\i" => match input["\\i".len()..].trim() {
            "" => eprintln!("Usage: \\i <file>"),
            path => run_script(path, state, params, driver).await,
        },
        "\\f" => match arg {
            Some("table") => state.format = OutputFormat::Table,
            Some("expanded") => state.format = OutputFormat::Expanded,
            Some("json") => state.format = OutputFormat::Json,
            Some("csv") => state.format = OutputFormat::Csv,
            _ => eprintln!("Usage: \\f <table|expanded|json|csv>"),
        },
        "\\x" => {
            if state.format == OutputFormat::Expanded {
                state.format = OutputFormat::Table;
                println!("Expanded display off");
            } else {
                state.format = OutputFormat::Expanded;
                println!("Expanded display on");
            }
        }
        "\\limit" => match arg.and_then(|a| a.parse::<u32>().ok()) {
            Some(n) => {
                state.limit = n;
                if n == 0 {
                    println!("Row limit disabled");
                } else {
                    println!("Row limit set to {}", n);
                }
            }
            None => eprintln!("Usage: \\limit <n>  (0 = unlimited)"),
        },
        "\\schema" => {
            state.schema = arg.map(String::from);
            spawn_catalog_refresh(
                state.catalog.clone(),
                driver.clone(),
                params.clone(),
                state.schema.clone(),
            );
            match &state.schema {
                Some(s) => println!("Schema set to {}", s),
                None => println!("Schema reset to driver default"),
            }
        }
        "\\pager" => match arg {
            Some("on") => {
                state.pager = true;
                println!("Pager enabled");
            }
            Some("off") => {
                state.pager = false;
                println!("Pager disabled");
            }
            None => println!("Pager is {}", if state.pager { "on" } else { "off" }),
            _ => eprintln!("Usage: \\pager <on|off>"),
        },
        _ => eprintln!("Unknown command: {}  (\\? for help)", command),
    }
    false
}

async fn describe_table(
    state: &ShellState,
    params: &ConnectionParams,
    driver: &Arc<dyn DatabaseDriver>,
    table: &str,
) {
    let schema = state.schema.as_deref();
    match driver.get_columns(params, table, schema).await {
        Ok(columns) => {
            let headers = ["COLUMN", "TYPE", "NULLABLE", "PK", "DEFAULT"]
                .map(String::from)
                .to_vec();
            let rows: Vec<Vec<String>> = columns
                .iter()
                .map(|c| {
                    vec![
                        c.name.clone(),
                        c.data_type.clone(),
                        if c.is_nullable { "YES" } else { "NO" }.to_string(),
                        if c.is_pk { "PK" } else { "" }.to_string(),
                        c.default_value.clone().unwrap_or_default(),
                    ]
                })
                .collect();
            println!("{}", output::render_table(&headers, &rows));
        }
        Err(e) => print_error(&e),
    }
}

fn print_name_list(names: &[String]) {
    for name in names {
        println!("{}", output::sanitize_text(name));
    }
    println!("({} found)", names.len());
}

/// Print a driver/server error. The message can embed server-controlled text,
/// so it goes through the same control-character sanitization as query output.
fn print_error(error: &str) {
    eprintln!("ERROR: {}", output::sanitize_text(error));
}

fn print_help() {
    println!(
        "Meta commands:
  \\q, exit, quit       Quit the shell
  \\?                   Show this help
  \\use [db]            Switch database, or show the current one
  \\l                   List databases
  \\dn                  List schemas
  \\dt                  List tables (in the current schema)
  \\d <table>           Show the columns of a table
  \\i <file>            Run the SQL statements from a file
  \\f <table|expanded|json|csv>  Set the output format
  \\x                   Toggle expanded (vertical) output
  \\limit <n>           Set the row limit (0 = unlimited)
  \\schema [name]       Set or reset the current schema
  \\pager <on|off>      Enable or disable the pager for long results

Tab completes SQL keywords, table/column names and meta commands.
Any other input is buffered as SQL and executed when a line ends with ';'.
Each statement runs on its own pooled connection, so session state
(SET, BEGIN/COMMIT, temp tables) does not persist between statements."
    );
}
