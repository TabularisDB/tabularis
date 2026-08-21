use crate::models::{
    ConnectionParams, K8sConnection, K8sConnectionInput, SshConnection, SshConnectionInput,
    SshTestParams,
};
use crate::runtime::RuntimeContext;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use uuid::Uuid;

const SSH_SECRET_SUFFIX: &str = "ssh";
const SSH_PASSPHRASE_SUFFIX: &str = "ssh_passphrase";
const WEB_ASKPASS_TIMEOUT: Duration = Duration::from_secs(120);
const DESKTOP_ASKPASS_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug)]
pub enum TunnelCommand {
    GetSshConnections,
    SaveSshConnection {
        name: String,
        ssh: SshConnectionInput,
    },
    UpdateSshConnection {
        id: String,
        name: String,
        ssh: SshConnectionInput,
    },
    DeleteSshConnection {
        id: String,
    },
    TestSshConnection {
        ssh: SshTestParams,
    },
    RespondSshAskpass {
        id: u64,
        response: Option<String>,
    },
    GetK8sConnections,
    SaveK8sConnection {
        k8s: K8sConnectionInput,
    },
    UpdateK8sConnection {
        id: String,
        k8s: K8sConnectionInput,
    },
    DeleteK8sConnection {
        id: String,
    },
    TestK8sConnection {
        context: String,
        namespace: String,
        options: crate::k8s_tunnel::K8sCommandOptions,
    },
    GetK8sContexts {
        options: crate::k8s_tunnel::K8sCommandOptions,
    },
    GetK8sNamespaces {
        context: String,
        options: crate::k8s_tunnel::K8sCommandOptions,
    },
    GetK8sResources {
        context: String,
        namespace: String,
        resource_type: String,
        options: crate::k8s_tunnel::K8sCommandOptions,
    },
    GetK8sResourcePorts {
        context: String,
        namespace: String,
        resource_type: String,
        resource_name: String,
        options: crate::k8s_tunnel::K8sCommandOptions,
    },
    ValidateK8sPath {
        path: String,
        kind: String,
    },
}

pub async fn execute(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    command: TunnelCommand,
) -> Result<Value, String> {
    match command {
        TunnelCommand::GetSshConnections => json(get_ssh_connections(runtime, false)?),
        TunnelCommand::SaveSshConnection { name, ssh } => {
            json(save_ssh_connection(runtime, name, ssh, false)?)
        }
        TunnelCommand::UpdateSshConnection { id, name, ssh } => {
            json(update_ssh_connection(runtime, id, name, ssh, false)?)
        }
        TunnelCommand::DeleteSshConnection { id } => {
            delete_ssh_connection(runtime, &id)?;
            Ok(Value::Null)
        }
        TunnelCommand::TestSshConnection { ssh } => {
            json(test_ssh_connection(runtime, ssh, session_id).await?)
        }
        TunnelCommand::RespondSshAskpass { id, response } => {
            crate::askpass::respond_for_session(session_id, id, response)?;
            Ok(Value::Null)
        }
        TunnelCommand::GetK8sConnections => json(get_k8s_connections(runtime)?),
        TunnelCommand::SaveK8sConnection { k8s } => json(save_k8s_connection(runtime, k8s)?),
        TunnelCommand::UpdateK8sConnection { id, k8s } => {
            json(update_k8s_connection(runtime, id, k8s)?)
        }
        TunnelCommand::DeleteK8sConnection { id } => {
            delete_k8s_connection(runtime, &id)?;
            Ok(Value::Null)
        }
        TunnelCommand::TestK8sConnection {
            context,
            namespace,
            options,
        } => json(
            run_blocking(move || {
                crate::k8s_tunnel::test_k8s_connection(&context, &namespace, &options)
            })
            .await?,
        ),
        TunnelCommand::GetK8sContexts { options } => {
            json(run_blocking(move || crate::k8s_tunnel::get_k8s_contexts(&options)).await?)
        }
        TunnelCommand::GetK8sNamespaces { context, options } => json(
            run_blocking(move || crate::k8s_tunnel::get_k8s_namespaces(&context, &options)).await?,
        ),
        TunnelCommand::GetK8sResources {
            context,
            namespace,
            resource_type,
            options,
        } => json(
            run_blocking(move || {
                crate::k8s_tunnel::get_k8s_resources(&context, &namespace, &resource_type, &options)
            })
            .await?,
        ),
        TunnelCommand::GetK8sResourcePorts {
            context,
            namespace,
            resource_type,
            resource_name,
            options,
        } => json(
            run_blocking(move || {
                crate::k8s_tunnel::get_k8s_resource_ports(
                    &context,
                    &namespace,
                    &resource_type,
                    &resource_name,
                    &options,
                )
            })
            .await?,
        ),
        TunnelCommand::ValidateK8sPath { path, kind } => {
            crate::k8s_tunnel::validate_k8s_path(&path, &kind)?;
            Ok(Value::Null)
        }
    }
}

