//! tiberius connection pool primitives.
//!
//! Pools `tiberius::Client` objects via a custom deadpool manager over a
//! Tokio TCP stream adapted to the futures I/O traits Tiberius expects.
//!
//! Current authentication support is SQL Server username/password. TLS uses
//! Tabularis' shared `ssl_mode`: `disable` turns encryption off,
//! `verify-full` requires the system trust store and hostname verification,
//! `require` encrypts while accepting the server certificate, and `prefer`
//! requests encrypted local-development-compatible connections.

use crate::models::ConnectionParams;
use deadpool::managed::{Manager, Metrics, RecycleError, RecycleResult};
use tiberius::{AuthMethod, Client, Config, EncryptionLevel};
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

/// A live Tiberius client. `deadpool` hands one of these out per checkout.
pub type BridgeConnection = Client<Compat<TcpStream>>;

/// Deadpool `Manager` for tiberius connections.
#[derive(Debug, Clone)]
pub struct BridgeManager {
    config: Config,
    startup_script: Option<String>,
}

impl BridgeManager {
    pub fn new(config: Config, startup_script: Option<String>) -> Self {
        Self {
            config,
            startup_script,
        }
    }

    async fn apply_startup_script(
        &self,
        conn: &mut BridgeConnection,
    ) -> Result<(), tiberius::error::Error> {
        if let Some(script) = self.startup_script.as_deref() {
            conn.simple_query(script)
                .await
                .map_err(startup_script_error)?
                .into_results()
                .await
                .map_err(startup_script_error)?;
        }
        Ok(())
    }
}

fn startup_script_error(error: tiberius::error::Error) -> tiberius::error::Error {
    tiberius::error::Error::Io {
        kind: std::io::ErrorKind::Other,
        message: format!("Startup script failed: {error}"),
    }
}

impl Manager for BridgeManager {
    type Type = BridgeConnection;
    type Error = tiberius::error::Error;

    async fn create(&self) -> Result<Self::Type, Self::Error> {
        let tcp = TcpStream::connect(self.config.get_addr())
            .await
            .map_err(|error| tiberius::error::Error::Io {
                kind: error.kind(),
                message: error.to_string(),
            })?;
        let _ = tcp.set_nodelay(true);
        let mut client = Client::connect(self.config.clone(), tcp.compat_write()).await?;
        self.apply_startup_script(&mut client).await?;
        Ok(client)
    }

    async fn recycle(&self, conn: &mut Self::Type, _: &Metrics) -> RecycleResult<Self::Error> {
        // Reset transaction, temporary-object, and SET state before another
        // caller receives this physical session, then restore its configured
        // startup script.
        conn.simple_query("EXEC sp_reset_connection")
            .await
            .map_err(RecycleError::Backend)?
            .into_results()
            .await
            .map_err(RecycleError::Backend)?;
        self.apply_startup_script(conn)
            .await
            .map_err(RecycleError::Backend)?;
        Ok(())
    }
}

/// Build a `tiberius::Config` from Tabularis `ConnectionParams`.
///
/// Consumes the shared connection fields used by current Tabularis drivers.
/// SQL Server authentication is currently username/password only. TLS maps
/// the standard `ssl_mode` values onto the Tiberius encryption policy.
pub fn build_config(params: &ConnectionParams) -> Result<Config, String> {
    let mut cfg = Config::new();
    cfg.host(params.host.as_deref().unwrap_or("localhost"));
    cfg.port(params.port.unwrap_or(1433));
    cfg.database(params.database.primary());
    cfg.authentication(AuthMethod::sql_server(
        params.username.as_deref().unwrap_or("sa"),
        params.password.as_deref().unwrap_or(""),
    ));

    if params
        .ssl_ca
        .as_deref()
        .is_some_and(|path| !path.is_empty())
    {
        return Err(
            "SQL Server custom CA files are not supported; use verify-full with the system trust store"
                .into(),
        );
    }
    if params
        .ssl_cert
        .as_deref()
        .is_some_and(|path| !path.is_empty())
        || params
            .ssl_key
            .as_deref()
            .is_some_and(|path| !path.is_empty())
    {
        return Err("SQL Server client certificates are not supported".into());
    }

    match params.ssl_mode.as_deref() {
        Some("disable" | "disabled") => {
            cfg.encryption(EncryptionLevel::NotSupported);
        }
        Some("require" | "required") => {
            cfg.encryption(EncryptionLevel::Required);
            cfg.trust_cert();
        }
        Some("verify-full" | "verify_identity") => {
            cfg.encryption(EncryptionLevel::Required);
        }
        Some("verify-ca" | "verify_ca") => {
            return Err(
                "SQL Server verify-ca is not supported; use verify-full/verify_identity for certificate and hostname verification"
                    .into(),
            );
        }
        _ => {
            cfg.encryption(EncryptionLevel::On);
            cfg.trust_cert();
        }
    }

    Ok(cfg)
}

#[cfg(test)]
mod tests;
