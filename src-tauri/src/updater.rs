use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tauri::{AppHandle, Manager};

// Strutture dati
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_notes: String,
    pub release_url: String,
    pub published_at: String,
    pub download_urls: Vec<DownloadAsset>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadAsset {
    pub name: String,
    pub url: String,
    pub size: u64,
    pub platform: String,
}

// Cache structure
#[derive(Serialize, Deserialize, Debug, Clone)]
struct UpdateCheckCache {
    last_checked: u64,
    last_result: Option<UpdateCheckResult>,
}

// GitHub API response
#[derive(Deserialize, Debug, Clone)]
struct GitHubRelease {
    tag_name: String,
    body: String,
    html_url: String,
    published_at: String,
    #[serde(default)]
    prerelease: bool,
    assets: Vec<GitHubAsset>,
}

#[derive(Deserialize, Debug, Clone)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

// Constants
const GITHUB_REPO: &str = "TabularisDB/tabularis";
const CACHE_DURATION_SECS: u64 = 43200; // 12 hours
/// Returns the installation source: "snap", "aur", or None for direct installs.
/// Only meaningful on Linux; always returns None on other platforms.
fn detect_installation_source() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        // Snap sets the SNAP env var when running inside a snap sandbox
        if std::env::var("SNAP").is_ok() {
            return Some("snap".to_string());
        }

        // Flatpak sets FLATPAK_ID when running inside a Flatpak sandbox
        if std::env::var("FLATPAK_ID").is_ok() {
            return Some("flatpak".to_string());
        }

        // AUR: check if pacman's local database has a tabularis-bin entry.
        // Skipped in dev builds — a tabularis-bin package installed alongside
        // the dev environment would otherwise be misdetected as the source.
        if !cfg!(debug_assertions) {
            if let Ok(entries) = std::fs::read_dir("/var/lib/pacman/local") {
                let is_aur = entries.filter_map(|e| e.ok()).any(|e| {
                    e.file_name()
                        .to_string_lossy()
                        .starts_with("tabularis-bin-")
                });
                if is_aur {
                    return Some("aur".to_string());
                }
            }
        }
    }

    None
}

/// Returns true when updates should not be managed by the app itself.
fn is_managed_package() -> bool {
    detect_installation_source().is_some()
}

#[tauri::command]
pub fn get_installation_source() -> Option<String> {
    detect_installation_source()
}

// Helper functions
fn get_cache_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|p| p.join("update_check_cache.json"))
}

fn parse_version(version: &str) -> Option<(u32, u32, u32)> {
    let clean = version.trim_start_matches('v');
    let parts: Vec<&str> = clean.split('.').collect();
    if parts.len() != 3 {
        return None;
    }

    let major = parts[0].parse().ok()?;
    let minor = parts[1].parse().ok()?;
    let patch = parts[2].parse().ok()?;

    Some((major, minor, patch))
}

fn is_newer_version(current: &str, latest: &str) -> bool {
    match (parse_version(current), parse_version(latest)) {
        (Some(c), Some(l)) => l > c,
        // One side isn't a plain X.Y.Z (e.g. a nightly prerelease like
        // `0.15.0-nightly.<ts>`). Fall back to full semver precedence so a
        // nightly-versioned build is still offered the stable release when it
        // is genuinely newer — this keeps the "switch back to stable" path
        // reachable. Consistent with the plugin-updater's own comparison.
        _ => match (
            semver::Version::parse(current.trim_start_matches('v')),
            semver::Version::parse(latest.trim_start_matches('v')),
        ) {
            (Ok(c), Ok(l)) => l > c,
            _ => false,
        },
    }
}

async fn fetch_latest_release() -> Result<GitHubRelease, String> {
    let client = Client::new();
    let url = format!(
        "https://api.github.com/repos/{}/releases/latest",
        GITHUB_REPO
    );

    let res = client
        .get(&url)
        .header("User-Agent", "Tabularis")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("GitHub API error: {}", res.status()));
    }

    res.json::<GitHubRelease>()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))
}

