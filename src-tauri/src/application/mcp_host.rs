#[cfg(target_os = "windows")]
use directories::ProjectDirs;

use directories::BaseDirs;
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

#[cfg(test)]
mod tests;

/// Host-side MCP client configuration operations shared by desktop and Web UI transports.
#[derive(Clone, Debug)]
pub enum McpHostCommand {
    GetStatus,
    InstallConfig { client_id: String },
}

/// "file" means a standard mcpServers JSON file; "command" uses a client CLI.
#[derive(Clone, Debug, Serialize)]
pub struct McpClientStatus {
    pub client_id: String,
    pub client_name: String,
    pub installed: bool,
    pub config_path: Option<String>,
    pub executable_path: String,
    pub client_type: String,
    pub manual_command: Option<String>,
}

struct McpClient {
    id: &'static str,
    name: &'static str,
    config_path: Option<PathBuf>,
    client_type: &'static str,
}

pub async fn execute(command: McpHostCommand) -> Result<Value, String> {
    match command {
        McpHostCommand::GetStatus => serde_json::to_value(get_status().await?)
            .map_err(|error| format!("Failed to serialize MCP status: {error}")),
        McpHostCommand::InstallConfig { client_id } => {
            serde_json::to_value(install_config(client_id).await?)
                .map_err(|error| format!("Failed to serialize MCP install result: {error}"))
        }
    }
}

pub async fn get_status() -> Result<Vec<McpClientStatus>, String> {
    tokio::task::spawn_blocking(get_status_blocking)
        .await
        .map_err(|error| format!("Failed to inspect MCP host configuration: {error}"))?
}

pub async fn install_config(client_id: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || install_config_blocking(&client_id))
        .await
        .map_err(|error| format!("Failed to update MCP host configuration: {error}"))?
}

fn get_status_blocking() -> Result<Vec<McpClientStatus>, String> {
    let executable_path = std::env::current_exe()
        .map_err(|error| format!("Failed to get executable path: {error}"))?
        .to_string_lossy()
        .to_string();

    Ok(get_all_clients()
        .into_iter()
        .map(|client| {
            let installed = match client.client_type {
                "command" => client
                    .config_path
                    .as_ref()
                    .is_some_and(is_command_client_installed),
                _ => client
                    .config_path
                    .as_ref()
                    .is_some_and(is_tabularis_in_mcp_servers),
            };
            McpClientStatus {
                client_id: client.id.to_string(),
                client_name: client.name.to_string(),
                installed,
                config_path: client
                    .config_path
                    .map(|path| path.to_string_lossy().to_string()),
                executable_path: executable_path.clone(),
                client_type: client.client_type.to_string(),
                manual_command: build_manual_command(client.id, &executable_path),
            }
        })
        .collect())
}

fn install_config_blocking(client_id: &str) -> Result<String, String> {
    let executable_path = std::env::current_exe()
        .map_err(|error| format!("Failed to get executable path: {error}"))?;
    let executable = executable_path.to_string_lossy().to_string();
    let clients = get_all_clients();
    let client = clients
        .iter()
        .find(|client| client.id == client_id)
        .ok_or_else(|| format!("Unknown client: {client_id}"))?;

    if client.client_type == "command" {
        let (program, args) = build_command_client_invocation(client.id, &executable)
            .ok_or_else(|| format!("Unsupported command client: {}", client.id))?;
        let manual_command = build_manual_command(client.id, &executable)
            .unwrap_or_else(|| format!("{} {}", program, args.join(" ")));
        let output = std::process::Command::new(&program)
            .args(&args)
            .output()
            .map_err(|error| {
                format!(
                    "{} CLI not found. Run manually:\n{}\n(Error: {})",
                    client.name, manual_command, error
                )
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("{program} mcp add failed: {stderr}"));
        }

        return Ok(client.name.to_string());
    }

    let config_path = client
        .config_path
        .as_ref()
        .ok_or("Could not determine config path for this OS")?;
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let mut config: Value = if config_path.exists() {
        let content = fs::read_to_string(config_path).map_err(|error| error.to_string())?;
        serde_json::from_str(&content).unwrap_or_else(|_| json!({}))
    } else {
        json!({})
    };
    if config.get("mcpServers").is_none() {
        config["mcpServers"] = json!({});
    }
    config["mcpServers"]["tabularis"] = json!({
        "command": executable,
        "args": ["--mcp"]
    });

    let content = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
    fs::write(config_path, content).map_err(|error| error.to_string())?;
    Ok(client.name.to_string())
}