async fn run_blocking<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|error| error.to_string())?
}

pub fn get_ssh_connections(
    runtime: &RuntimeContext,
    reveal_secrets: bool,
) -> Result<Vec<SshConnection>, String> {
    let mut connections: Vec<SshConnection> = load_json(&ssh_path(runtime))?;
    for connection in &mut connections {
        normalize_ssh_auth_type(connection);
        if connection.save_in_keychain.unwrap_or(false) {
            connection.password = runtime
                .secrets
                .get(&secret_account(&connection.id, SSH_SECRET_SUFFIX))?;
            connection.key_passphrase = runtime
                .secrets
                .get(&secret_account(&connection.id, SSH_PASSPHRASE_SUFFIX))?;
        }
        if !reveal_secrets {
            connection.password = None;
            connection.key_passphrase = None;
        }
    }
    Ok(connections)
}

pub fn save_ssh_connection(
    runtime: &RuntimeContext,
    name: String,
    ssh: SshConnectionInput,
    reveal_secrets: bool,
) -> Result<SshConnection, String> {
    validate_ssh_input(&name, &ssh)?;
    let path = ssh_path(runtime);
    let mut connections: Vec<SshConnection> = load_json(&path)?;
    let id = Uuid::new_v4().to_string();
    let input_password = ssh.password.clone();
    let input_passphrase = ssh.key_passphrase.clone();
    let connection = persist_ssh_input(runtime, id, name, ssh, None)?;
    connections.push(connection.clone());
    save_json(&path, &connections)?;
    Ok(with_input_secrets(
        redact_ssh(connection, reveal_secrets),
        reveal_secrets,
        input_password,
        input_passphrase,
    ))
}

pub fn update_ssh_connection(
    runtime: &RuntimeContext,
    id: String,
    name: String,
    ssh: SshConnectionInput,
    reveal_secrets: bool,
) -> Result<SshConnection, String> {
    validate_ssh_input(&name, &ssh)?;
    let path = ssh_path(runtime);
    let mut connections: Vec<SshConnection> = load_json(&path)?;
    let index = connections
        .iter()
        .position(|connection| connection.id == id)
        .ok_or_else(|| "SSH connection not found".to_string())?;
    let previous = connections[index].clone();
    let input_password = ssh.password.clone();
    let input_passphrase = ssh.key_passphrase.clone();
    let connection = persist_ssh_input(runtime, id, name, ssh, Some(&previous))?;
    connections[index] = connection.clone();
    save_json(&path, &connections)?;
    Ok(with_input_secrets(
        redact_ssh(connection, reveal_secrets),
        reveal_secrets,
        input_password,
        input_passphrase,
    ))
}

pub fn delete_ssh_connection(runtime: &RuntimeContext, id: &str) -> Result<(), String> {
    let path = ssh_path(runtime);
    if !path.exists() {
        return Ok(());
    }
    let mut connections: Vec<SshConnection> = load_json(&path)?;
    connections.retain(|connection| connection.id != id);
    runtime
        .secrets
        .delete(&secret_account(id, SSH_SECRET_SUFFIX))?;
    runtime
        .secrets
        .delete(&secret_account(id, SSH_PASSPHRASE_SUFFIX))?;
    save_json(&path, &connections)
}

