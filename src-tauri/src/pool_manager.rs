use crate::models::ConnectionParams;
use once_cell::sync::Lazy;
use sqlx::{MySql, Pool, Postgres, Sqlite};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use urlencoding::encode;

type PoolMap<T> = Arc<RwLock<HashMap<String, Pool<T>>>>;

static MYSQL_POOLS: Lazy<PoolMap<MySql>> = Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));
static POSTGRES_POOLS: Lazy<PoolMap<Postgres>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));
static SQLITE_POOLS: Lazy<PoolMap<Sqlite>> = Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

/// Build a stable connection key that works with SSH tunnels.
/// If connection_id is provided (from saved connections), use it for stable pooling.
/// Otherwise fall back to host:port:database (for ad-hoc connections).
fn build_connection_key(params: &ConnectionParams, connection_id: Option<&str>) -> String {
    if let Some(conn_id) = connection_id {
        // Include database in key so different databases on the same connection use separate pools
        format!("{}:conn:{}:{}", params.driver, conn_id, params.database)
    } else {
        // Fall back to host:port:database for ad-hoc connections
        format!(
            "{}:{}:{}:{}",
            params.driver,
            params.host.as_deref().unwrap_or("localhost"),
            params.port.unwrap_or(0),
            params.database
        )
    }
}

fn build_mysql_url(params: &ConnectionParams) -> String {
    let user = encode(params.username.as_deref().unwrap_or_default());
    let pass = encode(params.password.as_deref().unwrap_or_default());
    format!(
        "mysql://{}:{}@{}:{}/{}?maxAllowedPacket=1073741824&socketTimeout=600000&connectTimeout=60000",
        user,
        pass,
        params.host.as_deref().unwrap_or("localhost"),
        params.port.unwrap_or(3306),
        params.database
    )
}

fn build_postgres_url(params: &ConnectionParams) -> String {
    let user = encode(params.username.as_deref().unwrap_or_default());
    let pass = encode(params.password.as_deref().unwrap_or_default());
    format!(
        "postgres://{}:{}@{}:{}/{}",
        user,
        pass,
        params.host.as_deref().unwrap_or("localhost"),
        params.port.unwrap_or(5432),
        params.database
    )
}

fn build_sqlite_url(params: &ConnectionParams) -> String {
    format!("sqlite://{}", params.database)
}

pub async fn get_mysql_pool(params: &ConnectionParams) -> Result<Pool<MySql>, String> {
    let connection_id = params.connection_id.as_deref();
    get_mysql_pool_with_id(params, connection_id).await
}

pub async fn get_mysql_pool_with_id(
    params: &ConnectionParams,
    connection_id: Option<&str>,
) -> Result<Pool<MySql>, String> {
    let key = build_connection_key(params, connection_id);
    // Try to get existing pool
    {
        let pools = MYSQL_POOLS.read().await;
        if let Some(pool) = pools.get(&key) {
            log::debug!(
                "Using existing MySQL connection pool for: {} (key: {})",
                params.database,
                key
            );
            return Ok(pool.clone());
        }
    }

    // Create new pool
    log::info!(
        "Creating new MySQL connection pool for: {}@{:?} (key: {})",
        params.username.as_deref().unwrap_or("unknown"),
        params.host,
        key
    );
    let url = build_mysql_url(params);
    let pool = sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(crate::config::get_pool_max_connections())
        .connect(&url)
        .await
        .map_err(|e| {
            log::error!("Failed to create MySQL connection pool: {}", e);
            e.to_string()
        })?;
    log::info!(
        "MySQL connection pool created successfully for: {} (key: {})",
        params.database,
        key
    );

    // Store pool
    {
        let mut pools = MYSQL_POOLS.write().await;
        pools.insert(key, pool.clone());
    }

    Ok(pool)
}

pub async fn get_postgres_pool(params: &ConnectionParams) -> Result<Pool<Postgres>, String> {
    let connection_id = params.connection_id.as_deref();
    get_postgres_pool_with_id(params, connection_id).await
}

