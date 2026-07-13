//! Automatic encrypted backups of the connections export.
//!
//! When enabled in the settings, a background loop periodically writes an
//! encrypted connection export (same envelope as the manual export) into a
//! user-chosen directory and prunes files beyond the retention count. The
//! backup password lives in the OS keychain and never touches `config.json`;
//! plaintext backups are deliberately not supported.

use chrono::NaiveDateTime;
use keyring::Entry;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};

#[cfg(test)]
mod tests;

const SERVICE_NAME: &str = "tabularis";
const KEYCHAIN_USER: &str = "connections-backup";
const KEYCHAIN_WEBDAV_USER: &str = "connections-backup-webdav";

pub const FILE_PREFIX: &str = "tabularis-backup-";
pub const FILE_SUFFIX: &str = ".json";
const TIMESTAMP_FORMAT: &str = "%Y%m%d-%H%M%S";

pub const DEFAULT_INTERVAL_MINUTES: u32 = 24 * 60;
pub const DEFAULT_RETENTION: u32 = 10;
/// Longest pause between two due-checks of the scheduler.
const MAX_TICK_SECS: u64 = 15 * 60;

// ---------- Keychain ----------

fn set_keychain(user: &str, password: &str) -> Result<(), String> {
    Entry::new(SERVICE_NAME, user)
        .and_then(|e| e.set_password(password))
        .map_err(|e| e.to_string())
}

