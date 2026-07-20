//! BACKWARDS-COMPAT LAYER — remove after the Tabularium registry GA once all
//! published plugins have migrated to the new manifest/registry format.
//!
//! Everything legacy lives here so removal is mechanical:
//!   1. Delete this file.
//!   2. `grep -rn "COMPAT(registry-ga)"` and revert each marked call site
//!      (config.rs, commands.rs, installer.rs).
//!   3. Remove `pub mod compat;` from plugins/mod.rs.
//!
//! See docs/superpowers/specs/2026-06-06-deeplink-versioning-and-bc-layer-design.md
//!
//! Covers four legacy paths:
//!   1. Config key alias            `custom_registry_url` -> `tabularium_registry_url`
//!   2. Static flat `registry.json` fetcher (pre-API registries)
//!   3. Legacy GitHub-raw default URL fallback
//!   4. Legacy `manifest.json` bundle manifest

use std::collections::HashSet;
use std::path::Path;

use crate::plugins::registry::{self, PluginRegistry};

/// Legacy default registry: the flat `registry.json` hosted on GitHub that
/// `main` shipped before the Tabularium API cutover. Used only as a
/// last-resort fallback (see `resolve_registry`).
pub const LEGACY_REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/TabularisDB/tabularis/main/plugins/registry.json";

/// Fetches and parses a legacy flat-JSON registry from `url`. The
/// `PluginRegistry` struct still deserializes the old schema unchanged
/// (new fields are `#[serde(default)]`).
pub async fn fetch_legacy_registry(url: &str) -> Result<PluginRegistry, String> {
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to fetch legacy plugin registry: {}", e))?;
    if !response.status().is_success() {
        return Err(format!(
            "Legacy registry at {} returned HTTP {}",
            url,
            response.status()
        ));
    }
    response
        .json::<PluginRegistry>()
        .await
        .map_err(|e| format!("Failed to parse legacy plugin registry: {}", e))
}

/// COMPAT(registry-ga): registry-fetch entry point that MERGES the Tabularium
/// API with the legacy static `registry.json`, so plugins not yet migrated to
/// the API stay visible during the transition.
///
/// Order:
///   1. If `base_url` ends in `.json`, that file IS the source — return it
///      verbatim (no API, no merge).
///   2. Otherwise fetch the API and the legacy registry, then UNION them with
///      `merge_registries` (API entry wins on id conflict).
///   3. If only one side is reachable, use it (API down → legacy only; legacy
///      unreachable → API only).
///   4. If both fail, surface the ORIGINAL API error.
///   5. Installed plugins the 0.13 list endpoint hides are re-resolved by slug
///      (see `readd_unlisted_installed`).
pub async fn resolve_registry(
    base_url: &str,
    legacy_url: &str,
    installed_ids: &[String],
) -> Result<PluginRegistry, String> {
    // Explicit static registry — the configured file is the sole source.
    if base_url.ends_with(".json") {
        return fetch_legacy_registry(base_url).await;
    }

    let api = registry::fetch_tabularium_registry(base_url).await;
    let legacy = fetch_legacy_registry(legacy_url).await;

    let mut resolved = match (api, legacy) {
        (Ok(api), Ok(legacy)) => merge_registries(stamp_api_source(api, base_url), legacy),
        (Ok(api), Err(e)) => {
            log::warn!("Legacy registry merge skipped ({}): {}", legacy_url, e);
            stamp_api_source(api, base_url)
        }
        (Err(e), Ok(legacy)) => {
            log::warn!(
                "Tabularium API failed ({}): {} — using legacy registry only",
                base_url,
                e
            );
            // The API is down, so slug lookups would fail too — return as-is.
            return Ok(legacy);
        }
        (Err(api_err), Err(_)) => return Err(api_err),
    };

    readd_unlisted_installed(&mut resolved, base_url, installed_ids).await;
    Ok(resolved)
}