fn get_all_clients() -> Vec<McpClient> {
    let base = BaseDirs::new();
    let claude_path = {
        #[cfg(target_os = "macos")]
        {
            base.as_ref().map(|base| {
                base.home_dir()
                    .join("Library/Application Support/Claude/claude_desktop_config.json")
            })
        }
        #[cfg(target_os = "windows")]
        {
            ProjectDirs::from("", "", "Claude")
                .map(|project| project.config_dir().join("claude_desktop_config.json"))
        }
        #[cfg(target_os = "linux")]
        {
            base.as_ref()
                .map(|base| base.config_dir().join("Claude/claude_desktop_config.json"))
        }
    };

    vec![
        McpClient {
            id: "claude",
            name: "Claude Desktop",
            config_path: claude_path,
            client_type: "file",
        },
        McpClient {
            id: "claude_code",
            name: "Claude Code",
            config_path: base
                .as_ref()
                .map(|base| base.home_dir().join(".claude.json")),
            client_type: "command",
        },
        McpClient {
            id: "codex",
            name: "Codex",
            config_path: base
                .as_ref()
                .map(|base| base.home_dir().join(".codex/config.toml")),
            client_type: "command",
        },
        McpClient {
            id: "cursor",
            name: "Cursor",
            config_path: base
                .as_ref()
                .map(|base| base.home_dir().join(".cursor/mcp.json")),
            client_type: "file",
        },
        McpClient {
            id: "windsurf",
            name: "Windsurf",
            config_path: base
                .as_ref()
                .map(|base| base.home_dir().join(".codeium/windsurf/mcp_config.json")),
            client_type: "file",
        },
        McpClient {
            id: "antigravity",
            name: "Antigravity",
            config_path: base
                .as_ref()
                .map(|base| base.home_dir().join(".gemini/antigravity/mcp_config.json")),
            client_type: "file",
        },
    ]
}

fn is_tabularis_in_mcp_servers(path: &PathBuf) -> bool {
    if !path.exists() {
        return false;
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<Value>(&content).ok())
        .and_then(|config| config.get("mcpServers").cloned())
        .is_some_and(|servers| servers.get("tabularis").is_some())
}

fn is_command_client_installed(path: &PathBuf) -> bool {
    if !path.exists() {
        return false;
    }
    fs::read_to_string(path)
        .map(|content| {
            content.contains("\"tabularis\"")
                || content.contains("[mcp_servers.tabularis]")
                || content.contains("[mcp_servers.\"tabularis\"]")
        })
        .unwrap_or(false)
}

fn build_command_client_invocation(
    client_id: &str,
    executable: &str,
) -> Option<(String, Vec<String>)> {
    match client_id {
        "claude_code" => Some((
            "claude".to_string(),
            vec![
                "mcp",
                "add",
                "--scope",
                "user",
                "tabularis",
                executable,
                "--",
                "--mcp",
            ]
            .into_iter()
            .map(str::to_string)
            .collect(),
        )),
        "codex" => Some((
            "codex".to_string(),
            vec!["mcp", "add", "tabularis", "--", executable, "--mcp"]
                .into_iter()
                .map(str::to_string)
                .collect(),
        )),
        _ => None,
    }
}

fn build_manual_command(client_id: &str, executable: &str) -> Option<String> {
    let (program, args) = build_command_client_invocation(client_id, executable)?;
    Some(format!("{} {}", program, args.join(" ")))
}