fn get_keychain(user: &str) -> Result<Option<String>, String> {
    match Entry::new(SERVICE_NAME, user).map_err(|e| e.to_string())?.get_password() {
        Ok(pwd) => Ok(Some(pwd)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn delete_keychain(user: &str) -> Result<(), String> {
    match Entry::new(SERVICE_NAME, user).map_err(|e| e.to_string())?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn get_password() -> Result<Option<String>, String> {
    get_keychain(KEYCHAIN_USER)
}

pub fn get_webdav_password() -> Result<Option<String>, String> {
    get_keychain(KEYCHAIN_WEBDAV_USER)
}

// ---------- Pure helpers (unit-tested in tests.rs) ----------

pub fn backup_file_name(now: NaiveDateTime) -> String {
    format!("{FILE_PREFIX}{}{FILE_SUFFIX}", now.format(TIMESTAMP_FORMAT))
}

/// Extracts the timestamp from a backup file name produced by
/// [`backup_file_name`]. Foreign files yield `None` and are left alone.
pub fn parse_backup_timestamp(file_name: &str) -> Option<NaiveDateTime> {
    let stamp = file_name
        .strip_prefix(FILE_PREFIX)?
        .strip_suffix(FILE_SUFFIX)?;
    NaiveDateTime::parse_from_str(stamp, TIMESTAMP_FORMAT).ok()
}

/// Returns the backup file names that fall outside the `retention` newest
/// ones. Only names matching the backup pattern are considered; the
/// timestamp format sorts lexicographically so a plain sort orders by age.
pub fn select_backups_to_prune(names: &[String], retention: usize) -> Vec<String> {
    let mut backups: Vec<&String> = names
        .iter()
        .filter(|n| parse_backup_timestamp(n).is_some())
        .collect();
    backups.sort();
    if retention == 0 || backups.len() <= retention {
        return Vec::new();
    }
    backups[..backups.len() - retention]
        .iter()
        .map(|n| (*n).clone())
        .collect()
}

/// A backup is due when there is no previous backup or the newest one is at
/// least `interval_minutes` old.
pub fn is_backup_due(
    newest: Option<NaiveDateTime>,
    now: NaiveDateTime,
    interval_minutes: u32,
) -> bool {
    match newest {
        None => true,
        Some(ts) => {
            now.signed_duration_since(ts) >= chrono::Duration::minutes(interval_minutes as i64)
        }
    }
}

/// Seconds to sleep between two due-checks: a quarter of the interval,
/// clamped between one minute and [`MAX_TICK_SECS`], so short debug
/// intervals still fire promptly without hammering a WebDAV target on
/// normal configurations.
pub fn scheduler_tick_secs(interval_minutes: u32) -> u64 {
    ((interval_minutes as u64 * 60) / 4).clamp(60, MAX_TICK_SECS)
}

fn list_backup_names(dir: &PathBuf) -> Vec<String> {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default()
}

pub fn newest_backup_timestamp(dir: &PathBuf) -> Option<NaiveDateTime> {
    list_backup_names(dir)
        .iter()
        .filter_map(|n| parse_backup_timestamp(n))
        .max()
}

// ---------- WebDAV target ----------

fn webdav_file_url(base: &str, name: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), name)
}

/// Extracts backup file names from a WebDAV PROPFIND (Depth: 1) response.
/// Only `href` leaves whose last path segment matches the backup naming
/// pattern are returned, so foreign files are never touched.
pub fn parse_webdav_listing(xml: &str) -> Vec<String> {
    let Ok(doc) = roxmltree::Document::parse(xml) else {
        return Vec::new();
    };
    doc.descendants()
        .filter(|n| n.tag_name().name() == "href")
        .filter_map(|n| n.text())
        .filter_map(|href| href.trim_end_matches('/').rsplit('/').next())
        .filter_map(|name| {
            // Hrefs are percent-encoded; the backup pattern contains no
            // reserved characters, so plain names pass through unchanged.
            let name = name.to_string();
            parse_backup_timestamp(&name).map(|_| name)
        })
        .collect()
}

struct WebdavClient {
    http: reqwest::Client,
    base: String,
    username: String,
    password: String,
}

impl WebdavClient {
    fn from_config(config: &crate::config::AppConfig) -> Result<Self, String> {
        let base = config
            .backup_webdav_url
            .clone()
            .filter(|u| !u.is_empty())
            .ok_or("WebDAV URL is not configured")?;
        Ok(Self {
            http: reqwest::Client::new(),
            base,
            username: config.backup_webdav_username.clone().unwrap_or_default(),
            password: get_webdav_password()?.ok_or("WebDAV password is not set")?,
        })
    }

    async fn put(&self, name: &str, body: String) -> Result<(), String> {
        let resp = self
            .http
            .put(webdav_file_url(&self.base, name))
            .basic_auth(&self.username, Some(&self.password))
            .body(body)
            .send()
            .await
            .map_err(|e| format!("WebDAV upload failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("WebDAV upload failed: HTTP {}", resp.status()));
        }
        Ok(())
    }

    async fn list(&self) -> Result<Vec<String>, String> {
        let method = reqwest::Method::from_bytes(b"PROPFIND").map_err(|e| e.to_string())?;
        let resp = self
            .http
            .request(method, format!("{}/", self.base.trim_end_matches('/')))
            .basic_auth(&self.username, Some(&self.password))
            .header("Depth", "1")
            .send()
            .await
            .map_err(|e| format!("WebDAV listing failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("WebDAV listing failed: HTTP {}", resp.status()));
        }
        let xml = resp.text().await.map_err(|e| e.to_string())?;
        Ok(parse_webdav_listing(&xml))
    }

    async fn delete(&self, name: &str) -> Result<(), String> {
        let resp = self
            .http
            .delete(webdav_file_url(&self.base, name))
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .map_err(|e| format!("WebDAV delete failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("WebDAV delete failed: HTTP {}", resp.status()));
        }
        Ok(())
    }
}

// ---------- Backup execution ----------

fn backup_target(config: &crate::config::AppConfig) -> String {
    config
        .backup_target
        .clone()
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "local".to_string())
}

/// Timestamp of the newest existing backup on the configured target. Used
/// for the due-check; a target that cannot be inspected yields `None`.
async fn newest_backup(config: &crate::config::AppConfig) -> Option<NaiveDateTime> {
    match backup_target(config).as_str() {
        "webdav" => {
            let client = WebdavClient::from_config(config).ok()?;
            client
                .list()
                .await
                .ok()?
                .iter()
                .filter_map(|n| parse_backup_timestamp(n))
                .max()
        }
        _ => config
            .backup_directory
            .as_ref()
            .filter(|d| !d.is_empty())
            .and_then(|dir| newest_backup_timestamp(&PathBuf::from(dir))),
    }
}

/// Writes one encrypted backup to the configured target (local directory or
/// WebDAV) and prunes files beyond the retention count. Returns a
/// user-displayable location of the written backup.
pub async fn run_backup<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let config = crate::config::load_config_internal(&app);
    let password = get_password()?.ok_or("Backup password is not set")?;

    let payload = crate::commands::export_connections_payload(app.clone(), Some(true)).await?;
    let plaintext = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let envelope = crate::export_crypto::encrypt(&plaintext, &password)?;
    let content = serde_json::to_string_pretty(&envelope).map_err(|e| e.to_string())?;

    let name = backup_file_name(chrono::Local::now().naive_local());
    let retention = config.backup_retention.unwrap_or(DEFAULT_RETENTION) as usize;

    let location = match backup_target(&config).as_str() {
        "webdav" => {
            let client = WebdavClient::from_config(&config)?;
            client.put(&name, content).await?;
            match client.list().await {
                Ok(names) => {
                    for old in select_backups_to_prune(&names, retention) {
                        if let Err(e) = client.delete(&old).await {
                            log::warn!("Backup rotation: failed to remove {old}: {e}");
                        }
                    }
                }
                Err(e) => log::warn!("Backup rotation: WebDAV listing failed: {e}"),
            }
            webdav_file_url(&client.base, &name)
        }
        _ => {
            let dir = PathBuf::from(
                config
                    .backup_directory
                    .filter(|d| !d.is_empty())
                    .ok_or("Backup directory is not configured")?,
            );
            fs::create_dir_all(&dir).map_err(|e| format!("Cannot create backup directory: {e}"))?;
            let path = dir.join(&name);
            fs::write(&path, content).map_err(|e| format!("Cannot write backup file: {e}"))?;
            for old in select_backups_to_prune(&list_backup_names(&dir), retention) {
                if let Err(e) = fs::remove_file(dir.join(&old)) {
                    log::warn!("Backup rotation: failed to remove {old}: {e}");
                }
            }
            path.display().to_string()
        }
    };

    log::info!("Connections backup written to {location}");
    Ok(location)
}

fn backup_mode(config: &crate::config::AppConfig) -> String {
    config
        .backup_mode
        .clone()
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| "manual".to_string())
}

async fn run_and_log<R: Runtime>(app: &AppHandle<R>) {
    if let Err(e) = run_backup(app.clone()).await {
        log::warn!("Automatic connections backup failed: {e}");
    }
}

/// Interval mode: runs one backup when the newest one is older than the
/// configured interval.
async fn run_if_due<R: Runtime>(app: &AppHandle<R>) {
    let config = crate::config::load_config_internal(app);
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
        run_and_log(app).await;
    }
}

/// Called from the `RunEvent::Exit` handler. In on-close mode every exit
/// writes a backup so the freshest state is what gets saved. Synchronous:
/// the process is about to end.
pub fn run_exit_backup(app: &AppHandle) {
    let config = crate::config::load_config_internal(app);
    if backup_mode(&config) == "onClose" {
        tauri::async_runtime::block_on(run_and_log(app));
    }
}

/// Background task started at app launch. In on-launch mode it writes one
/// backup right away; in interval mode it checks periodically whether a
/// backup is due. Config is re-read on every tick so settings changes apply
/// without a restart (a switch to on-launch only takes effect at the next
/// start, like the mode's name says).
pub fn spawn_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if backup_mode(&crate::config::load_config_internal(&app)) == "onLaunch" {
            run_and_log(&app).await;
        }
        // Wake up every minute but only run the (possibly network-touching)
        // due-check at the tick cadence, so interval changes in the settings
        // take effect within a minute without hammering a WebDAV target.
        let mut last_check = std::time::Instant::now();
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            let interval = crate::config::load_config_internal(&app)
                .backup_interval_minutes
                .unwrap_or(DEFAULT_INTERVAL_MINUTES);
            if last_check.elapsed().as_secs() >= scheduler_tick_secs(interval) {
                last_check = std::time::Instant::now();
                run_if_due(&app).await;
            }
        }
    });
}

