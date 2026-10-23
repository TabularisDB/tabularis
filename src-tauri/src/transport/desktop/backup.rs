use crate::backup::*;
use crate::runtime::RuntimeContext;
use tauri::{AppHandle, Manager, Runtime};

pub async fn run_backup<R: Runtime>(app: AppHandle<R>, trigger: &str) -> Result<String, String> {
    Ok(
        run_backup_for_runtime(app.state::<RuntimeContext>().inner(), trigger)
            .await?
            .location,
    )
}

async fn run_and_log<R: Runtime>(app: &AppHandle<R>, trigger: &str) {
    if let Err(e) = run_backup(app.clone(), trigger).await {
        log::warn!("Connections backup ({trigger}) failed: {e}");
    }
}

/// Interval mode: runs one backup when the newest one is older than the
/// configured interval.
async fn run_if_due<R: Runtime>(app: &AppHandle<R>) {
    let config = crate::transport::desktop::config::load_config_internal(app);
    if backup_mode(&config) != "interval" {
        return;
    }
    let interval = config
        .backup_interval_minutes
        .unwrap_or(DEFAULT_INTERVAL_MINUTES);
    if is_backup_due(
        newest_backup(&config).await,
        chrono::Local::now().naive_local(),
        interval,
    ) {
        run_and_log(app, "interval").await;
    }
}

/// Called from the `RunEvent::Exit` handler. In on-close mode every exit
/// writes a backup so the freshest state is what gets saved. Synchronous:
/// the process is about to end.
pub fn run_exit_backup(app: &AppHandle) {
    let config = crate::transport::desktop::config::load_config_internal(app);
    if backup_mode(&config) == "onClose" {
        // Bound the backup so a hung network operation can never prevent the
        // process from exiting.
        tauri::async_runtime::block_on(async {
            if tokio::time::timeout(
                std::time::Duration::from_secs(30),
                run_and_log(app, "on close"),
            )
            .await
            .is_err()
            {
                log::error!("Exit backup timed out after 30s, exiting without it");
            }
        });
    }
}

/// Background task started at app launch. In on-launch mode it writes one
/// backup right away; in interval mode it checks periodically whether a
/// backup is due. Config is re-read on every tick so settings changes apply
/// without a restart (a switch to on-launch only takes effect at the next
/// start, like the mode's name says).
pub fn spawn_scheduler(app: AppHandle) {
    crate::async_rt::spawn(async move {
        if backup_mode(&crate::transport::desktop::config::load_config_internal(
            &app,
        )) == "onLaunch"
        {
            run_and_log(&app, "on launch").await;
        }
        // Wake up every minute but only run the (possibly network-touching)
        // due-check at the tick cadence, so interval changes in the settings
        // take effect within a minute without hammering a WebDAV target.
        let mut last_check = std::time::Instant::now();
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            let interval = crate::transport::desktop::config::load_config_internal(&app)
                .backup_interval_minutes
                .unwrap_or(DEFAULT_INTERVAL_MINUTES);
            if last_check.elapsed().as_secs() >= scheduler_tick_secs(interval) {
                last_check = std::time::Instant::now();
                run_if_due(&app).await;
            }
        }
    });
}

#[tauri::command]
pub async fn get_connections_backup_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<BackupStatus, String> {
    backup_status(app.state::<RuntimeContext>().inner()).await
}

#[tauri::command]
pub async fn set_connections_backup_password<R: Runtime>(
    app: AppHandle<R>,
    password: String,
) -> Result<(), String> {
    set_backup_password(app.state::<RuntimeContext>().inner(), &password)
}

/// Stores (or clears, with an empty password) the credential of one backup
/// target, keyed by its id (e.g. `"webdav"`).
#[tauri::command]
pub async fn set_connections_backup_target_password<R: Runtime>(
    app: AppHandle<R>,
    target_id: String,
    password: String,
) -> Result<(), String> {
    set_backup_target_password(app.state::<RuntimeContext>().inner(), &target_id, &password)
}

#[tauri::command]
pub async fn run_connections_backup<R: Runtime>(
    app: AppHandle<R>,
) -> Result<serde_json::Value, String> {
    crate::application::connection_files::execute(
        &app.state::<RuntimeContext>(),
        &app.state::<std::sync::Arc<crate::runtime::state::ApplicationState>>(),
        None,
        crate::application::connection_files::ConnectionFilesCommand::RunBackup,
    )
    .await
}
