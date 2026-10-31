//! The Tauri desktop app: every Tauri command and the code that needs a
//! Tauri handle. Nothing outside this module depends on Tauri.

pub mod ai;
pub mod ai_approval_watcher;
pub mod ai_commands;
pub mod askpass;
pub mod backup;
pub mod database_backup;
pub mod chatgpt;
pub mod clipboard_import;
pub mod commands;
pub mod config;
pub mod connection_appearance;
pub mod connection_import_commands;
pub mod connection_window;
pub mod dump_commands;
#[cfg(feature = "e2e-testing")]
pub mod e2e_dialog_mock;
pub mod explain_import;
pub mod export;
pub mod health_check;
pub mod log_commands;
pub mod mcp;
pub mod notebooks;
pub mod plugins;
pub mod preferences;
pub mod proxy;
pub mod query_history;
pub mod runtime;
pub mod saved_queries;
pub mod sql_file;
pub mod sqlite_database;
pub mod storage_location;
pub mod system_theme;
pub mod task_manager;
pub mod theme_commands;
pub mod theme_packages;
pub mod ui_state_commands;
pub mod updater;
pub mod window_decorations;
pub mod window_placement;
#[cfg(test)]
mod connection_window_tests;
#[cfg(test)]
mod tests;

use tauri::Manager;

#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
    log::info!("DevTools opened");
}

#[tauri::command]
fn close_devtools(window: tauri::WebviewWindow) {
    window.close_devtools();
    log::info!("DevTools closed");
}

