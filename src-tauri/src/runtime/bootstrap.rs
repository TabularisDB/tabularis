use super::RuntimeContext;
use crate::config::AppConfig;
use crate::drivers::{mysql, postgres, registry, sqlite};
use crate::logger::{create_log_buffer, init_logger, SharedLogBuffer};
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

const LOG_BUFFER_CAPACITY: usize = 1000;

static DEBUG_MODE: AtomicBool = AtomicBool::new(false);
static LOG_BUFFER: OnceLock<SharedLogBuffer> = OnceLock::new();

#[derive(Clone, Copy, Debug)]
pub struct BootstrapOptions {
    pub load_external_plugins: bool,
    pub run_connection_migrations: bool,
}

impl Default for BootstrapOptions {
    fn default() -> Self {
        Self {
            load_external_plugins: true,
            run_connection_migrations: true,
        }
    }
}

pub struct BootstrappedApplication {
    pub context: RuntimeContext,
    pub config: AppConfig,
}

pub fn install_process_prerequisites() {
    // rustls can have multiple providers linked through transitive dependencies;
    // pin ring before sqlx or a plugin attempts its first TLS handshake.
    let _ = rustls::crypto::ring::default_provider().install_default();
    sqlx::any::install_default_drivers();
}

pub fn initialize_logging(debug: bool) -> SharedLogBuffer {
    DEBUG_MODE.store(debug, Ordering::Relaxed);
    let buffer = create_log_buffer(LOG_BUFFER_CAPACITY);
    let shared = LOG_BUFFER.get_or_init(|| buffer.clone()).clone();
    init_logger(shared.clone(), log::LevelFilter::Info);
    shared
}

pub fn is_debug_mode() -> bool {
    DEBUG_MODE.load(Ordering::Relaxed)
}

pub fn get_log_buffer() -> SharedLogBuffer {
    LOG_BUFFER
        .get()
        .expect("Log buffer not initialized")
        .clone()
}

pub async fn bootstrap_application(
    context: RuntimeContext,
    options: BootstrapOptions,
) -> Result<BootstrappedApplication, String> {
    fs::create_dir_all(context.paths.config_dir()).map_err(|error| {
        format!(
            "Failed to create application config directory {}: {error}",
            context.paths.config_dir().display()
        )
    })?;
    fs::create_dir_all(context.paths.data_dir()).map_err(|error| {
        format!(
            "Failed to create application data directory {}: {error}",
            context.paths.data_dir().display()
        )
    })?;

    let config = load_config(context.paths.config_dir());
    register_builtin_drivers().await;

    if options.load_external_plugins {
        crate::plugins::installer::migrate_legacy_plugins_dir();
        let plugins_dir = context.paths.plugins_dir();
        fs::create_dir_all(&plugins_dir).map_err(|error| {
            format!(
                "Failed to create plugins directory {}: {error}",
                plugins_dir.display()
            )
        })?;
        crate::plugins::manager::load_plugins_from_dir(
            &plugins_dir,
            config.plugins.clone().unwrap_or_default(),
            config.active_external_drivers.as_deref(),
        )
        .await;
    }

    if options.run_connection_migrations {
        crate::connection_migrations::migrate_postgres_ssl_mode_spelling_at_path(
            &context.paths.connections_file(),
        )
        .await
        .ok();
    }

    Ok(BootstrappedApplication { context, config })
}

fn load_config(config_dir: &std::path::Path) -> AppConfig {
    let path = config_dir.join("config.json");
    let mut config = fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<AppConfig>(&content).ok())
        .unwrap_or_default();
    crate::plugins::compat::migrate_legacy_config(&mut config);
    config
}

async fn register_builtin_drivers() {
    registry::register_driver(mysql::MysqlDriver::new()).await;
    registry::register_driver(postgres::PostgresDriver::new()).await;
    registry::register_driver(sqlite::SqliteDriver::new()).await;
}