pub async fn test_ssh_connection(
    runtime: &RuntimeContext,
    mut ssh: SshTestParams,
    session_id: Option<Uuid>,
) -> Result<String, String> {
    restore_ssh_test_secrets(runtime, &mut ssh)?;

    emit_progress(
        runtime,
        session_id,
        ssh.progress_id.as_deref(),
        "sshTunnel",
        "start",
        Some(format!("{}@{}:{}", ssh.user, ssh.host, ssh.port)),
    );

    let allow_prompt = ssh.allow_passphrase_prompt.unwrap_or(false);
    let askpass = if allow_prompt {
        Some(crate::askpass::start_scoped_server(
            runtime.events.clone(),
            session_id,
            if session_id.is_some() {
                WEB_ASKPASS_TIMEOUT
            } else {
                DESKTOP_ASKPASS_TIMEOUT
            },
        )?)
    } else {
        None
    };
    let result = tokio::task::spawn_blocking(move || {
        crate::ssh_tunnel::test_ssh_connection_with_askpass(
            &ssh.host,
            ssh.port,
            &ssh.user,
            ssh.password.as_deref(),
            ssh.key_file.as_deref(),
            ssh.key_passphrase.as_deref(),
            allow_prompt,
            askpass,
        )
    })
    .await
    .map_err(|error| error.to_string())?;

    match &result {
        Ok(_) => emit_progress(
            runtime,
            session_id,
            ssh.progress_id.as_deref(),
            "sshTunnel",
            "ok",
            None,
        ),
        Err(error) => emit_progress(
            runtime,
            session_id,
            ssh.progress_id.as_deref(),
            "sshTunnel",
            "error",
            Some(error.clone()),
        ),
    }
    result
}

fn restore_ssh_test_secrets(
    runtime: &RuntimeContext,
    ssh: &mut SshTestParams,
) -> Result<(), String> {
    if let Some(connection_id) = ssh.connection_id.as_deref() {
        let saved = get_ssh_connection(runtime, connection_id, true)?;
        if ssh.password.as_deref().is_none_or(str::is_empty) {
            ssh.password = saved.password;
        }
        if ssh.key_passphrase.as_deref().is_none_or(str::is_empty) {
            ssh.key_passphrase = saved.key_passphrase;
        }
    }
    if let Some(connection_id) = ssh.db_connection_id.as_deref() {
        let saved_params =
            crate::persistence::load_connections_file(&runtime.paths.connections_file())
                .ok()
                .and_then(|file| {
                    file.connections
                        .into_iter()
                        .find(|connection| connection.id == connection_id)
                        .map(|connection| connection.params)
                });
        if ssh.password.as_deref().is_none_or(str::is_empty) {
            ssh.password = runtime
                .secrets
                .get(&secret_account(connection_id, SSH_SECRET_SUFFIX))?
                .or_else(|| {
                    saved_params
                        .as_ref()
                        .and_then(|params| params.ssh_password.clone())
                });
        }
        if ssh.key_passphrase.as_deref().is_none_or(str::is_empty) {
            ssh.key_passphrase = runtime
                .secrets
                .get(&secret_account(connection_id, SSH_PASSPHRASE_SUFFIX))?
                .or_else(|| {
                    saved_params
                        .as_ref()
                        .and_then(|params| params.ssh_key_passphrase.clone())
                });
        }
    }
    Ok(())
}

pub fn get_k8s_connections(runtime: &RuntimeContext) -> Result<Vec<K8sConnection>, String> {
    load_json(&k8s_path(runtime))
}

pub fn save_k8s_connection(
    runtime: &RuntimeContext,
    k8s: K8sConnectionInput,
) -> Result<K8sConnection, String> {
    validate_k8s_input(&k8s)?;
    let path = k8s_path(runtime);
    let mut connections: Vec<K8sConnection> = load_json(&path)?;
    let connection = k8s_from_input(Uuid::new_v4().to_string(), k8s);
    connections.push(connection.clone());
    save_json(&path, &connections)?;
    Ok(connection)
}

pub fn update_k8s_connection(
    runtime: &RuntimeContext,
    id: String,
    k8s: K8sConnectionInput,
) -> Result<K8sConnection, String> {
    validate_k8s_input(&k8s)?;
    let path = k8s_path(runtime);
    let mut connections: Vec<K8sConnection> = load_json(&path)?;
    let index = connections
        .iter()
        .position(|connection| connection.id == id)
        .ok_or_else(|| format!("K8s connection with ID {id} not found"))?;
    let connection = k8s_from_input(id, k8s);
    connections[index] = connection.clone();
    save_json(&path, &connections)?;
    Ok(connection)
}