// ---------- Tauri commands ----------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub password_set: bool,
    pub webdav_password_set: bool,
    /// Timestamp of the newest backup on the configured target, local time.
    pub last_backup_at: Option<String>,
}

#[tauri::command]
pub async fn get_connections_backup_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<BackupStatus, String> {
    let config = crate::config::load_config_internal(&app);
    let last_backup_at = newest_backup(&config)
        .await
        .map(|ts| ts.format("%Y-%m-%dT%H:%M:%S").to_string());
    Ok(BackupStatus {
        password_set: get_password()?.is_some(),
        webdav_password_set: get_webdav_password()?.is_some(),
        last_backup_at,
    })
}

#[tauri::command]
pub async fn set_connections_backup_password(password: String) -> Result<(), String> {
    if password.is_empty() {
        delete_keychain(KEYCHAIN_USER)
    } else {
        set_keychain(KEYCHAIN_USER, &password)
    }
}

#[tauri::command]
pub async fn set_connections_backup_webdav_password(password: String) -> Result<(), String> {
    if password.is_empty() {
        delete_keychain(KEYCHAIN_WEBDAV_USER)
    } else {
        set_keychain(KEYCHAIN_WEBDAV_USER, &password)
    }
}

#[tauri::command]
pub async fn run_connections_backup<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    run_backup(app).await
}