/// Re-attaches installed plugins that the catalogue no longer lists.
///
/// Registry 0.13 gates `GET /api/plugins` on a manifest having resolved at
/// ingest, so a plugin can vanish from the list while `GET /api/plugins/{slug}`
/// still resolves it. Dropping out of the list is not a deletion: without this,
/// an installed plugin would silently lose its update path the moment its
/// publisher shipped a release whose `.tabularium` didn't resolve.
///
/// Slugs the API doesn't know (locally-installed or legacy-only plugins) are
/// skipped quietly — they're not expected to be there.
async fn readd_unlisted_installed(
    reg: &mut PluginRegistry,
    base_url: &str,
    installed_ids: &[String],
) {
    let listed: HashSet<&str> = reg.plugins.iter().map(|p| p.id.as_str()).collect();
    let missing: Vec<&String> = installed_ids
        .iter()
        .filter(|id| !listed.contains(id.as_str()))
        .collect();
    if missing.is_empty() {
        return;
    }

    for id in missing {
        match crate::plugins::tabularium::fetch_plugin_detail(base_url, id).await {
            Ok(mut plugin) => {
                plugin.registry_base_url = Some(base_url.trim_end_matches('/').to_string());
                log::info!(
                    "Plugin '{}' is installed but unlisted (unresolved manifest at ingest) — resolved by slug",
                    id
                );
                reg.plugins.push(plugin);
            }
            Err(e) => {
                log::debug!("Installed plugin '{}' not resolvable on the API: {}", id, e);
            }
        }
    }
}

/// Records which registry served these plugins. Only API entries are stamped:
/// the merge below drops the distinction, and a legacy plugin has no detail
/// page on the API — stamping it would make the frontend link to a
/// `<base>/plugins/<id>` that 404s instead of falling back to its homepage.
fn stamp_api_source(mut api: PluginRegistry, base_url: &str) -> PluginRegistry {
    let base = base_url.trim_end_matches('/').to_string();
    for plugin in &mut api.plugins {
        plugin.registry_base_url = Some(base.clone());
    }
    api
}

/// Union two registries, preferring `api` entries on id conflict. Plugins that
/// exist only in `legacy` (not yet migrated to the API) are appended.
fn merge_registries(api: PluginRegistry, legacy: PluginRegistry) -> PluginRegistry {
    use std::collections::HashSet;
    let seen: HashSet<&str> = api.plugins.iter().map(|p| p.id.as_str()).collect();
    let extra: Vec<_> = legacy
        .plugins
        .into_iter()
        .filter(|p| !seen.contains(p.id.as_str()))
        .collect();
    let mut plugins = api.plugins;
    plugins.extend(extra);
    PluginRegistry {
        schema_version: 1,
        plugins,
    }
}

/// COMPAT(registry-ga): URL of the legacy static `registry.json` to merge with
/// the API. Configurable via `legacy_registry_url`; defaults to the built-in
/// GitHub-hosted file.
pub fn legacy_registry_url(config: &crate::config::AppConfig) -> String {
    config
        .legacy_registry_url
        .clone()
        .unwrap_or_else(|| LEGACY_REGISTRY_URL.to_string())
}

/// COMPAT(registry-ga): whether a bundle ships a legacy `manifest.json`.
/// Kept next to `read_legacy_manifest` so both disappear together at the
/// cutover — a presence check that disagrees with the read path is what makes
/// legacy bundles look manifest-less.
pub fn has_legacy_manifest(dir: &Path) -> bool {
    dir.join("manifest.json").exists()
}

/// COMPAT(registry-ga): reads a legacy `manifest.json` bundle manifest for
/// plugins published before the `.tabularium` cutover. Same JSON shape — the
/// canonical structs tolerate the old flat fields via `#[serde(default)]`.
pub fn read_legacy_manifest<T: serde::de::DeserializeOwned>(dir: &Path) -> Option<Result<T, String>> {
    let path = dir.join("manifest.json");
    if !path.exists() {
        return None;
    }
    let read = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read legacy manifest {:?}: {}", path, e))
        .and_then(|s| {
            serde_json::from_str::<T>(&s)
                .map_err(|e| format!("Failed to parse legacy manifest {:?}: {}", path, e))
        });
    Some(read)
}