pub async fn get_postgres_pool_with_id(
    params: &ConnectionParams,
    connection_id: Option<&str>,
) -> Result<Pool<Postgres>, String> {
    let key = build_connection_key(params, connection_id);

    // Try to get existing pool
    {
        let pools = POSTGRES_POOLS.read().await;
        if let Some(pool) = pools.get(&key) {
            log::debug!(
                "Using existing PostgreSQL connection pool for: {} (key: {})",
                params.database,
                key
            );
            return Ok(pool.clone());
        }
    }

    // Create new pool
    log::info!(
        "Creating new PostgreSQL connection pool for: {}@{:?} (key: {})",
        params.username.as_deref().unwrap_or("unknown"),
        params.host,
        key
    );
    let url = build_postgres_url(params);
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(crate::config::get_pool_max_connections())
        .connect(&url)
        .await
        .map_err(|e| {
            log::error!("Failed to create PostgreSQL connection pool: {}", e);
            e.to_string()
        })?;
    log::info!("Max connections: {}", crate::config::get_pool_max_connections());
    log::info!(
        "PostgreSQL connection pool created successfully for: {} (key: {})",
        params.database,
        key
    );

    // Store pool
    {
        let mut pools = POSTGRES_POOLS.write().await;
        pools.insert(key, pool.clone());
    }

    Ok(pool)
}

pub async fn get_sqlite_pool(params: &ConnectionParams) -> Result<Pool<Sqlite>, String> {
    let connection_id = params.connection_id.as_deref();
    get_sqlite_pool_with_id(params, connection_id).await
}

pub async fn get_sqlite_pool_with_id(
    params: &ConnectionParams,
    connection_id: Option<&str>,
) -> Result<Pool<Sqlite>, String> {
    let key = build_connection_key(params, connection_id);

    // Try to get existing pool
    {
        let pools = SQLITE_POOLS.read().await;
        if let Some(pool) = pools.get(&key) {
            log::debug!(
                "Using existing SQLite connection pool for: {} (key: {})",
                params.database,
                key
            );
            return Ok(pool.clone());
        }
    }

    // Create new pool
    log::info!(
        "Creating new SQLite connection pool for database: {} (key: {})",
        params.database,
        key
    );
    let url = build_sqlite_url(params);
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(crate::config::get_pool_max_connections())
        .connect(&url)
        .await
        .map_err(|e| {
            log::error!("Failed to create SQLite connection pool: {}", e);
            e.to_string()
        })?;

    log::info!(
        "SQLite connection pool created successfully for: {} (key: {})",
        params.database,
        key
    );

    // Store pool
    {
        let mut pools = SQLITE_POOLS.write().await;
        pools.insert(key, pool.clone());
    }

    Ok(pool)
}

/// Close a specific connection pool
pub async fn close_pool(params: &ConnectionParams) {
    let connection_id = params.connection_id.as_deref();
    close_pool_with_id(params, connection_id).await;
}

/// Close a specific connection pool by connection_id
pub async fn close_pool_with_id(params: &ConnectionParams, connection_id: Option<&str>) {
    let key = build_connection_key(params, connection_id);

    match params.driver.as_str() {
        "mysql" => {
            let mut pools = MYSQL_POOLS.write().await;
            if let Some(pool) = pools.remove(&key) {
                log::info!(
                    "Closing MySQL connection pool for: {} (key: {})",
                    params.database,
                    key
                );
                pool.close().await;
                log::info!(
                    "MySQL connection pool closed for: {} (key: {})",
                    params.database,
                    key
                );
            }
        }
        "postgres" => {
            let mut pools = POSTGRES_POOLS.write().await;
            if let Some(pool) = pools.remove(&key) {
                log::info!(
                    "Closing PostgreSQL connection pool for: {} (key: {})",
                    params.database,
                    key
                );
                pool.close().await;
                log::info!(
                    "PostgreSQL connection pool closed for: {} (key: {})",
                    params.database,
                    key
                );
            }
        }
        "sqlite" => {
            let mut pools = SQLITE_POOLS.write().await;
            if let Some(pool) = pools.remove(&key) {
                log::info!(
                    "Closing SQLite connection pool for: {} (key: {})",
                    params.database,
                    key
                );
                pool.close().await;
                log::info!(
                    "SQLite connection pool closed for: {} (key: {})",
                    params.database,
                    key
                );
            }
        }
        _ => {}
    }
}

/// Close all connection pools (useful on app shutdown)
pub async fn close_all_pools() {
    {
        let mut pools = MYSQL_POOLS.write().await;
        for (_, pool) in pools.drain() {
            pool.close().await;
        }
    }
    {
        let mut pools = POSTGRES_POOLS.write().await;
        for (_, pool) in pools.drain() {
            pool.close().await;
        }
    }
    {
        let mut pools = SQLITE_POOLS.write().await;
        for (_, pool) in pools.drain() {
            pool.close().await;
        }
    }
}
