//! mssql-tiberius-bridge connection pool primitives.
//!
//! Pools `mssql_tiberius_bridge::Client` objects via a custom deadpool Manager.
//! The bridge Client provides tiberius-compatible `.query()` and `.simple_query()`
//! methods over Microsoft's mssql-tds protocol implementation.
//!
//! Phase 1 restrictions (intentional):
//! - SQL authentication only (user + password)
//! - `trust_cert()` is always enabled; Phase 2 exposes the toggle via `ConnectionParams`
//! - TLS encryption is requested on login only (`EncryptionLevel::On`)

use crate::models::ConnectionParams;
use deadpool::managed::{Manager, Metrics, RecycleError, RecycleResult};
use mssql_tiberius_bridge::{AuthMethod, Client, Config, EncryptionLevel};

/// A live bridge client. `deadpool` hands one of these out per checkout.
pub type BridgeConnection = Client;

/// Deadpool `Manager` for mssql-tiberius-bridge connections.
#[derive(Debug, Clone)]
pub struct BridgeManager {
    config: Config,
}

impl BridgeManager {
    pub fn new(config: Config) -> Self {
        Self { config }
    }
}

impl Manager for BridgeManager {
    type Type = BridgeConnection;
    type Error = mssql_tiberius_bridge::Error;

    async fn create(&self) -> Result<Self::Type, Self::Error> {
        Client::connect(&self.config).await
    }

    async fn recycle(
        &self,
        conn: &mut Self::Type,
        _: &Metrics,
    ) -> RecycleResult<Self::Error> {
        // Cheap server-side round-trip to detect dead sockets.
        conn.simple_query("SELECT 1")
            .await
            .map_err(RecycleError::Backend)?
            .into_first_result();
        Ok(())
    }
}