pub fn delete_k8s_connection(runtime: &RuntimeContext, id: &str) -> Result<(), String> {
    let path = k8s_path(runtime);
    if !path.exists() {
        return Ok(());
    }
    let mut connections: Vec<K8sConnection> = load_json(&path)?;
    connections.retain(|connection| connection.id != id);
    save_json(&path, &connections)
}

pub fn expand_connection_params(
    runtime: &RuntimeContext,
    params: &ConnectionParams,
) -> Result<ConnectionParams, String> {
    let mut expanded = params.clone();
    if expanded.ssh_enabled.unwrap_or(false) {
        if let Some(id) = expanded.ssh_connection_id.as_deref() {
            let ssh = get_ssh_connection(runtime, id, true)?;
            expanded.ssh_host = Some(ssh.host);
            expanded.ssh_port = Some(ssh.port);
            expanded.ssh_user = Some(ssh.user);
            expanded.ssh_password = ssh.password;
            expanded.ssh_key_file = ssh.key_file;
            expanded.ssh_key_passphrase = ssh.key_passphrase;
            expanded.ssh_allow_passphrase_prompt = ssh.allow_passphrase_prompt;
        }
    }
    if expanded.k8s_enabled.unwrap_or(false) {
        if let Some(id) = expanded.k8s_connection_id.as_deref() {
            let k8s = get_k8s_connections(runtime)?
                .into_iter()
                .find(|connection| connection.id == id)
                .ok_or_else(|| format!("K8s connection with ID {id} not found"))?;
            expanded.k8s_context = Some(k8s.context);
            expanded.k8s_namespace = Some(k8s.namespace);
            expanded.k8s_resource_type = Some(k8s.resource_type);
            expanded.k8s_resource_name = Some(k8s.resource_name);
            expanded.k8s_port = Some(k8s.port);
            expanded.k8s_kubectl_path = k8s.kubectl_path;
            expanded.k8s_kubeconfig_path = k8s.kubeconfig_path;
        }
    }
    Ok(expanded)
}

pub fn resolve_connection_params(
    runtime: &RuntimeContext,
    params: &ConnectionParams,
    session_id: Option<Uuid>,
) -> Result<ConnectionParams, String> {
    let params = expand_connection_params(runtime, params)?;
    let askpass = scoped_askpass(runtime, &params, session_id)?;
    resolve_expanded_connection_params(&params, askpass)
}

pub fn resolve_expanded_connection_params(
    params: &ConnectionParams,
    askpass_server: Option<crate::askpass::AskpassServer>,
) -> Result<ConnectionParams, String> {
    if params.k8s_enabled.unwrap_or(false) && params.ssh_enabled.unwrap_or(false) {
        return Err(
            "Kubernetes and SSH tunnel cannot both be enabled for the same connection".to_string(),
        );
    }
    if params.k8s_enabled.unwrap_or(false) {
        return resolve_k8s_params(params);
    }
    if !params.ssh_enabled.unwrap_or(false) {
        return Ok(params.clone());
    }
    resolve_ssh_params(params, askpass_server)
}

fn resolve_ssh_params(
    params: &ConnectionParams,
    askpass_server: Option<crate::askpass::AskpassServer>,
) -> Result<ConnectionParams, String> {
    let ssh_host = params.ssh_host.as_deref().ok_or("Missing SSH Host")?;
    let ssh_port = params.ssh_port.unwrap_or(22);
    let ssh_user = params.ssh_user.as_deref().ok_or("Missing SSH User")?;
    let remote_host = params.host.as_deref().unwrap_or("localhost");
    let remote_port = params.port.unwrap_or(3306);
    let key =
        crate::ssh_tunnel::build_tunnel_key(ssh_user, ssh_host, ssh_port, remote_host, remote_port);
    if let Some(tunnel) = crate::ssh_tunnel::get_tunnels().lock().unwrap().get(&key) {
        let mut resolved = params.clone();
        resolved.host = Some("127.0.0.1".to_string());
        resolved.port = Some(tunnel.local_port);
        return Ok(resolved);
    }

    let allow_prompt = params.ssh_allow_passphrase_prompt.unwrap_or(false);
    let tunnel = crate::ssh_tunnel::SshTunnel::new_with_askpass(
        ssh_host,
        ssh_port,
        ssh_user,
        params.ssh_password.as_deref(),
        params.ssh_key_file.as_deref(),
        params.ssh_key_passphrase.as_deref(),
        allow_prompt,
        remote_host,
        remote_port,
        askpass_server,
    )?;
    let local_port = tunnel.local_port;
    crate::ssh_tunnel::get_tunnels()
        .lock()
        .unwrap()
        .insert(key, tunnel);
    let mut resolved = params.clone();
    resolved.host = Some("127.0.0.1".to_string());
    resolved.port = Some(local_port);
    Ok(resolved)
}

