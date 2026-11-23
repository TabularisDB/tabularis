//! Identity of the server a recorded save was written to.
//!
//! History is stored under the saved connection's id, which survives edits to
//! its host, port or tunnel. Each record therefore carries a fingerprint of
//! the connection target, and a restore is only offered while the saved
//! connection still produces the same one. The password is not part of it, so
//! rotating it keeps the history valid; the username is, because it can select
//! the backend behind a shared host.

use crate::models::ConnectionParams;
use sha2::{Digest, Sha256};

/// The connection's target, with SSH and Kubernetes profiles expanded to what
/// they point at. SSH profiles are loaded without touching the keychain.
pub fn expand_target(
    runtime: &crate::runtime::RuntimeContext,
    params: &ConnectionParams,
) -> Result<ConnectionParams, String> {
    let mut expanded = params.clone();
    if expanded.ssh_enabled.unwrap_or(false) {
        if let Some(id) = expanded.ssh_connection_id.as_deref() {
            let ssh = crate::application::tunnels::get_ssh_connection_targets(runtime)?
                .into_iter()
                .find(|connection| connection.id == id)
                .ok_or_else(|| format!("SSH connection with ID {id} not found"))?;
            expanded.ssh_host = Some(ssh.host);
            expanded.ssh_port = Some(ssh.port);
            expanded.ssh_user = Some(ssh.user);
        }
    }
    if expanded.k8s_enabled.unwrap_or(false) {
        if let Some(id) = expanded.k8s_connection_id.as_deref() {
            let k8s = crate::application::tunnels::get_k8s_connections(runtime)?
                .into_iter()
                .find(|connection| connection.id == id)
                .ok_or_else(|| format!("K8s connection with ID {id} not found"))?;
            expanded.k8s_kubeconfig_path = k8s.kubeconfig_path;
            expanded.k8s_context = Some(k8s.context);
            expanded.k8s_namespace = Some(k8s.namespace);
            expanded.k8s_resource_type = Some(k8s.resource_type);
            expanded.k8s_resource_name = Some(k8s.resource_name);
            expanded.k8s_port = Some(k8s.port);
        }
    }
    Ok(expanded)
}

/// A connection URI without the credentials it may embed.
fn strip_userinfo(uri: &str) -> String {
    let Some(scheme_end) = uri.find("://") else {
        return uri.to_string();
    };
    let rest = &uri[scheme_end + 3..];
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    match rest[..authority_end].rfind('@') {
        Some(at) => format!("{}{}", &uri[..scheme_end + 3], &rest[at + 1..]),
        None => uri.to_string(),
    }
}

fn normalized(value: &Option<String>) -> Option<String> {
    value
        .as_ref()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
}

/// Stable hex fingerprint of where `params` connects to.
pub fn target_fingerprint(params: &ConnectionParams) -> String {
    let parts = serde_json::json!([
        params.driver.trim().to_lowercase(),
        normalized(&params.host),
        params.port,
        // Poolers (e.g. Supabase) select the backend by username on a shared host.
        params.username.as_deref().map(str::trim),
        params.unix_socket_path,
        // Saved connections have `connection_uri` stripped before persisting, so
        // this is `None` for them today. It matters once a URI-based driver keeps
        // it in the saved connection.
        params.connection_uri.as_deref().map(strip_userinfo),
        params.ssh_enabled.unwrap_or(false),
        normalized(&params.ssh_host),
        params.ssh_port,
        params.ssh_user.as_deref().map(str::trim),
        params.k8s_enabled.unwrap_or(false),
        params.k8s_kubeconfig_path,
        params.k8s_context,
        params.k8s_namespace,
        params.k8s_resource_type,
        params.k8s_resource_name,
        params.k8s_port,
        params.ssm_enabled.unwrap_or(false),
        params.ssm_target,
        params.ssm_profile,
        params.ssm_region,
    ]);
    let digest = Sha256::digest(parts.to_string().as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}
