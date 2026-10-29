// ponytail: without `desktop`, helpers used only by `transport::desktop` go
// unused; silenced here instead of gating each one. The desktop build still
// reports real dead code.
#![cfg_attr(not(feature = "desktop"), allow(unused_imports, dead_code))]

pub mod ai;
pub mod ai_assistants;
pub mod ai_activity;
#[cfg(test)]
pub mod ai_activity_tests;
#[cfg(test)]
pub mod ai_activity_lexer_tests;
pub mod ai_approval;
#[cfg(test)]
pub mod ai_approval_tests;
pub mod ai_approval_watcher;

pub mod ai_notebook_export;
#[cfg(test)]
pub mod ai_notebook_export_tests;
pub mod ai_schema_context;
#[cfg(test)]
pub mod ai_schema_context_tests;
pub mod application;
pub mod askpass;
pub mod backup;
pub mod database_backup;
pub mod chatgpt;
pub mod cli;
pub mod clipboard_import;
pub mod commands;
pub mod config;
pub mod connection_appearance;
#[cfg(test)]
pub mod connection_appearance_tests;
pub mod connection_cache;
#[cfg(test)]
pub mod connection_cache_tests;
pub mod connection_import;

pub mod connection_migrations;
#[cfg(test)]
pub mod connection_migrations_tests;
pub mod connection_tags;

pub mod credential_cache;
pub mod dump_commands; // Added
#[cfg(test)]
pub mod dump_commands_tests;
pub mod dump_utils;
pub mod explain_import;
#[cfg(test)]
pub mod explain_import_tests;
pub mod export;
pub mod export_crypto;
#[cfg(test)]
pub mod export_import_tests;
pub mod fs_path;
#[cfg(test)]
pub mod fs_path_tests;
#[cfg(test)]
pub mod group_tree_tests;
pub mod health_check;
pub mod heartbeat;
#[cfg(test)]
pub mod heartbeat_tests;
pub mod k8s_tunnel;
pub mod keychain_utils;
#[cfg(test)]
pub mod keychain_utils_tests;
pub mod log_commands;
pub mod logger;
pub mod mcp;
pub mod models;
#[cfg(test)]
pub mod models_tests;

pub mod paths; // Added
#[cfg(test)]
pub mod paths_tests;
pub mod persistence;
#[cfg(test)]
pub mod persistence_tests;
pub mod plugin_secrets;
pub mod plugins;
pub mod pool_manager;
#[cfg(test)]
pub mod pool_manager_tests;
pub mod preferences;
pub mod proxy;
pub mod query_history;
#[cfg(test)]
pub mod query_history_tests;
pub mod runtime;
pub mod sandbox;
#[cfg(test)]
pub mod sandbox_tests;
pub mod saved_queries;
#[cfg(test)]
pub mod saved_queries_tests;
pub mod sql_database_statements;
pub mod sql_file;
#[cfg(test)]
pub mod sql_file_tests;
pub mod saved_query_folders;
#[cfg(test)]
pub mod saved_query_folders_tests;
pub mod secret_store;
pub mod sqlite_database;
#[cfg(test)]
pub mod sqlite_database_tests;
pub mod ssh_tunnel;
pub mod ssm_tunnel;
pub mod storage_location;
#[cfg(test)]
pub mod storage_location_tests;

pub mod team_share;

pub mod theme_models;
pub mod theme_packages;
pub mod transport;
pub mod ui_state;

#[cfg(test)]
pub mod ui_state_tests;


/// Tauri's global runtime in the desktop app; the ambient Tokio runtime of
/// `tabularis web` and `--mcp` otherwise.
pub mod async_rt {
    #[cfg(feature = "desktop")]
    pub use tauri::async_runtime::{spawn, spawn_blocking, JoinHandle};
    #[cfg(not(feature = "desktop"))]
    pub use tokio::task::{spawn, spawn_blocking, JoinHandle};
}
pub mod drivers {
    pub mod common;
    pub mod driver_trait;
    #[cfg(test)]
    pub mod driver_trait_tests;
    pub mod mysql;
    pub mod postgres;
    pub mod registry;
    pub mod sql_dialect;
    #[cfg(test)]
    pub mod sql_dialect_tests;
    pub mod sql_syntax;
    #[cfg(test)]
    pub mod sql_syntax_tests;
    pub mod sqlite;
}

