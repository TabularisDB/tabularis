//! Pluggable traffic-scope registry.
//!
//! Adding a new scope: append a constant + `ProxyScopeMeta` entry here, then
//! call `resolve` at the new call site. Settings UI checkboxes render from
//! `PROXY_SCOPES` (mirrored on the TypeScript side).

/// Application HTTP: updates, plugin/registry downloads, WebDAV backup.
pub const SCOPE_APP_HTTP: &str = "app_http";
/// Direct database TCP (after SSH/K8s rewrite).
pub const SCOPE_DATABASE: &str = "database";
/// LLM provider HTTP in `ai.rs`.
pub const SCOPE_AI: &str = "ai";
/// Outbound TCP to an SSH bastion.
pub const SCOPE_SSH_TUNNEL: &str = "ssh_tunnel";

#[derive(Debug, Clone, Copy)]
pub struct ProxyScopeMeta {
    pub id: &'static str,
    /// i18n key under `settings.network.scopes.*`
    pub label_key: &'static str,
    pub description_key: &'static str,
}

pub const PROXY_SCOPES: &[ProxyScopeMeta] = &[
    ProxyScopeMeta {
        id: SCOPE_APP_HTTP,
        label_key: "settings.network.scopes.appHttp",
        description_key: "settings.network.scopes.appHttpDesc",
    },
    ProxyScopeMeta {
        id: SCOPE_DATABASE,
        label_key: "settings.network.scopes.database",
        description_key: "settings.network.scopes.databaseDesc",
    },
    ProxyScopeMeta {
        id: SCOPE_AI,
        label_key: "settings.network.scopes.ai",
        description_key: "settings.network.scopes.aiDesc",
    },
    ProxyScopeMeta {
        id: SCOPE_SSH_TUNNEL,
        label_key: "settings.network.scopes.sshTunnel",
        description_key: "settings.network.scopes.sshTunnelDesc",
    },
];

pub fn is_known_scope(id: &str) -> bool {
    PROXY_SCOPES.iter().any(|s| s.id == id)
}