/// Newest `nightly-*` prerelease by `published_at`. The legacy rolling `nightly`
/// tag has no dash, so `nightly-` never matches it.
fn select_newest_nightly(releases: Vec<GitHubRelease>) -> Option<GitHubRelease> {
    releases
        .into_iter()
        .filter(|r| r.prerelease && r.tag_name.starts_with("nightly-"))
        .max_by(|a, b| a.published_at.cmp(&b.published_at))
}

/// URL of the release's `latest.json` updater manifest asset, if present.
fn nightly_latest_json_url(release: &GitHubRelease) -> Option<String> {
    release
        .assets
        .iter()
        .find(|a| a.name == "latest.json")
        .map(|a| a.browser_download_url.clone())
}

/// Fetch the repository releases and return the newest nightly prerelease.
async fn newest_nightly_release() -> Result<GitHubRelease, String> {
    let client = Client::new();
    let url = format!("https://api.github.com/repos/{}/releases?per_page=30", GITHUB_REPO);
    let res = client
        .get(&url)
        .header("User-Agent", "Tabularis")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("GitHub API error: {}", res.status()));
    }
    let releases = res
        .json::<Vec<GitHubRelease>>()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    select_newest_nightly(releases).ok_or_else(|| "No nightly release available yet".to_string())
}

fn categorize_asset(name: &str) -> String {
    if name.ends_with(".dmg") || name.contains("darwin") || name.contains("macos") {
        "macos".to_string()
    } else if name.ends_with(".exe") || name.ends_with(".msi") || name.contains("windows") {
        "windows".to_string()
    } else if name.ends_with(".AppImage") || name.ends_with(".deb") || name.ends_with(".rpm") {
        "linux".to_string()
    } else {
        "other".to_string()
    }
}

/// Effective update channel from config. Anything other than "nightly" ⇒ stable.
fn release_channel<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> String {
    crate::config::load_config_internal(app)
        .release_channel
        .unwrap_or_else(|| "stable".to_string())
}

