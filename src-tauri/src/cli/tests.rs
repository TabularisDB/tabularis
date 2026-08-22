use super::{try_parse_from, Args, WebAuthMode};
use clap::{error::ErrorKind, Parser};
use std::path::PathBuf;

#[test]
fn parses_desktop_defaults() {
    let args = Args::try_parse_from(["tabularis"]).expect("defaults should parse");

    assert!(!args.mcp);
    assert!(!args.debug);
    assert!(args.explain.is_none());
    assert!(!args.web);
    assert_eq!(args.host, "127.0.0.1");
    assert_eq!(args.port, 8080);
    assert!(!args.no_open);
    assert!(args.web_root.is_none());
    assert_eq!(args.auth, None);
    assert!(args.public_url.is_none());
    assert!(args.allowed_origins.is_empty());
    assert!(!args.allow_high_risk);
}

#[test]
fn parses_all_web_options() {
    let args = Args::try_parse_from([
        "tabularis",
        "--web",
        "--host",
        "localhost",
        "--port",
        "9090",
        "--no-open",
        "--web-root",
        "/tmp/tabularis-web",
        "--auth",
        "password",
        "--public-url",
        "https://tabularis.example.com",
        "--allowed-origin",
        "https://tabularis.example.com",
        "--allowed-origin",
        "https://admin.example.com",
        "--allow-high-risk",
        "--debug",
    ])
    .expect("web options should parse");

    assert!(args.web);
    assert_eq!(args.host, "localhost");
    assert_eq!(args.port, 9090);
    assert!(args.no_open);
    assert_eq!(args.web_root, Some(PathBuf::from("/tmp/tabularis-web")));
    assert_eq!(args.auth, Some(WebAuthMode::Password));
    assert_eq!(
        args.public_url.as_deref(),
        Some("https://tabularis.example.com")
    );
    assert_eq!(
        args.allowed_origins,
        [
            "https://tabularis.example.com".to_string(),
            "https://admin.example.com".to_string()
        ]
    );
    assert!(args.allow_high_risk);
    assert!(args.debug);
}

#[test]
fn web_conflicts_with_mcp_mode() {
    let error = Args::try_parse_from(["tabularis", "--web", "--mcp"])
        .expect_err("web and MCP modes must conflict");

    assert_eq!(error.kind(), ErrorKind::ArgumentConflict);
}

#[test]
fn web_conflicts_with_explain_mode() {
    let error = Args::try_parse_from(["tabularis", "--web", "--explain", "plan.json"])
        .expect_err("web and explain modes must conflict");

    assert_eq!(error.kind(), ErrorKind::ArgumentConflict);
}

#[test]
fn web_options_require_web_mode() {
    for option in [
        "--host",
        "--port",
        "--web-root",
        "--auth",
        "--public-url",
        "--allowed-origin",
    ] {
        let value = match option {
            "--host" => "localhost",
            "--port" => "9090",
            "--web-root" => "/tmp/tabularis-web",
            "--auth" => "proxy",
            "--public-url" | "--allowed-origin" => "https://tabularis.example.com",
            _ => unreachable!(),
        };
        let error = Args::try_parse_from(["tabularis", option, value])
            .expect_err("web options must require --web");
        assert_eq!(error.kind(), ErrorKind::MissingRequiredArgument);
    }

    for option in ["--no-open", "--allow-high-risk"] {
        let error = Args::try_parse_from(["tabularis", option])
            .expect_err("the Web option must require --web");
        assert_eq!(error.kind(), ErrorKind::MissingRequiredArgument);
    }
}

#[test]
fn help_lists_web_options_and_defaults() {
    let error = Args::try_parse_from(["tabularis", "--help"])
        .expect_err("help should be returned as a clap display error");

    assert_eq!(error.kind(), ErrorKind::DisplayHelp);
    let help = error.to_string();
    for option in [
        "--web",
        "--host <HOST>",
        "--port <PORT>",
        "--no-open",
        "--web-root <PATH>",
        "--auth <MODE>",
        "--public-url <URL>",
        "--allowed-origin <ORIGIN>",
        "--allow-high-risk",
    ] {
        assert!(
            help.contains(option),
            "help did not contain {option}: {help}"
        );
    }
    assert!(help.contains("127.0.0.1"));
    assert!(help.contains("8080"));
}

#[test]
fn platform_launch_arguments_fall_back_to_desktop_defaults() {
    for platform_argument in ["-psn_0_12345", "tabularis://plugins/example"] {
        let args = try_parse_from(["tabularis", platform_argument])
            .expect("platform launch metadata should use desktop defaults");

        assert!(!args.web);
        assert!(!args.mcp);
        assert!(!args.debug);
        assert!(args.explain.is_none());
        assert_eq!(args.host, "127.0.0.1");
        assert_eq!(args.port, 8080);
    }
}

#[test]
fn user_parse_errors_do_not_fall_back_to_desktop_mode() {
    let error = try_parse_from(["tabularis", "--web", "--mcp"])
        .expect_err("a mode conflict must remain visible to the user");

    assert_eq!(error.kind(), ErrorKind::ArgumentConflict);
}