fn scoped_askpass(
    runtime: &RuntimeContext,
    params: &ConnectionParams,
    session_id: Option<Uuid>,
) -> Result<Option<crate::askpass::AskpassServer>, String> {
    if !params.ssh_allow_passphrase_prompt.unwrap_or(false) {
        return Ok(None);
    }
    crate::askpass::start_scoped_server(
        runtime.events.clone(),
        session_id,
        if session_id.is_some() {
            WEB_ASKPASS_TIMEOUT
        } else {
            DESKTOP_ASKPASS_TIMEOUT
        },
    )
    .map(Some)
}

fn resolve_k8s_params(params: &ConnectionParams) -> Result<ConnectionParams, String> {
    let context = params.k8s_context.as_deref().ok_or("Missing K8s context")?;
    let namespace = params
        .k8s_namespace
        .as_deref()
        .ok_or("Missing K8s namespace")?;
    let resource_type = params
        .k8s_resource_type
        .as_deref()
        .ok_or("Missing K8s resource type")?;
    let resource_name = params
        .k8s_resource_name
        .as_deref()
        .ok_or("Missing K8s resource name")?;
    let port = params.k8s_port.ok_or("Missing K8s port")?;
    let options = crate::k8s_tunnel::K8sCommandOptions::new(
        params.k8s_kubectl_path.clone(),
        params.k8s_kubeconfig_path.clone(),
    );
    let key = crate::k8s_tunnel::build_tunnel_key(
        context,
        namespace,
        resource_type,
        resource_name,
        port,
        &options,
    );
    if let Some(tunnel) = crate::k8s_tunnel::get_tunnels().lock().unwrap().get(&key) {
        let mut resolved = params.clone();
        resolved.k8s_enabled = Some(false);
        resolved.host = Some("127.0.0.1".to_string());
        resolved.port = Some(tunnel.local_port);
        return Ok(resolved);
    }
    let tunnel = crate::k8s_tunnel::K8sTunnel::new(
        context,
        namespace,
        resource_type,
        resource_name,
        port,
        &options,
    )?;
    let local_port = tunnel.local_port;
    crate::k8s_tunnel::get_tunnels()
        .lock()
        .unwrap()
        .insert(key, tunnel);
    let mut resolved = params.clone();
    resolved.k8s_enabled = Some(false);
    resolved.host = Some("127.0.0.1".to_string());
    resolved.port = Some(local_port);
    Ok(resolved)
}

fn persist_ssh_input(
    runtime: &RuntimeContext,
    id: String,
    name: String,
    ssh: SshConnectionInput,
    previous: Option<&SshConnection>,
) -> Result<SshConnection, String> {
    let keychain = ssh.save_in_keychain.unwrap_or(false);
    if keychain {
        set_secret(runtime, &id, SSH_SECRET_SUFFIX, ssh.password.as_deref())?;
        set_secret(
            runtime,
            &id,
            SSH_PASSPHRASE_SUFFIX,
            ssh.key_passphrase.as_deref(),
        )?;
    } else {
        runtime
            .secrets
            .delete(&secret_account(&id, SSH_SECRET_SUFFIX))?;
        runtime
            .secrets
            .delete(&secret_account(&id, SSH_PASSPHRASE_SUFFIX))?;
    }
    Ok(SshConnection {
        id,
        name,
        host: ssh.host,
        port: ssh.port,
        user: ssh.user,
        auth_type: Some(ssh.auth_type),
        password: (!keychain)
            .then(|| {
                ssh.password
                    .or_else(|| previous.and_then(|value| value.password.clone()))
            })
            .flatten(),
        key_file: ssh.key_file,
        key_passphrase: (!keychain)
            .then(|| {
                ssh.key_passphrase
                    .or_else(|| previous.and_then(|value| value.key_passphrase.clone()))
            })
            .flatten(),
        allow_passphrase_prompt: ssh.allow_passphrase_prompt,
        save_in_keychain: ssh.save_in_keychain,
    })
}

