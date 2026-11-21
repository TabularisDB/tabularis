//! Ping and reconnect I/O shared by the transports' health loops.

use crate::application::connection_lifecycle::PingOutcome;
use crate::health_check::PING_TIMEOUT;
use crate::models::ConnectionParams;

pub(crate) fn is_builtin_driver(driver: &str) -> bool {
    matches!(driver, "mysql" | "postgres" | "sqlite")
}

/// Ping a connection through its existing pool, without opening one.
pub(crate) async fn ping_resolved(params: &ConnectionParams, connection_id: &str) -> PingOutcome {
    if is_builtin_driver(&params.driver)
        && !crate::pool_manager::has_pool(params, Some(connection_id)).await
    {
        return PingOutcome::Error("No active connection pool".into());
    }

    let Some(driver) = crate::drivers::registry::get_driver(&params.driver).await else {
        return PingOutcome::Error(format!("Driver not found: {}", params.driver));
    };

    match tokio::time::timeout(PING_TIMEOUT, driver.ping(params)).await {
        Ok(Ok(())) => PingOutcome::Ok,
        Ok(Err(err)) => PingOutcome::Error(err),
        Err(_) => PingOutcome::TimedOut,
    }
}

/// Open a fresh pool for a built-in driver and ping through it. Plugin drivers
/// own their connections, so for them this is one more `ping`.
pub(crate) async fn reconnect(
    params: &ConnectionParams,
    connection_id: &str,
) -> Result<(), String> {
    let id = Some(connection_id);
    match params.driver.as_str() {
        "postgres" => drop(crate::pool_manager::get_postgres_pool_with_id(params, id).await?),
        "mysql" => drop(crate::pool_manager::get_mysql_pool_with_id(params, id).await?),
        "sqlite" => drop(crate::pool_manager::get_sqlite_pool_with_id(params, id).await?),
        _ => {}
    }
    let driver = crate::drivers::registry::get_driver(&params.driver)
        .await
        .ok_or_else(|| format!("Driver not found: {}", params.driver))?;
    driver.ping(params).await
}
