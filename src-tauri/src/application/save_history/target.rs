//! Identity of the server a recorded save was written to.
//!
//! History is stored under the saved connection's id, which survives edits to
//! its host, port or tunnel. Each record therefore carries a fingerprint of
//! the connection target, and a restore is only offered while the saved
//! connection still produces the same one. The password is not part of it, so
//! rotating it keeps the history valid; the username is, because it can select
//! the backend behind a shared host.
//!
//! The fingerprint is taken from a `SavedConnectionSnapshot`
//! (`crate::application::connections`): the saved connection with its SSH and
//! Kubernetes profiles already expanded, which is also what the connection that
//! gets opened is resolved from. The proxy the traffic goes through is part of
//! it too, whether it comes from the connection or from the global settings.

use crate::application::tunnels::{effective_proxy_route, ProxyRoute};
use crate::models::ConnectionParams;
use sha2::{Digest, Sha256};

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
    fingerprint_with_route(params, effective_proxy_route(params).as_ref())
}

/// The fingerprint for a proxy route that was resolved earlier, so it matches
/// what a snapshot connects through.
pub fn fingerprint_with_route(params: &ConnectionParams, route: Option<&ProxyRoute>) -> String {
    let parts = serde_json::json!([
        params.driver.trim().to_lowercase(),
        normalized(&params.host),
        params.port,
        // Poolers (e.g. Supabase) select the backend by username on a shared host.
        params.username.as_deref().map(str::trim),
        params.unix_socket_path,
        // The URI is restored from the keychain before the snapshot is taken.
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
        // A proxy can lead the same host name to a different server.
        route.map(|route| {
            serde_json::json!([
                route.scope,
                route.protocol,
                route.host,
                route.port,
                route.username.as_deref().map(str::trim),
            ])
        }),
    ]);
    let digest = Sha256::digest(parts.to_string().as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}
