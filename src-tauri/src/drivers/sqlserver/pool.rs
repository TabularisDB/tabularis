//! Tiberius-backed connection pool primitives.
//!
//! This file mirrors the shape of `deadpool_postgres`: a `Manager`
//! implementation that wraps `tiberius::Client` over a `tokio::net::TcpStream`
//! (adapted to the futures-io traits tiberius expects via `tokio-util::compat`).
//!
//! Phase 1 restrictions (intentional):
//! - SQL authentication only (user + password)
//! - `trust_cert()` is always enabled; Phase 2 exposes the toggle via `ConnectionParams`
//! - TLS encryption is requested on login only (`EncryptionLevel::On`)
//!
//! The actual `SQLSERVER_POOLS` registry + accessors live in
//! `crate::pool_manager` (Day 2); this module is runtime-agnostic.

use crate::models::ConnectionParams;
use deadpool::managed::{Manager, Metrics, RecycleError, RecycleResult};
use tiberius::{AuthMethod, Client, Config, EncryptionLevel};
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

/// A live tiberius client bound to a tokio TCP stream.
/// `deadpool` hands one of these out per checkout; the stream is owned by the
/// pool and reused across queries.
pub type TiberiusConnection = Client<Compat<TcpStream>>;

/// Deadpool `Manager` for tiberius connections.
#[derive(Debug, Clone)]
pub struct TiberiusManager {
    config: Config,
}

impl TiberiusManager {
    pub fn new(config: Config) -> Self {
        Self { config }
    }
}

impl Manager for TiberiusManager {
    type Type = TiberiusConnection;
    type Error = tiberius::error::Error;

    async fn create(&self) -> Result<Self::Type, Self::Error> {
        let tcp = TcpStream::connect(self.config.get_addr())
            .await
            .map_err(|e| tiberius::error::Error::Io {
                kind: e.kind(),
                message: e.to_string(),
            })?;
        // Disable Nagle's algorithm — the same thing the official mssql client
        // does; small query round-trips benefit.
        tcp.set_nodelay(true).ok();
        Client::connect(self.config.clone(), tcp.compat_write()).await
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
            .into_first_result()
            .await
            .map_err(RecycleError::Backend)?;
        Ok(())
    }
}

/// Build a `tiberius::Config` from Tabularis `ConnectionParams`.
///
/// Phase 1 consumes only: host, port, username, password, database.
/// Phase 2 will extend with `trust_server_certificate`, `encrypt`, `instance_name`.
pub fn build_config(params: &ConnectionParams) -> Result<Config, String> {
    let mut cfg = Config::new();
    cfg.host(params.host.as_deref().unwrap_or("localhost"));
    cfg.port(params.port.unwrap_or(1433));
    cfg.database(params.database.primary());
    cfg.authentication(AuthMethod::sql_server(
        params.username.as_deref().unwrap_or(""),
        params.password.as_deref().unwrap_or(""),
    ));
    // Phase 1 safety defaults: negotiate TLS on login only, and accept the
    // server's certificate without validation. Real TLS validation arrives
    // in Phase 2 together with the UI toggle.
    cfg.encryption(EncryptionLevel::On);
    cfg.trust_cert();
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
        // SQL Server rejects empty credentials at login time, but building the
        // config must never panic — the pool layer turns the login error into
        // a descriptive string instead.
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
        assert_send::<TiberiusManager>();
        assert_sync::<TiberiusManager>();
        assert_clone::<TiberiusManager>();
    }

    #[test]
    fn manager_new_stores_config() {
        let cfg = build_config(&base_params(Some("example.com"), Some(1433), "master"))
            .expect("config builds");
        let mgr = TiberiusManager::new(cfg);
        // Cloning the manager must not panic and must share the config.
        let cloned = mgr.clone();
        // We can't assert equality on tiberius::Config directly (no PartialEq),
        // but we can assert both managers return the same debug representation.
        let original = format!("{:?}", mgr);
        let cloned_dbg = format!("{:?}", cloned);
        assert_eq!(original, cloned_dbg);
    }
}