pub fn run(args: crate::cli::Args, log_buffer: crate::logger::SharedLogBuffer) {
    // Log startup message
    log::info!("Tabularis application starting...");
    if args.debug {
        log::info!("Debug mode enabled - verbose logging active");
    } else {
        log::info!("Debug mode disabled - standard logging active");
    }

    let application_state = std::sync::Arc::new(crate::runtime::state::ApplicationState::default());
    let shutdown_hooks = crate::runtime::lifecycle::ShutdownHooks::default();
    shutdown_hooks.register(|| {
        log::info!("Application exiting, stopping all active tunnels...");
        crate::ssh_tunnel::stop_all_tunnels();
        crate::proxy::stop_all_forwards();
        crate::ssm_tunnel::stop_all_tunnels();
        crate::k8s_tunnel::stop_all_tunnels();
    });
    let run_shutdown_hooks = shutdown_hooks.clone();

    #[cfg_attr(not(feature = "e2e-testing"), allow(unused_mut))]
    let mut builder = tauri::Builder::default()
        // Singleton: a second launch (typically a `tabularis://...` URL
        // clicked while the app is already running) hands its argv to the
        // first instance and exits. With `features = ["deep-link"]` the plugin
        // usually auto-routes those URLs through `on_open_url`, but on
        // Linux/Windows the URL arrives as a plain argv entry on warm launch.
        // We scan argv for it defensively and dispatch ourselves so the
        // install modal fires even when auto-routing doesn't.
        //
        // Order matters: must be the FIRST plugin in the chain so it can
        // intercept duplicate launches before any heavy initialisation.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            log::info!("Duplicate launch detected — forwarded to existing instance");
            if let Some(url) = argv.iter().find(|a| a.starts_with("tabularis:")) {
                crate::transport::desktop::plugins::deep_link::handle_url(app, url);
            }
            if let Some(win) = tauri::Manager::get_webview_window(app, "main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init());

    // Dialog plugin: real in production, mocked under e2e-testing (the mock
    // auto-accepts ask()/confirm() so native Tauri confirm dialogs — which
    // WebDriverIO can't click — don't block the trigger-save flow). Registered
    // as a same-named "dialog" plugin so it replaces the real one at Tauri's
    // IPC dispatch layer (PluginStore::register retains only the last).
    #[cfg(not(feature = "e2e-testing"))]
    {
        builder = builder.plugin(tauri_plugin_dialog::init());
    }
    #[cfg(feature = "e2e-testing")]
    {
        builder = builder.plugin(e2e_dialog_mock::init());
        // In-app WebDriver server. tauri-wd connects to drive the real WKWebView
        // via the W3C WebDriver protocol on macOS, exercising real Tauri IPC.
        builder = builder.plugin(tauri_plugin_webdriver_automation::init());
    }

    builder
        .manage(application_state.pending_install.clone())
        .manage(application_state.query_cancellation.clone())
        .manage(application_state.export_cancellation.clone())
        .manage(application_state.dump_cancellation.clone())
        .manage(log_buffer)
        .manage(application_state.credential_cache.clone())
        .manage(application_state.connection_cache.clone())
        .manage(application_state.import_envelope_cache.clone())
        .manage(application_state.pending_explain_file.clone())
        .manage(application_state.clone())
        .manage(window_placement::WindowPlacementCache::default())
        .setup(move |app| {
            #[cfg(target_os = "linux")]
            system_theme::watch(app.handle().clone());
            // The asset protocol scope in tauri.conf.json only covers the
            // default data directory; when the user moved the storage folder
            // the connection icons live there instead.
            if crate::storage_location::active_override().is_some() {
                let icons_dir = crate::paths::get_connection_icons_dir();
                let _ = std::fs::create_dir_all(&icons_dir);
                if let Err(e) = app.asset_protocol_scope().allow_directory(&icons_dir, true) {
                    log::warn!("Failed to allow asset access to {:?}: {}", icons_dir, e);
                }
                log::info!(
                    "Using custom storage location: {}",
                    crate::paths::get_app_config_dir().display()
                );
            }

            // Apply the persisted decoration policy as early as possible. The
            // main window is created from tauri.conf.json before this hook.
            let startup_config = crate::transport::desktop::config::load_config_internal(&app.handle());
            crate::transport::desktop::window_decorations::apply_to_all_windows(
                &app.handle(),
                startup_config.window_decorations.as_ref(),
            );
            // Restore the main window's last normal size and position.
            // The explicit start_maximized preference below still takes precedence.
            if let Some(window) = app.get_webview_window("main") {
                window_placement::restore(&window);
            }

            let app_paths = crate::runtime::paths::FixedRuntimePaths::system();
            let runtime_context = crate::runtime::RuntimeContext::new(
                std::sync::Arc::new(app_paths),
                std::sync::Arc::new(runtime::events::TauriRuntimeEvents::new(
                    app.handle().clone(),
                )),
                std::sync::Arc::new(crate::runtime::secrets::KeyringRuntimeSecrets),
            );
            // Allow the SSH tunnel code (which runs without a Tauri context)
            // to bridge askpass prompts to the frontend.
            crate::askpass::set_frontend_events(runtime_context.events.clone());
            let bootstrapped = tauri::async_runtime::block_on(
                crate::runtime::bootstrap::bootstrap_application(
                    runtime_context,
                    crate::runtime::bootstrap::BootstrapOptions {
                        load_external_plugins: true,
                        run_connection_migrations: false,
                    },
                ),
            )
            .map_err(std::io::Error::other)?;
            app.manage(crate::runtime::lifecycle::start_approval_heartbeat(&bootstrapped.context));
            app.manage(bootstrapped.context);

            // Ensure replacement plugins are installed for any built-in
            // driver a saved connection still depends on (e.g. install the
            // `postgresql` plugin when a `postgres` connection exists). Spawned,
            // not `block_on`, so a slow or failed registry fetch never delays
            // window creation — same pattern as the health-check spawn below.
            // See `.github/planning/postgres-plugin-force-install.md`.
            for (builtin_id, plugin_id) in crate::plugins::force_install::MIGRATABLE_DRIVERS {
                let handle = app.handle().clone();
                let builtin_id = builtin_id.to_string();
                let plugin_id = plugin_id.to_string();
                tauri::async_runtime::spawn(async move {
                    crate::transport::desktop::plugins::force_install::ensure_plugin_installed_if_needed(
                        &handle,
                        &builtin_id,
                        &plugin_id,
                    )
                    .await;
                });
            }

            // Subscribe to `tabularis://` deep links so a registry's
            // "Open in App" button can hand us a plugin slug + version.
            // The handler emits a frontend event; the React side opens the
            // install confirmation modal. See `plugins::deep_link`.
            //
            // On Linux/Windows the scheme is only auto-registered when the
            // app is installed from a bundled package. Under `tauri dev`
            // the binary lives in `target/debug/...`, so call
            // `register("tabularis")` here — it writes the desktop / xdg-mime
            // entry pointing at the current binary so Firefox & friends can
            // route `tabularis://...` to us. The call is a no-op on macOS
            // (handled by Info.plist) and idempotent across restarts.
            //
            // Inside Snap/Flatpak the exported `.desktop` entry already
            // carries `MimeType=x-scheme-handler/tabularis`, and the sandbox
            // has neither `xdg-mime` nor write access to the host's
            // mimeapps.list — so skip the call instead of logging a failure.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                let deep_link = app.deep_link();
                #[cfg(any(target_os = "linux", all(debug_assertions, target_os = "windows")))]
                match crate::sandbox::current() {
                    Some(sandbox) => log::info!(
                        "Skipping tabularis:// scheme registration: handled by the {} desktop entry",
                        sandbox.name()
                    ),
                    None => {
                        if let Err(e) = deep_link.register("tabularis") {
                            log::warn!("Failed to register tabularis:// scheme: {}", e);
                        }
                    }
                }
                deep_link.on_open_url({
                    let handle = handle.clone();
                    move |event| {
                        for url in event.urls() {
                            crate::transport::desktop::plugins::deep_link::handle_url(&handle, url.as_str());
                        }
                    }
                });
                // Cold-start path: when the OS launched us *because of* a
                // tabularis:// URL, on_open_url won't fire — the URL is
                // already consumed by the launch handshake. Pull it out via
                // get_current() and route it through the same handler.
                if let Ok(Some(urls)) = deep_link.get_current() {
                    for url in urls {
                        crate::transport::desktop::plugins::deep_link::handle_url(&handle, url.as_str());
                    }
                }
            }

            // Start desktop health checks, event watchers, and backups.
            let ping_interval = crate::transport::desktop::config::load_config_internal(&app.handle())
                .ping_interval
                .unwrap_or(crate::health_check::DEFAULT_PING_INTERVAL);
            runtime::lifecycle::start_desktop_schedulers(
                app.handle().clone(),
                ping_interval as u64,
            );

            // Maximize the window on startup if the user enabled it.
            if startup_config
                .start_maximized
                .unwrap_or(false)
            {
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(e) = window.maximize() {
                        log::warn!("Failed to maximize window on startup: {e}");
                    }
                }
            }

            // Open devtools automatically in debug mode
            if args.debug {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                    log::info!("DevTools opened (debug mode active)");
                }
            }

            // If the user launched with `--explain <FILE>`, spawn the Visual
            // Explain window and hide the main app window: the CLI flag is
            // meant to be a dedicated plan viewer, not a full app launch.
            if let Some(path) = args.explain.clone() {
                log::info!("CLI --explain received: {path}");
                if let Err(e) =
                    explain_import::spawn_visual_explain_window(app, Some(path))
                {
                    log::error!("Failed to open Visual Explain window: {e}");
                }
                // Close the default main window only AFTER visual-explain is
                // built — closing the last window would terminate the app.
                if let Some(main) = app.get_webview_window("main") {
                    if let Err(e) = main.close() {
                        log::warn!("Failed to close main window: {e}");
                    }
                }
            }
            Ok(())
        })
        // Only the main window is persisted; utility windows retain their
        // existing per-feature sizing and placement behavior.
        .on_window_event(|window, event| {
            if window.label() != "main" { return; }
            match event {
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                    window_placement::remember(window);
                }
                tauri::WindowEvent::CloseRequested { .. } => {
                    window_placement::persist(window);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            system_theme::get_linux_system_theme,
            is_debug_mode,
            open_devtools,
            close_devtools,
            commands::get_registered_drivers,
            commands::get_driver_manifest,
            commands::get_connection_metadata,
            commands::get_keybindings,
            commands::save_keybindings,
            commands::test_connection,
            commands::list_databases,
            commands::save_connection,
            sqlite_database::create_sqlite_file,
            commands::create_sqlite_database,
            commands::delete_connection,
            commands::update_connection,
            commands::duplicate_connection,
            commands::get_connections,
            commands::get_connection_by_id,
            commands::disconnect_connection,
            commands::register_active_connection,
            commands::get_active_connections,
            commands::get_data_types,
            commands::map_inferred_column_types,
            // SSH Connections
            commands::get_ssh_connections,
            commands::save_ssh_connection,
            commands::update_ssh_connection,
            commands::delete_ssh_connection,
            commands::test_ssh_connection,
            askpass::respond_ssh_askpass,
            // K8s Connections
            commands::get_k8s_connections,
            commands::save_k8s_connection,
            commands::update_k8s_connection,
            commands::delete_k8s_connection,
            commands::test_k8s_connection_cmd,
            commands::get_k8s_contexts_cmd,
            commands::get_k8s_namespaces_cmd,
            commands::get_k8s_resources_cmd,
            commands::get_k8s_resource_ports_cmd,
            commands::validate_k8s_path_cmd,
            // AWS SSM
            commands::test_ssm_connection_cmd,
            // Connection Groups
            commands::get_connection_groups,
            commands::get_connections_with_groups,
            commands::create_connection_group,
            commands::create_group_path,
            commands::update_connection_group,
            commands::move_group_to_parent,
            commands::delete_connection_group,
            commands::move_connection_to_group,
            commands::reorder_groups,
            commands::reorder_connections_in_group,
            commands::list_connection_tags,
            commands::create_connection_tag,
            commands::update_connection_tag,
            commands::delete_connection_tag,
            commands::set_connection_tags,
            connection_import_commands::export_connections_file,
            backup::get_connections_backup_status,
            backup::set_connections_backup_password,
            backup::set_connections_backup_target_password,
            backup::run_connections_backup,
            database_backup::get_database_backup_status,
            database_backup::run_database_backup_now,
            database_backup::cancel_database_backup,
            connection_import_commands::list_connection_import_sources,
            connection_import_commands::preview_connection_import,
            connection_import_commands::apply_connection_import,
            connection_import_commands::preview_tabularis_import_file,
            connection_import_commands::apply_prepared_tabularis_import,
            commands::get_schemas,
            commands::get_available_databases,
            commands::set_selected_databases,
            commands::get_tables,
            commands::get_columns,
            commands::get_foreign_keys,
            commands::get_indexes,
            commands::delete_record,
            commands::update_record,
            commands::insert_record,
            commands::fetch_blob,
            commands::fetch_blob_as_data_url,
            commands::load_blob_from_file,
            commands::detect_blob_mime,
            commands::detect_mime_type,
            commands::get_file_stats,
            commands::read_file_as_data_url,
            commands::execute_query,
            commands::execute_query_batch,
            commands::release_query_session,
            commands::get_server_now,
            commands::explain_query_plan,
            commands::count_query,
            commands::cancel_query,
            commands::get_views,
            commands::get_view_definition,
            commands::create_view,
            commands::alter_view,
            commands::drop_view,
            commands::get_view_columns,
            commands::get_materialized_views,
            commands::get_materialized_view_columns,
            commands::get_materialized_view_definition,
            commands::refresh_materialized_view,
            commands::set_window_title,
            commands::open_er_diagram_window,
            explain_import::load_explain_from_file,
            explain_import::get_pending_explain_file,
            export::export_query_to_file,
            export::cancel_export,
            sql_file::read_sql_file,
            sql_file::write_sql_file,
            saved_queries::get_saved_queries,
            saved_queries::save_query,
            saved_queries::update_saved_query,
            saved_queries::delete_saved_query,
            saved_queries::get_saved_query_versions,
            saved_queries::restore_saved_query_version,
            saved_queries::get_saved_query_folders,
            saved_queries::create_saved_query_folder,
            saved_queries::rename_saved_query_folder,
            saved_queries::delete_saved_query_folder,
            saved_queries::move_saved_query,
            query_history::get_query_history,
            query_history::add_query_history_entry,
            query_history::delete_query_history_entry,
            query_history::clear_query_history,
            // Config
            config::get_schema_preference,
            config::set_schema_preference,
            config::get_last_active_connection,
            config::set_last_active_connection,
            config::get_last_open_connections,
            config::set_last_open_connections,
            config::get_selected_schemas,
            config::set_selected_schemas,
            config::get_config,
            config::save_config,
            config::get_config_json,
            config::save_config_json,
            config::relaunch_app,
            storage_location::get_storage_location,
            storage_location::inspect_storage_location,
            storage_location::set_storage_location,
            storage_location::reset_storage_location,
            storage_location::open_storage_location,
            storage_location::get_app_data_dir,
            ui_state_commands::get_ui_state,
            ui_state_commands::set_ui_state,
            ui_state_commands::delete_ui_state,
            config::set_ai_key,
            config::delete_ai_key,
            config::check_ai_key,
            config::check_ai_key_status,
            proxy::set_proxy_password,
            proxy::proxy_password_is_set,
            proxy::delete_proxy_password,
            config::get_system_prompt,
            config::save_system_prompt,
            config::reset_system_prompt,
            config::get_explain_prompt,
            config::save_explain_prompt,
            config::reset_explain_prompt,
            config::get_explainplan_prompt,
            config::save_explainplan_prompt,
            config::reset_explainplan_prompt,
            config::get_cellname_prompt,
            config::save_cellname_prompt,
            config::reset_cellname_prompt,
            config::get_tabrename_prompt,
            config::save_tabrename_prompt,
            config::reset_tabrename_prompt,
            // AI
            ai::generate_ai_query,
            ai::explain_ai_query,
            ai::analyze_ai_explain_plan,
            ai::generate_cell_name,
            ai::generate_tab_rename,
            ai::suggest_table_name,
            ai::get_ai_models,
            chatgpt::get_chatgpt_session,
            chatgpt::sign_in_chatgpt,
            chatgpt::cancel_chatgpt_sign_in,
            chatgpt::select_chatgpt_profile,
            chatgpt::sign_out_chatgpt,
            chatgpt::get_chatgpt_models,
            chatgpt::open_chatgpt_usage,
            // Clipboard Import
            clipboard_import::execute_clipboard_import,
            ai_commands::get_ai_schema_context,
            commands::get_schema_snapshot,
            // DDL generation
            commands::get_table_query_template,
            commands::get_column_stats,
            commands::get_create_table_sql,
            commands::get_add_column_sql,
            commands::get_alter_column_sql,
            commands::get_create_index_sql,
            commands::get_create_foreign_key_sql,
            commands::get_drop_table_sql,
            commands::drop_index_action,
            commands::drop_foreign_key_action,
            // Routines
            commands::get_routines,
            commands::get_routine_parameters,
            commands::get_routine_definition,
            commands::build_routine_call_sql,
            commands::get_routine_create_template,
            commands::get_routine_edit_script,
            commands::drop_routine,
            // Triggers
            commands::get_triggers,
            commands::get_trigger_definition,
            commands::create_trigger,
            commands::drop_trigger,
            // User management
            commands::get_db_privilege_catalog,
            commands::get_db_users,
            commands::get_db_user_grants,
            commands::get_db_user_privileges,
            commands::create_db_user,
            commands::drop_db_user,
            commands::set_db_user_password,
            commands::apply_db_user_privileges,
            // MCP
            mcp::install::get_mcp_status,
            mcp::install::install_mcp_config,
            // AI Activity / Approvals
            ai_commands::get_ai_activity,
            ai_commands::get_ai_sessions,
            ai_commands::get_ai_session_events,
            ai_commands::clear_ai_activity,
            ai_commands::export_ai_activity_json,
            ai_commands::export_ai_activity_csv,
            ai_commands::export_ai_session_as_notebook,
            ai_commands::list_pending_approvals,
            ai_commands::decide_pending_approval,
            // Themes
            theme_packages::commands::preview_theme_document,
            theme_packages::commands::preview_local_theme_package,
            theme_commands::install_local_theme_package,
            theme_commands::fetch_theme_registry,
            theme_commands::fetch_theme_package_detail,
            theme_commands::install_registry_theme,
            theme_packages::commands::cancel_theme_install,
            theme_commands::set_theme_package_enabled,
            theme_commands::uninstall_theme_package,
            theme_commands::recover_theme_packages,
            theme_commands::get_theme_catalog,
            theme_commands::create_personal_theme,
            theme_commands::create_personal_snapshot,
            theme_commands::update_personal_theme,
            theme_commands::update_personal_snapshot,
            theme_commands::duplicate_personal_theme,
            theme_commands::get_all_themes,
            theme_commands::save_custom_theme,
            theme_commands::delete_custom_theme,
            theme_commands::import_theme,
            theme_commands::export_theme,
            // Dump & Import
            dump_commands::dump_database,
            dump_commands::cancel_dump,
            dump_commands::import_database,
            dump_commands::cancel_import,
            // Updater
            updater::check_for_updates,
            updater::download_and_install_update,
            updater::get_installation_source,
            // Logs
            log_commands::get_logs,
            log_commands::log_frontend_event,
            log_commands::clear_logs,
            log_commands::get_log_settings,
            log_commands::set_log_enabled,
            log_commands::set_log_max_size,
            log_commands::export_logs,
            log_commands::test_log,
            // Preferences
            preferences::save_editor_preferences,
            preferences::load_editor_preferences,
            preferences::delete_editor_preferences,
            // Notebooks
            notebooks::create_notebook,
            notebooks::save_notebook,
            notebooks::load_notebook,
            notebooks::delete_notebook,
            notebooks::rename_notebook,
            notebooks::list_notebooks,
            // Plugin Registry
            plugins::commands::fetch_plugin_registry,
            plugins::commands::install_plugin,
            plugins::commands::cancel_plugin_install,
            plugins::commands::uninstall_plugin,
            plugins::commands::get_installed_plugins,
            plugins::commands::disable_plugin,
            plugins::commands::enable_plugin,
            plugins::commands::get_plugin_manifest,
            plugins::commands::get_plugin_dir,
            plugins::commands::open_plugins_dir,
            plugins::commands::read_plugin_file,
            plugins::commands::fetch_tabularium_plugin_preview,
            plugins::commands::fetch_plugin_readme,
            plugins::deep_link::consume_pending_deep_link_install,
            plugins::manager::get_plugin_startup_errors,
            plugins::runtime_version::get_plugin_runtime_warnings,
            // JSON Viewer
            // Connection Window
            connection_window::open_connection_window,
            // Task Manager
            task_manager::get_process_list,
            task_manager::get_system_stats,
            task_manager::get_tabularis_children,
            task_manager::kill_plugin_process,
            task_manager::restart_plugin_process,
            task_manager::open_task_manager_window,
            // Connection Appearance
            connection_appearance::save_connection_icon,
            commands::delete_connection_icon,
            commands::set_connection_appearance,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app_handle, event| {
            // Cmd+Q and relaunch paths can exit without CloseRequested.
            if matches!(&event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
                window_placement::persist_cached(app_handle);
            }
            if let tauri::RunEvent::Exit = event {
                app_handle.state::<crate::heartbeat::HeartbeatTask>().stop();
                // Back up the freshest state before the process ends (no-op
                // unless backups are enabled and due).
                backup::run_exit_backup(app_handle);
                tauri::async_runtime::block_on(crate::runtime::lifecycle::release_pinned_sessions());
                run_shutdown_hooks.run();
            }
        });
}

#[tauri::command]
fn is_debug_mode() -> bool {
    crate::is_debug_mode()
}
