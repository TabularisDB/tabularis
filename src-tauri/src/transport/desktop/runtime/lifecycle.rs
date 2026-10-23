pub fn start_desktop_schedulers(app: tauri::AppHandle, ping_interval_secs: u64) {
    let health_check_app = app.clone();
    crate::async_rt::spawn(async move {
        crate::transport::desktop::health_check::start_ping_loop(
            health_check_app,
            ping_interval_secs,
        )
        .await;
    });
    crate::transport::desktop::ai_approval_watcher::spawn(app.clone());
    use tauri::Manager;
    crate::database_backup::spawn_database_backup_scheduler(
        app.state::<crate::runtime::RuntimeContext>().inner().clone(),
        app.state::<std::sync::Arc<crate::dump_commands::DumpCancellationState>>().inner().clone(),
    );
    crate::transport::desktop::backup::spawn_scheduler(app);
}