pub use runtime::bootstrap::get_log_buffer;

pub(crate) fn is_debug_mode() -> bool {
    runtime::bootstrap::is_debug_mode()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // When ssh re-executes this binary as its SSH_ASKPASS helper (see the
    // `askpass` module), serve the prompt and exit without booting the app.
    askpass::maybe_run_askpass_client();

    runtime::bootstrap::install_process_prerequisites();

    // On Linux + Wayland, disable the DMA-BUF renderer in WebKitGTK to prevent
    // "Protocol error dispatching to Wayland display" crashes.
    // This targets the specific protocol causing the error while keeping GPU
    // compositing and rendering intact.
    #[cfg(target_os = "linux")]
    {
        if std::env::var("WAYLAND_DISPLAY").is_ok()
            || std::env::var("XDG_SESSION_TYPE").map_or(false, |v| v == "wayland")
        {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    let args = cli::parse();

    // The capturing logger writes to stderr, keeping MCP's stdout JSON-RPC
    // stream clean while providing the same diagnostics in every launch mode.
    let log_buffer = runtime::bootstrap::initialize_logging(args.debug);

    if let Err(error) = secret_store::install_from_env() {
        eprintln!("Error: {error}");
        std::process::exit(1);
    }

    if let Some(cli::Command::Web(web_args)) = &args.command {
        let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
        rt.block_on(async {
            let web_root =
                transport::web::static_assets::resolve_web_root(web_args.web_root.as_deref())
                    .expect("Failed to locate Tabularis Web assets");
            let web_events = transport::web::events::WebEventBus::default();
            let runtime_context = runtime::RuntimeContext::new(
                std::sync::Arc::new(runtime::paths::FixedRuntimePaths::system()),
                std::sync::Arc::new(web_events.clone()),
                std::sync::Arc::new(runtime::secrets::KeyringRuntimeSecrets),
            );
            let application = runtime::bootstrap::bootstrap_application(
                runtime_context,
                runtime::bootstrap::BootstrapOptions::default(),
            )
            .await
            .expect("Failed to bootstrap Tabularis Web services");
            let application_state =
                std::sync::Arc::new(runtime::state::ApplicationState::default());
            let web_data_dir = application.context.paths.data_dir().to_path_buf();
            let web_plugins_dir = application.context.paths.plugins_dir();
            let database_backup_scheduler = database_backup::spawn_database_backup_scheduler(
                application.context.clone(), application_state.dump_cancellation.clone(),
            );
            let approval_heartbeat = runtime::lifecycle::start_approval_heartbeat(&application.context);
            let approval_watcher = ai_approval_watcher::spawn_headless(
                application.context.clone(),
                application_state.clone(),
            );
            let application_api = std::sync::Arc::new(application::RuntimeApplicationApi::new(
                application.context,
                application_state.clone(),
            ));

            let server_result =
                transport::web::server::run(transport::web::server::WebServerOptions {
                    trusted_proxies: web_args.trusted_proxies.clone(),
                    host: web_args.host.clone(),
                    port: web_args.port,
                    web_root,
                    data_dir: web_data_dir,
                    plugins_dir: web_plugins_dir,
                    open_browser: !web_args.no_open,
                    auth: web_args.auth,
                    public_url: web_args.public_url.clone(),
                    allowed_origins: web_args.allowed_origins.clone(),
                    allow_high_risk: web_args.allow_high_risk,
                    server_file_browser_roots: web_args.server_file_browser_roots.clone(),
                    application: application_api,
                    events: web_events,
                })
                .await;

            database_backup_scheduler.abort();
            approval_watcher.abort();
            drop(approval_heartbeat);
            runtime::lifecycle::shutdown_headless_runtime(&application_state).await;
            server_result.expect("Failed to run Tabularis Web server");
        });
        return;
    }

    if args.mcp {
        let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
        rt.block_on(mcp::run_mcp_server());
        return;
    }

    #[cfg(feature = "desktop")]
    transport::desktop::run(args, log_buffer);
    #[cfg(not(feature = "desktop"))]
    {
        drop(log_buffer);
        eprintln!("This build has no desktop app. Run `tabularis web` or `tabularis --mcp`.");
        std::process::exit(2);
    }
}