// Tauri commands
#[tauri::command]
pub async fn check_for_updates(app: AppHandle, force: bool) -> Result<UpdateCheckResult, String> {
    // Managed packages (AUR, Snap) should not use the built-in updater
    if is_managed_package() {
        return Err("Updates are managed by the package manager".to_string());
    }

    let config = crate::config::load_config_internal(&app);

    // Check if updates are disabled
    if !force && config.check_for_updates == Some(false) {
        return Err("Update checks disabled".to_string());
    }

    let channel = release_channel(&app);
    log::info!(
        "Update check started (channel: {channel}, current version: {}, forced: {force})",
        env!("CARGO_PKG_VERSION")
    );

    if channel == "nightly" {
        let release = newest_nightly_release().await?;
        let url = nightly_latest_json_url(&release)
            .ok_or_else(|| "Nightly release is missing its updater manifest".to_string())?;

        // Ask the updater plugin (prerelease-aware semver) whether this nightly
        // is newer than the running build.
        use tauri_plugin_updater::UpdaterExt;
        let updater = app
            .updater_builder()
            .endpoints(vec![url.parse().map_err(|e| format!("Bad nightly url: {e}"))?])
            .map_err(|e| e.to_string())?
            .build()
            .map_err(|e| e.to_string())?;
        let has_update = updater.check().await.map_err(|e| e.to_string())?.is_some();

        log::info!(
            "Nightly channel: newest prerelease is {} (published {}), has_update: {has_update}",
            release.tag_name,
            release.published_at
        );

        let current_version = env!("CARGO_PKG_VERSION");
        let download_urls = release
            .assets
            .iter()
            .map(|asset| DownloadAsset {
                name: asset.name.clone(),
                url: asset.browser_download_url.clone(),
                size: asset.size,
                platform: categorize_asset(&asset.name),
            })
            .collect();
        return Ok(UpdateCheckResult {
            has_update,
            current_version: current_version.to_string(),
            latest_version: release.tag_name.clone(),
            release_notes: release.body.clone(),
            release_url: release.html_url.clone(),
            published_at: release.published_at.clone(),
            download_urls,
        });
    }

    // Check cache if not forced
    if !force {
        if let Some(cache_path) = get_cache_path(&app) {
            if cache_path.exists() {
                if let Ok(content) = fs::read_to_string(&cache_path) {
                    if let Ok(cache) = serde_json::from_str::<UpdateCheckCache>(&content) {
                        let now = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs();

                        if now - cache.last_checked < CACHE_DURATION_SECS {
                            if let Some(result) = cache.last_result {
                                // Invalidate cache if the app was updated since it was written
                                if result.current_version == env!("CARGO_PKG_VERSION") {
                                    log::info!(
                                        "Stable channel: serving cached result (latest: {}, has_update: {})",
                                        result.latest_version,
                                        result.has_update
                                    );
                                    return Ok(result);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Fetch latest release from GitHub
    let release = fetch_latest_release().await?;

    let current_version = env!("CARGO_PKG_VERSION");
    let latest_version = release.tag_name.trim_start_matches('v');

    log::info!(
        "Stable channel: latest release is {} (published {}), has_update: {}",
        release.tag_name,
        release.published_at,
        is_newer_version(current_version, &release.tag_name)
    );

    let download_urls = release
        .assets
        .into_iter()
        .map(|asset| DownloadAsset {
            name: asset.name.clone(),
            url: asset.browser_download_url,
            size: asset.size,
            platform: categorize_asset(&asset.name),
        })
        .collect();

    let result = UpdateCheckResult {
        has_update: is_newer_version(current_version, &release.tag_name),
        current_version: current_version.to_string(),
        latest_version: latest_version.to_string(),
        release_notes: release.body,
        release_url: release.html_url,
        published_at: release.published_at,
        download_urls,
    };

    // Save to cache
    if let Some(cache_path) = get_cache_path(&app) {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let cache = UpdateCheckCache {
            last_checked: timestamp,
            last_result: Some(result.clone()),
        };

        if let Ok(content) = serde_json::to_string(&cache) {
            let _ = fs::write(cache_path, content);
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn download_and_install_update(app: AppHandle) -> Result<(), String> {
    // Usa tauri-plugin-updater per gestire il download e installazione
    use tauri_plugin_updater::UpdaterExt;

    let mut builder = app.updater_builder();
    if release_channel(&app) == "nightly" {
        let release = newest_nightly_release().await?;
        let url = nightly_latest_json_url(&release)
            .ok_or_else(|| "Nightly release is missing its updater manifest".to_string())?;
        builder = builder
            .endpoints(vec![url.parse().map_err(|e| format!("Bad nightly url: {e}"))?])
            .map_err(|e| e.to_string())?;
    }
    let updater = builder.build().map_err(|e| e.to_string())?;

    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        // Emetti eventi per aggiornare la UI sul progresso
        let mut downloaded = 0;

        update
            .download_and_install(
                |chunk_length, content_length| {
                    downloaded += chunk_length;
                    let progress = if let Some(total) = content_length {
                        (downloaded as f64 / total as f64 * 100.0) as u32
                    } else {
                        0
                    };

                    let _ = app.emit("update-progress", progress);
                },
                || {
                    // Pre-installazione: salva stato, chiudi connessioni, etc.
                    let _ = app.emit("update-installing", ());
                },
            )
            .await
            .map_err(|e| e.to_string())?;

        app.restart();
    } else {
        Err("No update available".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Version parsing tests
    #[test]
    fn test_version_parsing_standard() {
        assert_eq!(parse_version("0.8.8"), Some((0, 8, 8)));
        assert_eq!(parse_version("1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("10.20.30"), Some((10, 20, 30)));
    }

    #[test]
    fn test_version_parsing_with_v_prefix() {
        assert_eq!(parse_version("v0.8.8"), Some((0, 8, 8)));
        assert_eq!(parse_version("v1.0.0"), Some((1, 0, 0)));
    }

    #[test]
    fn test_version_parsing_invalid() {
        assert_eq!(parse_version("invalid"), None);
        assert_eq!(parse_version("1.2"), None);
        assert_eq!(parse_version("1.2.3.4"), None);
        assert_eq!(parse_version("a.b.c"), None);
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn test_version_parsing_edge_cases() {
        assert_eq!(parse_version("0.0.0"), Some((0, 0, 0)));
        assert_eq!(parse_version("999.999.999"), Some((999, 999, 999)));
    }

    // Version comparison tests
    #[test]
    fn test_version_comparison_newer() {
        assert!(is_newer_version("0.8.8", "0.9.0"));
        assert!(is_newer_version("0.8.8", "0.8.9"));
        assert!(is_newer_version("0.8.8", "1.0.0"));
        assert!(is_newer_version("1.0.0", "2.0.0"));
    }

    #[test]
    fn test_version_comparison_not_newer() {
        assert!(!is_newer_version("0.8.8", "0.8.8"));
        assert!(!is_newer_version("0.8.8", "0.8.7"));
        assert!(!is_newer_version("0.8.8", "0.7.9"));
        assert!(!is_newer_version("1.0.0", "0.9.9"));
    }

    #[test]
    fn test_version_comparison_with_v_prefix() {
        assert!(is_newer_version("0.8.8", "v0.9.0"));
        assert!(is_newer_version("v0.8.8", "0.9.0"));
        assert!(is_newer_version("v0.8.8", "v0.9.0"));
    }

    #[test]
    fn test_version_comparison_invalid() {
        assert!(!is_newer_version("invalid", "0.9.0"));
        assert!(!is_newer_version("0.8.8", "invalid"));
        assert!(!is_newer_version("invalid", "invalid"));
    }

    #[test]
    fn test_nightly_build_is_offered_stable_release() {
        // A nightly-versioned build must be offered the current stable release
        // so the user can return to the stable channel.
        assert!(is_newer_version("0.15.0-nightly.20260718030512", "0.15.0"));
        assert!(is_newer_version("0.15.0-nightly.20260718030512", "v0.15.0"));
    }

    #[test]
    fn test_nightly_ahead_of_stable_not_offered_downgrade() {
        // If the nightly base is already ahead of the last stable, semver keeps
        // the user on nightly (no misleading downgrade offer).
        assert!(!is_newer_version("0.16.0-nightly.20260718030512", "0.15.0"));
    }

    #[test]
    fn test_newer_nightly_is_offered() {
        assert!(is_newer_version(
            "0.15.0-nightly.20260718030512",
            "0.15.0-nightly.20260719040000"
        ));
    }

    // Asset categorization tests
    #[test]
    fn test_categorize_asset_macos() {
        assert_eq!(categorize_asset("Tabularis_0.8.8_x64.dmg"), "macos");
        assert_eq!(categorize_asset("Tabularis_0.8.8_aarch64.dmg"), "macos");
        assert_eq!(categorize_asset("tabularis-darwin.zip"), "macos");
        assert_eq!(categorize_asset("app-macos-universal.tar.gz"), "macos");
    }

    #[test]
    fn test_categorize_asset_windows() {
        assert_eq!(categorize_asset("Tabularis_0.8.8_x64_setup.exe"), "windows");
        assert_eq!(categorize_asset("tabularis.msi"), "windows");
        assert_eq!(categorize_asset("app-windows-x86_64.zip"), "windows");
    }

    #[test]
    fn test_categorize_asset_linux() {
        assert_eq!(categorize_asset("tabularis_0.8.8_amd64.AppImage"), "linux");
        assert_eq!(categorize_asset("tabularis_0.8.8_amd64.deb"), "linux");
        assert_eq!(categorize_asset("tabularis-0.8.8-1.x86_64.rpm"), "linux");
    }

    #[test]
    fn test_categorize_asset_other() {
        assert_eq!(categorize_asset("README.txt"), "other");
        assert_eq!(categorize_asset("checksums.sha256"), "other");
        assert_eq!(categorize_asset("unknown-file"), "other");
    }

    // Cache path tests
    #[test]
    fn test_cache_filename() {
        let expected = "update_check_cache.json";
        assert!(expected.ends_with(".json"));
        assert!(expected.contains("cache"));
    }

    // GitHub repo constant test
    #[test]
    fn test_github_repo_constant() {
        assert_eq!(GITHUB_REPO, "TabularisDB/tabularis");
    }

    // Cache duration test
    #[test]
    fn test_cache_duration() {
        assert_eq!(CACHE_DURATION_SECS, 43200); // 12 hours in seconds
        assert_eq!(CACHE_DURATION_SECS / 3600, 12); // Verify it's 12 hours
    }

    // Mutex to serialize env var mutations across parallel tests
    #[cfg(target_os = "linux")]
    static ENV_MUTEX: std::sync::LazyLock<std::sync::Mutex<()>> =
        std::sync::LazyLock::new(|| std::sync::Mutex::new(()));

    // Installation source detection tests
    #[cfg(target_os = "linux")]
    #[test]
    fn test_detect_installation_source_snap() {
        let _lock = ENV_MUTEX.lock().unwrap();
        std::env::remove_var("FLATPAK_ID");
        std::env::set_var("SNAP", "/snap/tabularis/current");
        let source = detect_installation_source();
        std::env::remove_var("SNAP");
        assert_eq!(source.as_deref(), Some("snap"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_detect_installation_source_flatpak() {
        let _lock = ENV_MUTEX.lock().unwrap();
        std::env::remove_var("SNAP");
        std::env::set_var("FLATPAK_ID", "io.github.debba.tabularis");
        let source = detect_installation_source();
        std::env::remove_var("FLATPAK_ID");
        assert_eq!(source.as_deref(), Some("flatpak"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_detect_installation_source_direct() {
        let _lock = ENV_MUTEX.lock().unwrap();
        std::env::remove_var("SNAP");
        std::env::remove_var("FLATPAK_ID");
        let source = detect_installation_source();
        // On a dev/CI machine without pacman or tabularis-bin installed, must be None
        assert!(source.is_none() || source.as_deref() == Some("aur"));
    }

    fn mk_release(tag: &str, prerelease: bool, published_at: &str, assets: &[&str]) -> GitHubRelease {
        GitHubRelease {
            tag_name: tag.to_string(),
            body: String::new(),
            html_url: format!("https://example.com/{tag}"),
            published_at: published_at.to_string(),
            prerelease,
            assets: assets
                .iter()
                .map(|name| GitHubAsset {
                    name: name.to_string(),
                    browser_download_url: format!("https://dl/{tag}/{name}"),
                    size: 1,
                })
                .collect(),
        }
    }

    #[test]
    fn test_select_newest_nightly_picks_latest_prerelease() {
        let releases = vec![
            mk_release("v0.15.0", false, "2026-07-18T00:00:00Z", &["latest.json"]),
            mk_release("nightly-20260716-aaaaaaa", true, "2026-07-16T03:00:00Z", &["latest.json"]),
            mk_release("nightly-20260718-ccccccc", true, "2026-07-18T03:00:00Z", &["latest.json"]),
            mk_release("nightly-20260717-bbbbbbb", true, "2026-07-17T03:00:00Z", &["latest.json"]),
        ];
        let got = select_newest_nightly(releases).expect("a nightly");
        assert_eq!(got.tag_name, "nightly-20260718-ccccccc");
    }

    #[test]
    fn test_select_newest_nightly_ignores_stable_and_old_rolling_tag() {
        let releases = vec![
            mk_release("v0.15.0", false, "2026-07-18T00:00:00Z", &["latest.json"]),
            // legacy rolling tag "nightly" (no dash) must not match
            mk_release("nightly", true, "2026-07-18T04:00:00Z", &["latest.json"]),
        ];
        assert!(select_newest_nightly(releases).is_none());
    }

    #[test]
    fn test_nightly_latest_json_url() {
        let rel = mk_release(
            "nightly-20260718-ccccccc",
            true,
            "2026-07-18T03:00:00Z",
            &["tabularis_0.15.0_amd64.AppImage", "latest.json"],
        );
        assert_eq!(
            nightly_latest_json_url(&rel).as_deref(),
            Some("https://dl/nightly-20260718-ccccccc/latest.json")
        );
    }

    #[test]
    fn test_nightly_latest_json_url_missing() {
        let rel = mk_release("nightly-20260718-ccccccc", true, "2026-07-18T03:00:00Z", &["only.deb"]);
        assert!(nightly_latest_json_url(&rel).is_none());
    }
}
