//! Execution of the CLI subcommands. Each command resolves the saved
//! connection through [`crate::headless`] (keychain, SSH/K8s tunnels) and
//! talks to the registered driver directly — no Tauri runtime involved.

use super::output;
use super::{CliCommand, OutputFormat};
use crate::headless;
use crate::models::{ConnectionParams, DatabaseSelection, QueryResult};
use serde_json::json;
use std::io::{IsTerminal, Read};
use std::time::Instant;

/// Run a CLI subcommand to completion and return the process exit code.
pub async fn run_command(command: CliCommand) -> i32 {
    match execute(command).await {
        Ok(()) => 0,
        Err(e) => {
            // Error strings can embed server-controlled text; strip control
            // characters before they reach the terminal.
            eprintln!("Error: {}", output::sanitize_text(&e));
            1
        }
    }
}

async fn execute(command: CliCommand) -> Result<(), String> {
    // `connections` and `install-cli` never talk to a database; everything
    // else needs the driver registry populated first (built-ins + enabled
    // plugins).
    if !matches!(
        command,
        CliCommand::Connections { .. } | CliCommand::InstallCli { .. }
    ) {
        headless::register_drivers().await;
    }

    match command {
        CliCommand::Connections { json } => cmd_connections(json),
        CliCommand::Databases { connection, json } => cmd_databases(&connection, json).await,
        CliCommand::Schemas {
            connection,
            database,
            json,
        } => cmd_schemas(&connection, database, json).await,
        CliCommand::Tables {
            connection,
            database,
            schema,
            json,
        } => cmd_tables(&connection, database, schema.as_deref(), json).await,
        CliCommand::Describe {
            connection,
            table,
            database,
            schema,
            json,
        } => cmd_describe(&connection, &table, database, schema.as_deref(), json).await,
        CliCommand::Query {
            connection,
            sql,
            file,
            database,
            limit,
            format,
            schema,
        } => {
            cmd_query(
                &connection,
                sql,
                file,
                database,
                limit,
                format,
                schema.as_deref(),
            )
            .await
        }
        CliCommand::InstallCli { dir, force } => super::install::run_install(dir, force),
    }
}

/// Scope the resolved params to one database, mirroring the GUI's
/// per-call `database` override. Multi-database connections resolve to
/// their *first* database otherwise, so without this there is no way to
/// reach the other databases of the connection.
pub(crate) fn override_database(params: &mut ConnectionParams, database: Option<String>) {
    if let Some(db) = database {
        params.database = DatabaseSelection::Single(db);
    }
}

fn cmd_connections(as_json: bool) -> Result<(), String> {
    let config_path = crate::paths::get_app_config_dir().join("connections.json");
    let connections = crate::persistence::load_connections(&config_path)?;

    if as_json {
        let list: Vec<_> = connections
            .iter()
            .map(|c| {
                json!({
                    "id": c.id,
                    "name": c.name,
                    "driver": c.params.driver,
                    "host": c.params.host,
                    "port": c.params.port,
                    "database": c.params.database.to_string(),
                })
            })
            .collect();
        println!("{}", serde_json::to_string_pretty(&list).unwrap());
        return Ok(());
    }

    let headers = ["ID", "NAME", "DRIVER", "HOST", "DATABASE"]
        .map(String::from)
        .to_vec();
    let rows: Vec<Vec<String>> = connections
        .iter()
        .map(|c| {
            vec![
                c.id.clone(),
                c.name.clone(),
                c.params.driver.clone(),
                c.params.host.clone().unwrap_or_default(),
                c.params.database.to_string(),
            ]
        })
        .collect();
    println!("{}", output::render_table(&headers, &rows));
    println!("({} connections)", rows.len());
    Ok(())
}

/// Print a plain list of names, or a JSON array when `as_json` is set.
fn print_names(names: &[String], as_json: bool) {
    if as_json {
        println!("{}", serde_json::to_string_pretty(names).unwrap());
    } else {
        for name in names {
            println!("{}", output::sanitize_text(name));
        }
    }
}

async fn cmd_databases(connection: &str, as_json: bool) -> Result<(), String> {
    let (_, params, driver) = headless::resolve_db_driver(connection).await?;
    let databases = driver.get_databases(&params).await?;
    print_names(&databases, as_json);
    Ok(())
}

async fn cmd_schemas(
    connection: &str,
    database: Option<String>,
    as_json: bool,
) -> Result<(), String> {
    let (_, mut params, driver) = headless::resolve_db_driver(connection).await?;
    override_database(&mut params, database);
    let schemas = driver.get_schemas(&params).await?;
    print_names(&schemas, as_json);
    Ok(())
}

async fn cmd_tables(
    connection: &str,
    database: Option<String>,
    schema: Option<&str>,
    as_json: bool,
) -> Result<(), String> {
    let (_, mut params, driver) = headless::resolve_db_driver(connection).await?;
    override_database(&mut params, database);
    let tables = driver.get_tables(&params, schema).await?;
    let names: Vec<String> = tables.into_iter().map(|t| t.name).collect();
    print_names(&names, as_json);
    Ok(())
}

