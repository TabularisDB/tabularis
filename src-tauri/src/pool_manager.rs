use crate::models::ConnectionParams;
use deadpool_postgres::{Manager as PgPoolManager, Pool as PgPool};
use native_tls::TlsConnector;
use once_cell::sync::Lazy;
use postgres_native_tls::MakeTlsConnector;
use sqlx::{sqlite::SqliteConnectOptions, MySql, Pool, Sqlite};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_postgres::{config::SslMode as PgSslMode, Config as PgConfig};

type PoolMap<T> = Arc<RwLock<HashMap<String, Pool<T>>>>;
type PgPoolMap = Arc<RwLock<HashMap<String, PgPool>>>;

static MYSQL_POOLS: Lazy<PoolMap<MySql>> = Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));
static POSTGRES_POOLS: Lazy<PgPoolMap> = Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));
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

fn build_mysql_options(
    params: &ConnectionParams,
    override_db: Option<&str>,
) -> Result<sqlx::mysql::MySqlConnectOptions, String> {
    use sqlx::mysql::{MySqlConnectOptions, MySqlSslMode};

    let username = params.username.as_deref().unwrap_or_default();
    let password = params.password.as_deref().unwrap_or_default();
    let host = params.host.as_deref().unwrap_or("localhost");
    let port = params.port.unwrap_or(3306);
    let database = override_db.unwrap_or_else(|| params.database.primary());

    let mut options = MySqlConnectOptions::new()
        .host(host)
        .port(port)
        .username(username)
        .password(password)
        .database(database);

    // Configure SSL mode based on params.ssl_mode
    let ssl_mode = match params.ssl_mode.as_deref().unwrap_or("required") {
        "disabled" | "disable" => MySqlSslMode::Disabled,
        "preferred" | "prefer" => MySqlSslMode::Preferred,
        "required" | "require" => MySqlSslMode::Required,
        "verify_ca" => MySqlSslMode::VerifyCa,
        "verify_identity" => MySqlSslMode::VerifyIdentity,
        _ => MySqlSslMode::Required,
    };
    options = options.ssl_mode(ssl_mode);

    // Apply SSL certificates if provided in params
    if let Some(ca) = &params.ssl_ca {
        options = options.ssl_ca(ca);
    }
    if let Some(cert) = &params.ssl_cert {
        options = options.ssl_client_cert(cert);
    }
    if let Some(key) = &params.ssl_key {
        options = options.ssl_client_key(key);
    }

    Ok(options)
}

fn build_postgres_configurations(params: &ConnectionParams) -> PgConfig {
    let mut cfg = PgConfig::new();
    cfg.user(params.username.as_deref().unwrap_or_default())
        .password(params.password.as_deref().unwrap_or_default())
        .port(params.port.unwrap_or(5432))
        .host(params.host.as_deref().unwrap_or_default())
        .dbname(&format!("{}", params.database));

    if let Some(ssl_mode) = params.ssl_mode.as_deref() {
        match ssl_mode {
            "disable" => {
                cfg.ssl_mode(PgSslMode::Disable);
            }
            "require" => {
                cfg.ssl_mode(PgSslMode::Require);
            }
            "prefer" => {
                cfg.ssl_mode(PgSslMode::Prefer);
            }
            _ => {}
        };
    }

    cfg
}

fn build_sqlite_connectoptions(params: &ConnectionParams) -> SqliteConnectOptions {
    SqliteConnectOptions::new().filename(params.database.to_string())
}

pub async fn get_mysql_pool(params: &ConnectionParams) -> Result<Pool<MySql>, String> {
    let connection_id = params.connection_id.as_deref();
    get_mysql_pool_with_id(params, connection_id).await
}

pub async fn get_mysql_pool_with_id(
    params: &ConnectionParams,
    connection_id: Option<&str>,
) -> Result<Pool<MySql>, String> {
    get_mysql_pool_for_database_with_id(params, None, connection_id).await
}

pub async fn get_mysql_pool_for_database(
    params: &ConnectionParams,
    override_db: Option<&str>,
) -> Result<Pool<MySql>, String> {
    let connection_id = params.connection_id.as_deref();
    get_mysql_pool_for_database_with_id(params, override_db, connection_id).await
}

async fn get_mysql_pool_for_database_with_id(
    params: &ConnectionParams,
    override_db: Option<&str>,
    connection_id: Option<&str>,
) -> Result<Pool<MySql>, String> {
    let key = if let Some(db) = override_db {
        format!("{}:{}", build_connection_key(params, connection_id), db)
    } else {
        build_connection_key(params, connection_id)
    };

    // Try to get existing pool
    {
        let pools = MYSQL_POOLS.read().await;
        if let Some(pool) = pools.get(&key) {
            log::debug!(
                "Using existing MySQL connection pool for: {} (key: {})",
                override_db.unwrap_or_else(|| params.database.primary()),
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
    let options = build_mysql_options(params, override_db)?;
    let pool = sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(10)
        .connect_with(options)
        .await
        .map_err(|e| {
            log::error!("Failed to create MySQL connection pool: {}", e);
            e.to_string()
        })?;

    log::info!(
        "MySQL connection pool created successfully for: {} (key: {})",
        override_db.unwrap_or_else(|| params.database.primary()),
        key
    );

    // Store pool
    {
        let mut pools = MYSQL_POOLS.write().await;
        pools.insert(key, pool.clone());
    }

    Ok(pool)
}

pub async fn get_postgres_pool(params: &ConnectionParams) -> Result<PgPool, String> {
    let connection_id = params.connection_id.as_deref();
    get_postgres_pool_with_id(params, connection_id).await
}

pub async fn get_postgres_pool_with_id(
    params: &ConnectionParams,
    connection_id: Option<&str>,
) -> Result<PgPool, String> {
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

    let cfg = build_postgres_configurations(params);

    let tls_connector = MakeTlsConnector::new(TlsConnector::new().map_err(|e| {
        log::error!("Failed to create Tls Connector for PostgreSQL pool: {}", e);
        e.to_string()
    })?);

    let pool = PgPool::builder(PgPoolManager::new(cfg, tls_connector))
        .max_size(10)
        .build()
        .map_err(|e| {
            log::error!("Failed to create PostgreSQL connection pool: {}", e);
            e.to_string()
        })?;

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
    let options = build_sqlite_connectoptions(params);
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(5) // SQLite has lower concurrency needs
        .connect_with(options)
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

/// Check whether a connection pool exists for the given params without creating one.
pub async fn has_pool(params: &ConnectionParams, connection_id: Option<&str>) -> bool {
    has_pool_for_database(params, None, connection_id).await
}

/// Check whether a connection pool exists for the given params and database without creating one.
pub async fn has_pool_for_database(
    params: &ConnectionParams,
    override_db: Option<&str>,
    connection_id: Option<&str>,
) -> bool {
    let key = if let Some(db) = override_db {
        format!("{}:{}", build_connection_key(params, connection_id), db)
    } else {
        build_connection_key(params, connection_id)
    };
    match params.driver.as_str() {
        "mysql" => MYSQL_POOLS.read().await.contains_key(&key),
        "postgres" => POSTGRES_POOLS.read().await.contains_key(&key),
        "sqlite" => SQLITE_POOLS.read().await.contains_key(&key),
        _ => false,
    }
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
                pool.close();
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
            pool.close();
        }
    }
    {
        let mut pools = SQLITE_POOLS.write().await;
        for (_, pool) in pools.drain() {
            pool.close().await;
        }
    }
}