/// Folds a legacy `custom_registry_url` into `tabularium_registry_url` when the
/// new key is unset, then clears the legacy field so it never round-trips back
/// to disk. The new key always wins if both are present.
pub fn migrate_legacy_config(config: &mut crate::config::AppConfig) {
    if let Some(legacy) = config.custom_registry_url.take() {
        if config.tabularium_registry_url.is_none() {
            config.tabularium_registry_url = Some(legacy);
        }
    }
}

/// COMPAT(registry-ga): a plugin asset resolved from a static flat `registry.json`.
/// Static registries carry no per-asset sha256 and have no tracked-download
/// endpoint, so `download_url` is the direct asset URL (matching the pre-API
/// install path) and `expected_sha256` is always `None`.
pub struct StaticAsset {
    pub download_url: String,
    pub expected_sha256: Option<String>,
    pub version: String,
}

/// COMPAT(registry-ga): resolve a plugin's download asset from a static flat
/// `registry.json` (configured registry URL ending in `.json`). Returns `None`
/// when `base_url` is not a static registry, signalling the caller to use the
/// Tabularium API path instead.
pub async fn resolve_static_asset(
    base_url: &str,
    slug: &str,
    version: Option<&str>,
    platform: &str,
) -> Option<Result<StaticAsset, String>> {
    if !base_url.ends_with(".json") {
        return None;
    }
    Some(fetch_static_asset(base_url, slug, version, platform).await)
}

/// COMPAT(registry-ga): fetch + resolve a plugin asset from a specific static
/// `registry.json` URL. Used as the install fallback for plugins that live only
/// in the legacy registry (not yet migrated to the API), regardless of the
/// configured registry's URL shape.
pub async fn fetch_static_asset(
    url: &str,
    slug: &str,
    version: Option<&str>,
    platform: &str,
) -> Result<StaticAsset, String> {
    let registry = fetch_legacy_registry(url).await?;
    pick_static_asset(&registry, slug, version, platform)
}

