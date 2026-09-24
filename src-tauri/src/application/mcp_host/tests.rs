use super::*;

#[test]
fn lists_codex_as_command_client() {
    let clients = get_all_clients();
    let codex = clients
        .iter()
        .find(|client| client.id == "codex")
        .expect("Codex should be listed as an MCP client");

    assert_eq!(codex.name, "Codex");
    assert_eq!(codex.client_type, "command");
    assert!(
        codex
            .config_path
            .as_ref()
            .is_some_and(|path| path.ends_with(".codex/config.toml")),
        "Codex config path should point to ~/.codex/config.toml"
    );
}

#[test]
fn builds_codex_manual_command() {
    assert_eq!(
        build_manual_command("codex", "/Applications/Tabularis.app/tabularis").as_deref(),
        Some("codex mcp add tabularis -- /Applications/Tabularis.app/tabularis --mcp")
    );
}

#[test]
fn builds_claude_code_manual_command() {
    assert_eq!(
        build_manual_command("claude_code", "/Applications/Tabularis.app/tabularis").as_deref(),
        Some(
            "claude mcp add --scope user tabularis /Applications/Tabularis.app/tabularis -- --mcp"
        )
    );
}

#[test]
fn detects_codex_toml_config() {
    let temp_dir = tempfile::tempdir().unwrap();
    let config_path = temp_dir.path().join("config.toml");
    fs::write(
        &config_path,
        r#"
[mcp_servers.tabularis]
command = "/Applications/Tabularis.app/tabularis"
args = ["--mcp"]
"#,
    )
    .unwrap();

    assert!(is_command_client_installed(&config_path));
}

#[test]
fn rejects_unknown_host_client_without_writing_configuration() {
    let error = install_config_blocking("unknown-client")
        .expect_err("unknown MCP clients must be rejected");

    assert_eq!(error, "Unknown client: unknown-client");
}