fn validate_ssh_input(name: &str, ssh: &SshConnectionInput) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Connection name is required".to_string());
    }
    if ssh.host.trim().is_empty() {
        return Err("SSH host is required".to_string());
    }
    if ssh.user.trim().is_empty() {
        return Err("SSH user is required".to_string());
    }
    if ssh.port == 0 {
        return Err("SSH port must be between 1 and 65535".to_string());
    }
    if !matches!(ssh.auth_type.as_str(), "password" | "ssh_key") {
        return Err("Authentication type must be password or ssh_key".to_string());
    }
    Ok(())
}

fn validate_k8s_input(k8s: &K8sConnectionInput) -> Result<(), String> {
    if k8s.name.trim().is_empty()
        || k8s.context.trim().is_empty()
        || k8s.namespace.trim().is_empty()
        || k8s.resource_name.trim().is_empty()
        || !matches!(k8s.resource_type.as_str(), "service" | "pod")
        || k8s.port == 0
    {
        return Err("Invalid Kubernetes connection profile".to_string());
    }
    crate::k8s_tunnel::validate_k8s_path(
        k8s.kubectl_path.as_deref().unwrap_or_default(),
        "kubectl",
    )?;
    crate::k8s_tunnel::validate_k8s_path(
        k8s.kubeconfig_path.as_deref().unwrap_or_default(),
        "kubeconfig",
    )
}

fn k8s_from_input(id: String, input: K8sConnectionInput) -> K8sConnection {
    K8sConnection {
        id,
        name: input.name,
        context: input.context,
        namespace: input.namespace,
        resource_type: input.resource_type,
        resource_name: input.resource_name,
        port: input.port,
        kubectl_path: input.kubectl_path,
        kubeconfig_path: input.kubeconfig_path,
    }
}

fn get_ssh_connection(
    runtime: &RuntimeContext,
    id: &str,
    reveal_secrets: bool,
) -> Result<SshConnection, String> {
    get_ssh_connections(runtime, reveal_secrets)?
        .into_iter()
        .find(|connection| connection.id == id)
        .ok_or_else(|| format!("SSH connection with ID {id} not found"))
}

fn normalize_ssh_auth_type(connection: &mut SshConnection) {
    if connection.auth_type.is_none() {
        connection.auth_type = Some(
            if connection
                .key_file
                .as_deref()
                .is_some_and(|key| !key.trim().is_empty())
            {
                "ssh_key"
            } else {
                "password"
            }
            .to_string(),
        );
    }
}

fn redact_ssh(mut connection: SshConnection, reveal_secrets: bool) -> SshConnection {
    if !reveal_secrets {
        connection.password = None;
        connection.key_passphrase = None;
    }
    connection
}

fn with_input_secrets(
    mut connection: SshConnection,
    reveal_secrets: bool,
    password: Option<String>,
    passphrase: Option<String>,
) -> SshConnection {
    if reveal_secrets {
        connection.password = password;
        connection.key_passphrase = passphrase;
    }
    connection
}

fn set_secret(
    runtime: &RuntimeContext,
    id: &str,
    suffix: &str,
    value: Option<&str>,
) -> Result<(), String> {
    if let Some(value) = value.filter(|value| !value.is_empty()) {
        runtime.secrets.set(&secret_account(id, suffix), value)?;
    }
    Ok(())
}

fn emit_progress(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    progress_id: Option<&str>,
    step: &str,
    status: &str,
    detail: Option<String>,
) {
    let Some(id) = progress_id else { return };
    let payload = serde_json::json!({
        "id": id,
        "step": step,
        "status": status,
        "detail": detail,
    });
    let _ = match session_id {
        Some(session_id) => runtime
            .events
            .emit_to(session_id, "connection-test-progress", payload),
        None => runtime.events.emit("connection-test-progress", payload),
    };
}

fn ssh_path(runtime: &RuntimeContext) -> PathBuf {
    runtime.paths.config_dir().join("ssh_connections.json")
}

fn k8s_path(runtime: &RuntimeContext) -> PathBuf {
    runtime.paths.config_dir().join("k8s_connections.json")
}

fn secret_account(id: &str, suffix: &str) -> String {
    format!("{id}:{suffix}")
}

fn load_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Vec<T>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

fn save_json(path: &Path, values: &[impl Serialize]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(values).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

fn json(value: impl Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "tunnels_tests.rs"]
mod tests;