async fn cmd_describe(
    connection: &str,
    table: &str,
    database: Option<String>,
    schema: Option<&str>,
    as_json: bool,
) -> Result<(), String> {
    let (_, mut params, driver) = headless::resolve_db_driver(connection).await?;
    override_database(&mut params, database);

    let (columns, foreign_keys, indexes) = tokio::join!(
        driver.get_columns(&params, table, schema),
        driver.get_foreign_keys(&params, table, schema),
        driver.get_indexes(&params, table, schema),
    );
    let columns = columns?;
    let foreign_keys = foreign_keys?;
    let indexes = indexes?;

    if as_json {
        let result = json!({
            "table": table,
            "columns": columns,
            "foreign_keys": foreign_keys,
            "indexes": indexes,
        });
        println!("{}", serde_json::to_string_pretty(&result).unwrap());
        return Ok(());
    }

    let col_headers = ["COLUMN", "TYPE", "NULLABLE", "PK", "DEFAULT"]
        .map(String::from)
        .to_vec();
    let col_rows: Vec<Vec<String>> = columns
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
    println!("Table: {}", table);
    println!("{}", output::render_table(&col_headers, &col_rows));

    if !indexes.is_empty() {
        let idx_headers = ["INDEX", "COLUMN", "UNIQUE", "PRIMARY"]
            .map(String::from)
            .to_vec();
        let idx_rows: Vec<Vec<String>> = indexes
            .iter()
            .map(|i| {
                vec![
                    i.name.clone(),
                    i.column_name.clone(),
                    if i.is_unique { "YES" } else { "" }.to_string(),
                    if i.is_primary { "YES" } else { "" }.to_string(),
                ]
            })
            .collect();
        println!("\nIndexes:");
        println!("{}", output::render_table(&idx_headers, &idx_rows));
    }

    if !foreign_keys.is_empty() {
        let fk_headers = ["FOREIGN KEY", "COLUMN", "REFERENCES", "ON DELETE"]
            .map(String::from)
            .to_vec();
        let fk_rows: Vec<Vec<String>> = foreign_keys
            .iter()
            .map(|fk| {
                vec![
                    fk.name.clone(),
                    fk.column_name.clone(),
                    format!("{}({})", fk.ref_table, fk.ref_column),
                    fk.on_delete.clone().unwrap_or_default(),
                ]
            })
            .collect();
        println!("\nForeign keys:");
        println!("{}", output::render_table(&fk_headers, &fk_rows));
    }

    Ok(())
}

async fn cmd_query(
    connection: &str,
    sql: Option<String>,
    file: Option<std::path::PathBuf>,
    database: Option<String>,
    limit: u32,
    format: OutputFormat,
    schema: Option<&str>,
) -> Result<(), String> {
    let script = match (sql, file) {
        (Some(s), _) => s,
        (None, Some(path)) => std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?,
        // No SQL argument: with an interactive terminal this becomes the
        // shell; with piped input the SQL is read from stdin instead.
        (None, None) if std::io::stdin().is_terminal() => {
            return super::repl::run_shell(
                connection,
                database,
                limit,
                format,
                schema.map(String::from),
            )
            .await;
        }
        (None, None) => {
            let mut buf = String::new();
            std::io::stdin()
                .read_to_string(&mut buf)
                .map_err(|e| format!("Failed to read SQL from stdin: {}", e))?;
            buf
        }
    };
    let statements = super::statements::split_sql_statements(&script);
    if statements.is_empty() {
        return Err(
            "No SQL provided (pass it as an argument, via --file, or pipe it via stdin)"
                .to_string(),
        );
    }

    let (_, mut params, driver) = headless::resolve_db_driver(connection).await?;
    override_database(&mut params, database);
    let multiple = statements.len() > 1;
    for (index, statement) in statements.iter().enumerate() {
        let start = Instant::now();
        let result = driver
            .execute_query(&params, statement, effective_limit(limit), 1, schema)
            .await
            .map_err(|e| {
                if multiple {
                    format!("Statement {} failed: {}", index + 1, e)
                } else {
                    e
                }
            })?;
        print_query_result(&result, format, start.elapsed(), true);
    }
    Ok(())
}

/// `--limit 0` means "no limit".
pub(crate) fn effective_limit(limit: u32) -> Option<u32> {
    if limit == 0 {
        None
    } else {
        Some(limit)
    }
}

/// Print a query result in the requested format. Statements that return no
/// result set (INSERT/UPDATE/DDL) print an `OK` line with the affected-row
/// count instead. Table-like formats go through the pager when `pager` is set
/// and stdout is an interactive terminal.
pub(crate) fn print_query_result(
    result: &QueryResult,
    format: OutputFormat,
    elapsed: std::time::Duration,
    pager: bool,
) {
    let ms = elapsed.as_millis();

    if result.columns.is_empty() {
        println!("OK, {} rows affected ({} ms)", result.affected_rows, ms);
        return;
    }

    let truncated = if result.truncated { ", truncated" } else { "" };
    match format {
        OutputFormat::Table => {
            let rows = output::result_to_rows(result);
            super::pager::print_paged(&output::render_table(&result.columns, &rows), pager);
            println!("({} rows{} in {} ms)", rows.len(), truncated, ms);
        }
        OutputFormat::Expanded => {
            let rows = output::result_to_rows(result);
            if !rows.is_empty() {
                super::pager::print_paged(&output::render_expanded(&result.columns, &rows), pager);
            }
            println!("({} rows{} in {} ms)", rows.len(), truncated, ms);
        }
        OutputFormat::Json => println!("{}", output::render_json(result)),
        OutputFormat::Csv => {
            let mut headers = result.columns.clone();
            let mut rows = output::result_to_rows(result);
            // On a TTY, CSV is read by a human: strip control characters so
            // crafted cells cannot inject escape sequences. When piped, keep
            // the data byte-exact for downstream tools.
            if std::io::stdout().is_terminal() {
                headers = headers.iter().map(|h| output::sanitize_text(h)).collect();
                rows = rows
                    .iter()
                    .map(|row| row.iter().map(|c| output::sanitize_text(c)).collect())
                    .collect();
            }
            match output::render_csv(&headers, &rows) {
                Ok(csv) => print!("{}", csv),
                Err(e) => eprintln!("Error: failed to render CSV: {}", e),
            }
        }
    }
}
