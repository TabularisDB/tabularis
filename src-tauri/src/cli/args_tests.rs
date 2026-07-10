use super::{Args, CliCommand, OutputFormat};
use clap::error::ErrorKind;
use clap::Parser;

// --- GUI launch compatibility ------------------------------------------------

#[test]
fn no_arguments_means_gui_launch() {
    let args = Args::try_parse_from(["tabularis"]).unwrap();
    assert!(args.command.is_none());
    assert!(!args.mcp);
    assert!(!args.debug);
    assert!(args.explain.is_none());
}

#[test]
fn legacy_flags_still_parse() {
    let args =
        Args::try_parse_from(["tabularis", "--mcp", "--debug", "--explain", "plan.json"]).unwrap();
    assert!(args.mcp);
    assert!(args.debug);
    assert_eq!(args.explain.as_deref(), Some("plan.json"));
    assert!(args.command.is_none());
}

#[test]
fn macos_psn_argument_is_unknown_argument_error() {
    // `parse()` falls back to GUI defaults on this kind only; a regression
    // here would make Finder launches die on the clap error path.
    let err = Args::try_parse_from(["tabularis", "-psn_0_42"]).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::UnknownArgument);
}

#[test]
fn misspelled_subcommand_is_invalid_subcommand_error() {
    // `parse()` must surface this to the user instead of opening the GUI.
    let err = Args::try_parse_from(["tabularis", "quer", "conn"]).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::InvalidSubcommand);
}

// --- query -------------------------------------------------------------------

#[test]
fn query_with_sql_parses_with_defaults() {
    let args = Args::try_parse_from(["tabularis", "query", "conn-1", "select 1"]).unwrap();
    match args.command {
        Some(CliCommand::Query {
            connection,
            sql,
            file,
            database,
            limit,
            format,
            schema,
        }) => {
            assert_eq!(connection, "conn-1");
            assert_eq!(sql.as_deref(), Some("select 1"));
            assert_eq!(file, None);
            assert_eq!(database, None);
            assert_eq!(limit, 100);
            assert_eq!(format, OutputFormat::Table);
            assert_eq!(schema, None);
        }
        other => panic!("expected Query, got {:?}", other),
    }
}

#[test]
fn query_without_sql_parses_for_shell_mode() {
    let args = Args::try_parse_from(["tabularis", "query", "conn-1"]).unwrap();
    match args.command {
        Some(CliCommand::Query { sql, .. }) => assert!(sql.is_none()),
        other => panic!("expected Query, got {:?}", other),
    }
}

#[test]
fn query_accepts_short_database_flag() {
    let args = Args::try_parse_from(["tabularis", "query", "conn-1", "-d", "blog_demo"]).unwrap();
    match args.command {
        Some(CliCommand::Query { database, .. }) => {
            assert_eq!(database.as_deref(), Some("blog_demo"));
        }
        other => panic!("expected Query, got {:?}", other),
    }
}

#[test]
fn query_format_accepts_known_values_only() {
    let args =
        Args::try_parse_from(["tabularis", "query", "c", "select 1", "--format", "csv"]).unwrap();
    match args.command {
        Some(CliCommand::Query { format, .. }) => assert_eq!(format, OutputFormat::Csv),
        other => panic!("expected Query, got {:?}", other),
    }

    let err =
        Args::try_parse_from(["tabularis", "query", "c", "s", "--format", "xml"]).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::InvalidValue);
}

#[test]
fn query_format_accepts_expanded() {
    let args = Args::try_parse_from([
        "tabularis",
        "query",
        "c",
        "select 1",
        "--format",
        "expanded",
    ])
    .unwrap();
    match args.command {
        Some(CliCommand::Query { format, .. }) => assert_eq!(format, OutputFormat::Expanded),
        other => panic!("expected Query, got {:?}", other),
    }
}

#[test]
fn query_accepts_file_flag() {
    let args = Args::try_parse_from(["tabularis", "query", "conn-1", "-f", "script.sql"]).unwrap();
    match args.command {
        Some(CliCommand::Query { sql, file, .. }) => {
            assert!(sql.is_none());
            assert_eq!(file.as_deref(), Some(std::path::Path::new("script.sql")));
        }
        other => panic!("expected Query, got {:?}", other),
    }
}

#[test]
fn query_rejects_sql_argument_together_with_file() {
    let err = Args::try_parse_from([
        "tabularis",
        "query",
        "conn-1",
        "select 1",
        "--file",
        "a.sql",
    ])
    .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::ArgumentConflict);
}

#[test]
fn query_alias_q_works() {
    let args = Args::try_parse_from(["tabularis", "q", "conn-1", "select 1"]).unwrap();
    assert!(matches!(args.command, Some(CliCommand::Query { .. })));
}

// --- other subcommands ---------------------------------------------------------

#[test]
fn connections_alias_ls_works() {
    let args = Args::try_parse_from(["tabularis", "ls"]).unwrap();
    assert!(matches!(
        args.command,
        Some(CliCommand::Connections { json: false })
    ));
}

#[test]
fn tables_parses_database_and_schema() {
    let args = Args::try_parse_from([
        "tabularis",
        "tables",
        "conn-1",
        "-d",
        "db2",
        "--schema",
        "public",
        "--json",
    ])
    .unwrap();
    match args.command {
        Some(CliCommand::Tables {
            connection,
            database,
            schema,
            json,
        }) => {
            assert_eq!(connection, "conn-1");
            assert_eq!(database.as_deref(), Some("db2"));
            assert_eq!(schema.as_deref(), Some("public"));
            assert!(json);
        }
        other => panic!("expected Tables, got {:?}", other),
    }
}

#[test]
fn describe_requires_table_argument() {
    let err = Args::try_parse_from(["tabularis", "describe", "conn-1"]).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::MissingRequiredArgument);
}

#[test]
fn install_cli_parses_dir_and_force() {
    let args =
        Args::try_parse_from(["tabularis", "install-cli", "--dir", "/tmp/bin", "--force"]).unwrap();
    match args.command {
        Some(CliCommand::InstallCli { dir, force }) => {
            assert_eq!(dir.as_deref(), Some(std::path::Path::new("/tmp/bin")));
            assert!(force);
        }
        other => panic!("expected InstallCli, got {:?}", other),
    }
}
