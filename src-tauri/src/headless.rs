//! Connection resolution and driver registration for headless (non-GUI)
//! entry points: the MCP server (`--mcp`) and the CLI subcommands.
//!
//! These helpers mirror what the Tauri command layer does with an
//! `AppHandle` (keychain passwords, SSH/K8s tunnel expansion, driver
//! registry population) but read everything from disk and the OS keychain
//! directly, so they work in a plain process with no Tauri runtime.

use crate::commands;
use crate::config;
use crate::credential_cache;
use crate::drivers::driver_trait::DatabaseDriver;
use crate::drivers::registry as driver_registry;
use crate::drivers::{mysql, postgres, sqlite};
use crate::models::{ConnectionParams, K8sConnection, SavedConnection, SshConnection};
use crate::paths;
use crate::persistence;
use crate::plugins;
use std::sync::Arc;

/// Headless equivalent of `expand_ssh_connection_params` — no AppHandle needed.
/// Loads SSH credentials from the config file and keychain directly.
pub async fn expand_ssh_params(params: &ConnectionParams) -> Result<ConnectionParams, String> {
    let mut expanded = params.clone();

    if !params.ssh_enabled.unwrap_or(false) {
        return Ok(expanded);
    }

    let ssh_id = match &params.ssh_connection_id {
        Some(id) => id.clone(),
        None => return Ok(expanded), // legacy inline SSH fields already present
    };

    let ssh_path = paths::get_app_config_dir().join("ssh_connections.json");
    if !ssh_path.exists() {
        return Err(format!("SSH connection {} not found", ssh_id));
    }

    let content = tokio::task::spawn_blocking({
        let p = ssh_path.clone();
        move || std::fs::read_to_string(p).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    let mut ssh: SshConnection = serde_json::from_str::<Vec<SshConnection>>(&content)
        .unwrap_or_default()
        .into_iter()
        .find(|s| s.id == ssh_id)
        .ok_or_else(|| format!("SSH connection {} not found", ssh_id))?;

    if ssh.auth_type.is_none() {
        ssh.auth_type = Some(
            if ssh
                .key_file
                .as_ref()
                .is_some_and(|k| !k.trim().is_empty())
            {
                "ssh_key".to_string()
            } else {
                "password".to_string()
            },
        );
    }

    if ssh.save_in_keychain.unwrap_or(false) {
        let cache = Arc::new(credential_cache::CredentialCache::default());
        let id = ssh.id.clone();
        let (pwd_r, pass_r) = tokio::task::spawn_blocking(move || {
            let pwd = credential_cache::get_ssh_password_cached(&cache, &id);
            let pass = credential_cache::get_ssh_key_passphrase_cached(&cache, &id);
            (pwd, pass)
        })
        .await
        .map_err(|e| e.to_string())?;

        if let Ok(v) = pwd_r {
            if !v.trim().is_empty() {
                ssh.password = Some(v);
            }
        }
        if let Ok(v) = pass_r {
            if !v.trim().is_empty() {
                ssh.key_passphrase = Some(v);
            }
        }
    }

    expanded.ssh_host = Some(ssh.host);
    expanded.ssh_port = Some(ssh.port);
    expanded.ssh_user = Some(ssh.user);
    expanded.ssh_password = ssh.password;
    expanded.ssh_key_file = ssh.key_file;
    expanded.ssh_key_passphrase = ssh.key_passphrase;

    Ok(expanded)
}

/// Headless equivalent of K8s saved-connection expansion.
pub async fn expand_k8s_params(params: &ConnectionParams) -> Result<ConnectionParams, String> {
    let mut expanded = params.clone();

    if !params.k8s_enabled.unwrap_or(false) {
        return Ok(expanded);
    }

    let k8s_id = match &params.k8s_connection_id {
        Some(id) => id.clone(),
        None => return Ok(expanded),
    };

    let k8s_path = paths::get_app_config_dir().join("k8s_connections.json");
    if !k8s_path.exists() {
        return Err(format!("K8s connection {} not found", k8s_id));
    }

    let content = tokio::task::spawn_blocking({
        let p = k8s_path.clone();
        move || std::fs::read_to_string(p).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    let k8s: K8sConnection = serde_json::from_str::<Vec<K8sConnection>>(&content)
        .unwrap_or_default()
        .into_iter()
        .find(|k| k.id == k8s_id)
        .ok_or_else(|| format!("K8s connection {} not found", k8s_id))?;

    expanded.k8s_context = Some(k8s.context);
    expanded.k8s_namespace = Some(k8s.namespace);
    expanded.k8s_resource_type = Some(k8s.resource_type);
    expanded.k8s_resource_name = Some(k8s.resource_name);
    expanded.k8s_port = Some(k8s.port);

    Ok(expanded)
}

/// Look up a saved connection by id or (case-insensitive) name.
pub fn find_connection(conn_id: &str) -> Result<SavedConnection, String> {
    let config_path = paths::get_app_config_dir().join("connections.json");
    let connections = persistence::load_connections(&config_path)?;

    connections
        .into_iter()
        .find(|c| c.id == conn_id || c.name.eq_ignore_ascii_case(conn_id))
        .ok_or_else(|| format!("Connection not found: {}", conn_id))
}

/// Full headless connection resolution: DB password + SSH/K8s expansion +
/// tunnel setup.
pub async fn resolve_db_params(
    conn_id: &str,
) -> Result<(SavedConnection, ConnectionParams), String> {
    let mut conn = find_connection(conn_id)?;

    // Load DB password from keychain if it isn't stored inline
    if conn.params.save_in_keychain.unwrap_or(false) {
        let cache = Arc::new(credential_cache::CredentialCache::default());
        let id = conn.id.clone();
        let pwd = tokio::task::spawn_blocking(move || {
            credential_cache::get_db_password_cached(&cache, &id)
        })
        .await
        .map_err(|e| e.to_string())?;

        if let Ok(p) = pwd {
            if !p.trim().is_empty() {
                conn.params.password = Some(p);
            }
        }
    }

    let expanded = expand_ssh_params(&conn.params).await?;
    let expanded = expand_k8s_params(&expanded).await?;
    let db_params = commands::resolve_connection_params(&expanded)?;
    Ok((conn, db_params))
}

/// Populate the driver registry for a headless process: the three built-in
/// drivers plus any installed plugin drivers, honoring the user's
/// `active_external_drivers` preference. Without this, headless modes can
/// only reach mysql/postgres/sqlite connections — every other driver fails
/// with "Unsupported driver".
pub async fn register_drivers() {
    // Required by code paths that go through `sqlx::Any` (e.g. the default
    // `test_connection`); the GUI installs these in `run()`, headless
    // processes must do it themselves.
    sqlx::any::install_default_drivers();

    driver_registry::register_driver(mysql::MysqlDriver::new()).await;
    driver_registry::register_driver(postgres::PostgresDriver::new()).await;
    driver_registry::register_driver(sqlite::SqliteDriver::new()).await;

    let app_config = config::load_config_from_disk();
    let plugin_configs = app_config.plugins.unwrap_or_default();
    let enabled_ids = app_config.active_external_drivers;
    plugins::manager::load_plugins_with_configs(plugin_configs, enabled_ids.as_deref()).await;
}

/// Resolve the driver for a saved connection. Returns the connection, the
/// resolved DB params, and the registered driver. Errors with "Unsupported
/// driver" when no driver matches the connection's `driver` id (e.g. the
/// plugin failed to load).
pub async fn resolve_db_driver(
    conn_id: &str,
) -> Result<(SavedConnection, ConnectionParams, Arc<dyn DatabaseDriver>), String> {
    let (conn, db_params) = resolve_db_params(conn_id).await?;
    let driver = driver_registry::get_driver(&conn.params.driver)
        .await
        .ok_or_else(|| format!("Unsupported driver: {}", conn.params.driver))?;
    Ok((conn, db_params, driver))
}