/// Pure asset picker over an already-fetched static registry — mirrors the
/// pre-API install resolution: find the plugin, pick the requested release
/// (or latest), then the platform asset or the `universal` fallback.
fn pick_static_asset(
    registry: &PluginRegistry,
    slug: &str,
    version: Option<&str>,
    platform: &str,
) -> Result<StaticAsset, String> {
    let plugin = registry
        .plugins
        .iter()
        .find(|p| p.id == slug)
        .ok_or_else(|| format!("Plugin '{}' not found in registry", slug))?;
    let target_version = version
        .map(str::to_string)
        .unwrap_or_else(|| plugin.latest_version.clone());
    let release = plugin
        .releases
        .iter()
        .find(|r| r.version == target_version)
        .ok_or_else(|| format!("No release '{}' for plugin '{}'", target_version, slug))?;
    let download_url = release
        .assets
        .get(platform)
        .or_else(|| release.assets.get("universal"))
        .cloned()
        .ok_or_else(|| format!("Plugin '{}' does not support platform '{}'", slug, platform))?;
    Ok(StaticAsset {
        download_url,
        expected_sha256: None,
        version: target_version,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AppConfig;
    use crate::plugins::registry::{PluginRegistry, PluginRelease, RegistryPlugin};
    use std::collections::HashMap;

    fn static_registry() -> PluginRegistry {
        let mut assets = HashMap::new();
        assets.insert(
            "linux-x64".to_string(),
            "https://host/firestore-0.5.0-linux-x64.zip".to_string(),
        );
        assets.insert(
            "universal".to_string(),
            "https://host/firestore-0.5.0-universal.zip".to_string(),
        );
        PluginRegistry {
            schema_version: 1,
            plugins: vec![RegistryPlugin {
                id: "firestore".to_string(),
                latest_version: "0.5.0".to_string(),
                releases: vec![PluginRelease {
                    version: "0.5.0".to_string(),
                    min_tabularis_version: None,
                    assets,
                }],
                ..Default::default()
            }],
        }
    }

    #[test]
    fn static_asset_picks_platform_then_latest() {
        let reg = static_registry();
        let a = pick_static_asset(&reg, "firestore", None, "linux-x64").expect("resolves");
        assert_eq!(a.download_url, "https://host/firestore-0.5.0-linux-x64.zip");
        assert_eq!(a.version, "0.5.0"); // None → latest
        assert!(a.expected_sha256.is_none()); // static registries carry no sha
    }

    #[test]
    fn static_asset_falls_back_to_universal() {
        let reg = static_registry();
        let a = pick_static_asset(&reg, "firestore", Some("0.5.0"), "win-x64").expect("universal");
        assert_eq!(a.download_url, "https://host/firestore-0.5.0-universal.zip");
    }

    #[test]
    fn static_asset_errors_on_unknown_plugin_release_or_platform() {
        let reg = static_registry();
        assert!(pick_static_asset(&reg, "nope", None, "linux-x64").is_err());
        assert!(pick_static_asset(&reg, "firestore", Some("9.9.9"), "linux-x64").is_err());
        let mut reg2 = static_registry();
        reg2.plugins[0].releases[0].assets.remove("universal");
        reg2.plugins[0].releases[0].assets.remove("linux-x64");
        reg2.plugins[0].releases[0]
            .assets
            .insert("darwin-arm64".to_string(), "x".to_string());
        assert!(pick_static_asset(&reg2, "firestore", None, "linux-x64").is_err());
    }

    #[tokio::test]
    async fn resolve_static_asset_returns_none_for_non_json_base() {
        // Non-.json base must defer to the API path (None), no network hit.
        assert!(resolve_static_asset("https://registry.tabularis.dev", "firestore", None, "linux-x64")
            .await
            .is_none());
    }

    fn registry_with_ids(ids: &[&str]) -> PluginRegistry {
        PluginRegistry {
            schema_version: 1,
            plugins: ids
                .iter()
                .map(|id| RegistryPlugin {
                    id: (*id).to_string(),
                    latest_version: "1.0.0".to_string(),
                    ..Default::default()
                })
                .collect(),
        }
    }

    #[test]
    fn merge_unions_legacy_only_plugins_and_api_wins_on_conflict() {
        let api = PluginRegistry {
            schema_version: 1,
            plugins: vec![RegistryPlugin {
                id: "firestore".to_string(),
                latest_version: "0.5.0".to_string(), // API version
                ..Default::default()
            }],
        };
        let legacy = registry_with_ids(&["firestore", "duckdb", "csv"]); // legacy firestore is 1.0.0
        let merged = merge_registries(api, legacy);
        let ids: Vec<&str> = merged.plugins.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["firestore", "duckdb", "csv"]); // API firestore first, legacy-only appended
        let fs = merged.plugins.iter().find(|p| p.id == "firestore").unwrap();
        assert_eq!(fs.latest_version, "0.5.0", "API entry must win on id conflict");
    }

    // Regression: a plugin that only exists in the legacy registry (e.g. redis,
    // not yet migrated) must not be stamped with the API base — the frontend
    // would link to `<base>/plugins/redis`, which 404s, instead of falling back
    // to the plugin's own homepage.
    #[test]
    fn only_api_plugins_carry_the_registry_base_url() {
        let api = PluginRegistry {
            schema_version: 1,
            plugins: vec![RegistryPlugin {
                id: "firestore".to_string(),
                ..Default::default()
            }],
        };
        let legacy = registry_with_ids(&["redis"]);
        let merged = merge_registries(
            stamp_api_source(api, "https://registry.tabularis.dev/"),
            legacy,
        );

        let api_plugin = merged.plugins.iter().find(|p| p.id == "firestore").unwrap();
        assert_eq!(
            api_plugin.registry_base_url.as_deref(),
            Some("https://registry.tabularis.dev"),
            "API plugin keeps the serving registry (trailing slash trimmed)"
        );

        let legacy_plugin = merged.plugins.iter().find(|p| p.id == "redis").unwrap();
        assert_eq!(
            legacy_plugin.registry_base_url, None,
            "legacy-only plugin must stay unstamped so the UI uses its homepage"
        );
    }

    // Registry 0.13 hides plugins whose manifest didn't resolve at ingest, so an
    // installed plugin can drop out of the catalogue while its slug still
    // resolves. Nothing to re-add while it's still listed — the lookup only
    // fires for genuinely missing ones (the network path is exercised live).
    #[tokio::test]
    async fn listed_installed_plugins_are_not_looked_up_again() {
        let mut reg = registry_with_ids(&["firestore", "duckdb"]);
        let before = reg.plugins.len();
        // Port 0 is unconnectable: any slug lookup here would error out, and a
        // lookup for an already-listed id would be a bug.
        readd_unlisted_installed(
            &mut reg,
            "http://127.0.0.1:0",
            &["firestore".to_string(), "duckdb".to_string()],
        )
        .await;
        assert_eq!(reg.plugins.len(), before);
    }

    // An unresolvable slug (locally-installed plugin, or API down) must not
    // fail the catalogue — it's skipped, the rest still renders.
    #[tokio::test]
    async fn unresolvable_slugs_are_skipped_not_fatal() {
        let mut reg = registry_with_ids(&["firestore"]);
        readd_unlisted_installed(&mut reg, "http://127.0.0.1:0", &["my-local-plugin".to_string()])
            .await;
        assert_eq!(
            reg.plugins.len(),
            1,
            "a slug the API can't resolve must leave the catalogue intact"
        );
    }

    #[test]
    fn legacy_registry_url_defaults_then_honours_config() {
        let mut cfg = AppConfig::default();
        assert_eq!(legacy_registry_url(&cfg), LEGACY_REGISTRY_URL);
        cfg.legacy_registry_url = Some("https://self.host/registry.json".into());
        assert_eq!(legacy_registry_url(&cfg), "https://self.host/registry.json");
    }

    #[test]
    fn migrates_legacy_registry_key_when_new_unset() {
        let mut cfg = AppConfig {
            custom_registry_url: Some("https://old.example/registry.json".into()),
            tabularium_registry_url: None,
            ..Default::default()
        };
        migrate_legacy_config(&mut cfg);
        assert_eq!(
            cfg.tabularium_registry_url.as_deref(),
            Some("https://old.example/registry.json")
        );
        assert!(cfg.custom_registry_url.is_none(), "legacy key must be cleared");
    }

    #[test]
    fn new_key_wins_over_legacy() {
        let mut cfg = AppConfig {
            custom_registry_url: Some("https://old.example".into()),
            tabularium_registry_url: Some("https://new.example".into()),
            ..Default::default()
        };
        migrate_legacy_config(&mut cfg);
        assert_eq!(cfg.tabularium_registry_url.as_deref(), Some("https://new.example"));
        assert!(cfg.custom_registry_url.is_none());
    }

    #[tokio::test]
    async fn json_suffix_url_takes_legacy_path() {
        // A bogus .json URL must fail via the legacy fetcher (network error),
        // proving it never went through the Tabularium SDK path.
        let err = resolve_registry("http://127.0.0.1:0/registry.json", LEGACY_REGISTRY_URL, &[])
            .await
            .unwrap_err();
        assert!(
            err.contains("legacy plugin registry"),
            "expected legacy-path error, got: {err}"
        );
    }

    #[test]
    fn reads_legacy_manifest_json() {
        use crate::plugins::manager::ConfigManifest;
        let dir = std::env::temp_dir().join("tab-compat-test-manifest");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("manifest.json"),
            r#"{"name":"legacy","version":"1.0.0","description":"old"}"#,
        )
        .unwrap();
        let parsed: ConfigManifest = read_legacy_manifest(&dir).unwrap().unwrap();
        assert_eq!(parsed.name, "legacy");
        assert_eq!(parsed.version, "1.0.0");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