/// Build a `mssql_tiberius_bridge::Config` from Tabularis `ConnectionParams`.
///
/// Consumes: host, port, username, password, database, instance_name,
/// encrypt, trust_server_certificate.
/// `domain` and `auth_mode` are parsed but actual Windows/Azure AD
/// authentication wiring is deferred to Phase 3.
pub fn build_config(params: &ConnectionParams) -> Result<Config, String> {
    let mut cfg = Config::new();
    cfg.host(params.host.as_deref().unwrap_or("localhost"));
    cfg.port(params.port.unwrap_or(1433));
    if let Some(instance_name) = params.instance_name.as_deref() {
        cfg.instance_name(instance_name);
    }
    cfg.database(params.database.primary());
    cfg.authentication(AuthMethod::sql_server(
        params.username.as_deref().unwrap_or(""),
        params.password.as_deref().unwrap_or(""),
    ));
    // Encryption level: "strict" → Required, "no" → NotSupported, default → On
    match params.encrypt.as_deref() {
        Some("strict") => cfg.encryption(EncryptionLevel::Required),
        Some("no") => cfg.encryption(EncryptionLevel::NotSupported),
        _ => cfg.encryption(EncryptionLevel::On),
    };

    // Trust server certificate (default true for backward compat)
    if params.trust_server_certificate.unwrap_or(true) {
        cfg.trust_cert();
    }

    Ok(cfg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ConnectionParams, DatabaseSelection};

    fn base_params(host: Option<&str>, port: Option<u16>, db: &str) -> ConnectionParams {
        ConnectionParams {
            driver: "sqlserver".into(),
            host: host.map(String::from),
            port,
            username: Some("sa".into()),
            password: Some("Strong!Pass123".into()),
            database: DatabaseSelection::Single(db.into()),
            ssl_mode: None,
            ssl_ca: None,
            ssl_cert: None,
            ssl_key: None,
            ssh_enabled: None,
            ssh_connection_id: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_password: None,
            ssh_key_file: None,
            ssh_key_passphrase: None,
            save_in_keychain: None,
            connection_id: None,
            ..Default::default()
        }
    }

    #[test]
    fn build_config_uses_explicit_host_port() {
        let cfg = build_config(&base_params(Some("db.internal"), Some(1445), "master"))
            .expect("config builds");
        assert_eq!(cfg.get_addr(), "db.internal:1445");
    }

    #[test]
    fn build_config_defaults_host_to_localhost() {
        let cfg = build_config(&base_params(None, Some(1433), "master")).expect("config builds");
        assert_eq!(cfg.get_addr(), "localhost:1433");
    }

    #[test]
    fn build_config_defaults_port_to_1433() {
        let cfg =
            build_config(&base_params(Some("localhost"), None, "master")).expect("config builds");
        assert_eq!(cfg.get_addr(), "localhost:1433");
    }

    #[test]
    fn build_config_empty_credentials_do_not_panic() {
        let mut params = base_params(Some("localhost"), Some(1433), "master");
        params.username = None;
        params.password = None;
        assert!(build_config(&params).is_ok());
    }

    #[test]
    fn manager_is_clone_send_sync() {
        fn assert_send<T: Send>() {}
        fn assert_sync<T: Sync>() {}
        fn assert_clone<T: Clone>() {}
        assert_send::<BridgeManager>();
        assert_sync::<BridgeManager>();
        assert_clone::<BridgeManager>();
    }

    #[test]
    fn manager_new_stores_config() {
        let cfg = build_config(&base_params(Some("example.com"), Some(1433), "master"))
            .expect("config builds");
        let mgr = BridgeManager::new(cfg);
        let cloned = mgr.clone();
        let original = format!("{:?}", mgr);
        let cloned_dbg = format!("{:?}", cloned);
        assert_eq!(original, cloned_dbg);
    }

    // --- Phase 2: TLS/auth field tests (issue #144) ---

    #[test]
    fn build_config_encrypt_strict() {
        let mut params = base_params(Some("localhost"), Some(1433), "master");
        params.encrypt = Some("strict".into());
        let cfg = build_config(&params).expect("config builds");
        assert_eq!(cfg.get_addr(), "localhost:1433");
    }

    #[test]
    fn build_config_encrypt_no() {
        let mut params = base_params(Some("localhost"), Some(1433), "master");
        params.encrypt = Some("no".into());
        let cfg = build_config(&params).expect("config builds");
        assert_eq!(cfg.get_addr(), "localhost:1433");
    }

    #[test]
    fn build_config_encrypt_default_when_none() {
        let params = base_params(Some("localhost"), Some(1433), "master");
        let cfg = build_config(&params).expect("config builds");
        assert_eq!(cfg.get_addr(), "localhost:1433");
    }

    #[test]
    fn build_config_trust_cert_false() {
        let mut params = base_params(Some("localhost"), Some(1433), "master");
        params.trust_server_certificate = Some(false);
        assert!(build_config(&params).is_ok());
    }

    #[test]
    fn build_config_trust_cert_true_explicit() {
        let mut params = base_params(Some("localhost"), Some(1433), "master");
        params.trust_server_certificate = Some(true);
        assert!(build_config(&params).is_ok());
    }

    #[test]
    fn build_config_trust_cert_default_when_none() {
        let params = base_params(Some("localhost"), Some(1433), "master");
        assert!(build_config(&params).is_ok());
    }

    #[test]
    fn build_config_auth_mode_parse_only() {
        let mut params = base_params(Some("localhost"), Some(1433), "master");
        params.auth_mode = Some("windows".into());
        assert!(build_config(&params).is_ok());
    }

    #[test]
    fn build_config_domain_parse_only() {
        let mut params = base_params(Some("localhost"), Some(1433), "master");
        params.domain = Some("CORP".into());
        assert!(build_config(&params).is_ok());
    }

    #[test]
    fn build_config_instance_name() {
        let mut params = base_params(Some("db.internal"), None, "master");
        params.instance_name = Some("SQLEXPRESS".into());
        let cfg = build_config(&params).expect("config builds");
        assert_eq!(cfg.datasource_string(), r"tcp:db.internal\SQLEXPRESS");
    }

    #[test]
    fn build_config_all_new_fields_together() {
        let mut params = base_params(Some("prod-sql"), Some(1444), "appdb");
        params.domain = Some("CORP".into());
        params.instance_name = Some("REPORTING".into());
        params.encrypt = Some("strict".into());
        params.trust_server_certificate = Some(false);
        params.auth_mode = Some("azure-ad".into());
        let cfg = build_config(&params).expect("config builds");
        assert!(cfg.get_addr().contains("prod-sql"));
    }
}
