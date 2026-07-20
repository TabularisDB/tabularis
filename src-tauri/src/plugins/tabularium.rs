//! Tabularium registry client.
//!
//! Tabularium is a self-hosted plugin registry (https://tabularium.wiki).
//! HTTP transport and typed deserialization are delegated to the
//! [`tabularium_sdk`] crate — a progenitor-generated client kept in sync
//! with the registry's OpenAPI spec. This module only adapts the SDK's
//! response shapes into the legacy `RegistryPlugin` representation that
//! the rest of Tabularis already speaks.
//!
//! Endpoints used:
//! * `list_plugins`          — paginated catalogue
//! * `get_plugin`            — detail + releases (each with per-asset metadata)
//! * `get_release_integrity` — JWS / sha256 envelope; verified in
//!   `resolve_expected_sha` (see `integrity` module) so the installer enforces
//!   the SIGNED asset hash, not the unsigned envelope.

use std::collections::HashMap;

use tabularium_sdk::Client;

use crate::plugins::registry::{PluginRelease, RegistryPlugin};

/// Strips a trailing `/` so the SDK doesn't end up with `//api/...` URLs.
fn normalise_base(base: &str) -> &str {
    base.trim_end_matches('/')
}

/// Map a Tabularium platform key (the registry stores them as
/// `linux-x64` / `darwin-arm64` / `win-x64` / `universal`, which already
/// matches Tabularis) into the legacy key. Kept as a function in case
/// the registry ever introduces variants that need re-keying.
fn normalise_platform_key(raw: &str) -> String {
    match raw {
        // Common aliases — defensive in case the registry serves these.
        "linux-amd64" | "linux-x86_64" => "linux-x64".to_string(),
        "linux-aarch64" => "linux-arm64".to_string(),
        "darwin-amd64" | "darwin-x86_64" | "macos-x64" => "darwin-x64".to_string(),
        "darwin-aarch64" | "macos-arm64" => "darwin-arm64".to_string(),
        "windows-x64" | "win-amd64" | "windows-amd64" => "win-x64".to_string(),
        _ => raw.to_string(),
    }
}

/// Build a fresh SDK client against the operator-configured base URL.
/// The client is cheap to construct (wraps a `reqwest::Client`), so callers
/// don't need to cache it for one-shot fetches.
fn make_client(base_url: &str) -> Client {
    Client::new(normalise_base(base_url))
}

/// Fetch the first page of plugins. The SDK exposes pagination via
/// `limit(...).page(...)`; we ask for the maximum the registry serves
/// (200 fits the typical Tabularis install in one round-trip).
pub async fn fetch_plugin_list(base_url: &str) -> Result<Vec<RegistryPlugin>, String> {
    let client = make_client(base_url);
    let resp = client
        .list_plugins()
        .limit("200")
        .send()
        .await
        .map_err(|e| format!("Tabularium list_plugins failed: {}", e))?;
    let body = resp.into_inner();
    Ok(body.plugins.into_iter().map(list_item_to_plugin).collect())
}

/// Fetch full detail for one plugin (releases + per-asset sha256/url).
pub async fn fetch_plugin_detail(
    base_url: &str,
    slug: &str,
) -> Result<RegistryPlugin, String> {
    let client = make_client(base_url);
    let resp = client
        .get_plugin()
        .slug(slug)
        .send()
        .await
        .map_err(|e| format!("Tabularium get_plugin '{}' failed: {}", slug, e))?;
    Ok(detail_to_plugin(resp.into_inner()))
}

/// Splits a platform key (`{os}-{arch}`, e.g. `linux-x64`) into the separate
/// `os` / `arch` the tracked-download endpoints expect. A key without a `-`
/// yields `(key, "")`.
fn split_platform(platform: &str) -> (&str, &str) {
    platform.split_once('-').unwrap_or((platform, ""))
}

/// Builds the registry's **tracked** download URL for a specific version:
/// `{base}/api/plugins/{slug}/releases/{version}?os={os}&arch={arch}&redirect=1`.
/// Hitting this endpoint increments the plugin's download counter, then
/// 302-redirects to the real asset (reqwest follows the redirect automatically).
pub fn tracked_download_url(base_url: &str, slug: &str, version: &str, platform: &str) -> String {
    let base = base_url.trim_end_matches('/');
    let (os, arch) = split_platform(platform);
    format!(
        "{}/api/plugins/{}/releases/{}?os={}&arch={}&redirect=1",
        base, slug, version, os, arch
    )
}

/// Builds the registry's **tracked latest** download URL:
/// `{base}/api/plugins/{slug}/latest?os={os}&arch={arch}&redirect=1`.
/// Used when installing the latest version (no pinned version) so the registry
/// records a "latest" download; like the versioned endpoint it 302-redirects to
/// the asset.
pub fn tracked_latest_download_url(base_url: &str, slug: &str, platform: &str) -> String {
    let base = base_url.trim_end_matches('/');
    let (os, arch) = split_platform(platform);
    format!(
        "{}/api/plugins/{}/latest?os={}&arch={}&redirect=1",
        base, slug, os, arch
    )
}

/// Per-platform asset resolution for installation. Returns the download URL
/// plus the SHA-256 the installer must match. When the release is signed, this
/// SHA comes from *inside* the verified JWS payload — never the unsigned
/// envelope. `None` only for legacy releases that carry no hash at all.
pub struct AssetResolution {
    pub download_url: String,
    pub expected_sha256: Option<String>,
}

pub async fn resolve_asset(
    base_url: &str,
    slug: &str,
    version: &str,
    platform: &str,
) -> Result<AssetResolution, String> {
    let client = make_client(base_url);
    let raw = client
        .get_plugin()
        .slug(slug)
        .send()
        .await
        .map_err(|e| format!("Tabularium get_plugin '{}' failed: {}", slug, e))?
        .into_inner();
    let release = raw
        .releases
        .iter()
        .find(|r| r.version == version)
        .ok_or_else(|| format!("No release '{}' for plugin '{}'", version, slug))?;

    // The per-platform asset map (`releases[].assets`) is left untyped by the
    // SDK (`patternProperties` in OpenAPI → `serde_json::Map<String, Value>`).
    // We read `url` and `sha256` directly off the JSON object.
    let pick = pick_asset_entry(&release.assets, platform);
    let entry = match pick {
        Some(e) => e,
        None => {
            return Err(format!(
                "Plugin '{}' has no asset for platform '{}'",
                slug, platform
            ))
        }
    };
    let url = entry
        .get("url")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Tabularium asset for '{}' is missing 'url'", slug))?;
    // The forge filename — the key the signed integrity payload uses to name
    // this asset (e.g. `firestore-plugin-linux-x64.zip`).
    let asset_name = url.rsplit('/').next().unwrap_or(&url).to_string();
    let envelope_sha = entry
        .get("sha256")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let expected_sha256 =
        resolve_expected_sha(base_url, slug, version, &asset_name, envelope_sha).await?;

    Ok(AssetResolution {
        download_url: url,
        expected_sha256,
    })
}

/// Resolve the SHA-256 the installer must enforce, preferring the
/// signature-verified value from the release's integrity JWS.
///
/// * signed release  → verify the JWS and return the SIGNED per-asset hash;
///   any verification failure is fatal (fail closed — never silently fall back
///   to the unsigned envelope hash).
/// * unsigned release → return the envelope hash and warn; the installer still
///   hash-checks, but that only guards forge-side corruption, not a hostile
///   registry.
/// * integrity endpoint unreachable → degrade to the envelope hash so a
///   transient outage doesn't block installs.
async fn resolve_expected_sha(
    base_url: &str,
    slug: &str,
    version: &str,
    asset_name: &str,
    envelope_sha: Option<String>,
) -> Result<Option<String>, String> {
    use tabularium_sdk::types::GetReleaseIntegrityResponse as Integ;

    let client = make_client(base_url);
    let integ = match client
        .get_release_integrity()
        .slug(slug)
        .version(version)
        .send()
        .await
    {
        Ok(resp) => resp.into_inner(),
        Err(e) => {
            log::warn!(
                "Integrity endpoint failed for {}@{}: {} — using unsigned envelope hash",
                slug,
                version,
                e
            );
            return Ok(envelope_sha);
        }
    };

    match integ {
        Integ::Variant0 { jws, .. } => {
            // We fetch the JWKS fresh per install, so it already carries the
            // current + previous keys — no stale-cache re-fetch dance needed.
            let jwks = crate::plugins::integrity::fetch_jwks(base_url).await?;
            let payload =
                crate::plugins::integrity::verify_jws(&jws, &jwks, slug, version, base_url)?;
            let sha = payload.sha256_for(asset_name).ok_or_else(|| {
                format!(
                    "Release {}@{} is signed but asset '{}' is not covered by the signature",
                    slug, version, asset_name
                )
            })?;
            log::info!(
                "Verified registry signature for {}@{} ({})",
                slug,
                version,
                asset_name
            );
            Ok(Some(sha.to_string()))
        }
        Integ::Variant1 { .. } => {
            // ponytail: unsigned legacy release. Hash-check still runs, but the
            // hash is registry-supplied and unsigned. Tighten to refuse (or gate
            // behind a trust-policy setting) once the registry backfills JWS
            // signatures across releases.
            log::warn!(
                "Release {}@{} is unsigned (no JWS) — installing with an unverified hash",
                slug,
                version
            );
            Ok(envelope_sha)
        }
    }
}

/// Probe a release's integrity signature for the install UI — verifies the JWS
/// (identity guards included) without needing a specific asset. Never errors:
/// every failure maps to a [`SignatureStatus`] the modal can badge.
pub async fn check_release_signature(
    base_url: &str,
    slug: &str,
    version: &str,
) -> crate::plugins::registry::SignatureStatus {
    use crate::plugins::registry::SignatureStatus;
    use tabularium_sdk::types::GetReleaseIntegrityResponse as Integ;

    let client = make_client(base_url);
    let integ = match client
        .get_release_integrity()
        .slug(slug)
        .version(version)
        .send()
        .await
    {
        Ok(resp) => resp.into_inner(),
        Err(e) => {
            log::warn!("Integrity probe failed for {}@{}: {}", slug, version, e);
            return SignatureStatus::Unknown;
        }
    };

    match integ {
        Integ::Variant0 { jws, .. } => match crate::plugins::integrity::fetch_jwks(base_url).await {
            Ok(jwks) => {
                match crate::plugins::integrity::verify_jws(&jws, &jwks, slug, version, base_url) {
                    Ok(_) => SignatureStatus::Verified,
                    Err(e) => {
                        log::error!("Signature INVALID for {}@{}: {}", slug, version, e);
                        SignatureStatus::Invalid
                    }
                }
            }
            Err(e) => {
                log::warn!("JWKS fetch failed while probing {}@{}: {}", slug, version, e);
                SignatureStatus::Unknown
            }
        },
        Integ::Variant1 { .. } => SignatureStatus::Unsigned,
    }
}

/// Picks the JSON object describing the asset for the requested platform.
/// Tries the exact key first, then known aliases (matched via
/// [`normalise_platform_key`]), then the `universal` fallback.
fn pick_asset_entry<'a>(
    assets: &'a serde_json::Map<String, serde_json::Value>,
    platform: &str,
) -> Option<&'a serde_json::Map<String, serde_json::Value>> {
    let direct = assets.get(platform).and_then(|v| v.as_object());
    if direct.is_some() {
        return direct;
    }
    for (k, v) in assets.iter() {
        if normalise_platform_key(k) == platform {
            if let Some(obj) = v.as_object() {
                return Some(obj);
            }
        }
    }
    assets.get("universal").and_then(|v| v.as_object())
}

// -----------------------------------------------------------------------------
// SDK → legacy shape adapters
// -----------------------------------------------------------------------------

fn list_item_to_plugin(item: tabularium_sdk::types::ListPluginsResponsePluginsItem) -> RegistryPlugin {
    let homepage = choose_homepage(item.homepage.clone(), item.repo_url.clone());
    let facets = serde_json::to_value(&item).unwrap_or(serde_json::Value::Null);
    let (engine, paradigms, verified) = extract_driver_facets(&facets);
    RegistryPlugin {
        id: item.id,
        name: item.name,
        description: item.description,
        author: item.author,
        homepage,
        latest_version: item.latest_version.unwrap_or_default(),
        releases: Vec::new(),
        icon: item.icon_url,
        repo_url: nonempty(item.repo_url),
        kind: None, // not on list items — fetched via detail
        tags: item.tags,
        category: item.category,
        downloads: Some(item.downloads.max(0.0) as u64),
        registry_base_url: None,
        engine,
        paradigms,
        verified,
    }
}

fn detail_to_plugin(detail: tabularium_sdk::types::GetPluginResponse) -> RegistryPlugin {
    let latest = detail.latest_version.clone().unwrap_or_else(|| {
        detail
            .releases
            .first()
            .map(|r| r.version.clone())
            .unwrap_or_default()
    });

    // `kind` is folded into `tags` by the registry (Tabularium spec) so the
    // SDK doesn't expose a separate field. Recover it as the first tag that
    // matches the registry's kind pattern (`^[a-z0-9][a-z0-9-]*$`) — best
    // effort, falls back to None when the heuristic doesn't match.
    let kind = detail
        .tags
        .iter()
        .find(|t| !t.is_empty() && t.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'))
        .cloned();

    let facets = serde_json::to_value(&detail).unwrap_or(serde_json::Value::Null);
    let (engine, paradigms, verified) = extract_driver_facets(&facets);

    RegistryPlugin {
        id: detail.id,
        name: detail.name,
        description: detail.description,
        author: detail.author,
        homepage: choose_homepage(detail.homepage.clone(), detail.repo_url.clone()),
        latest_version: latest,
        releases: detail.releases.iter().map(release_to_legacy).collect(),
        icon: detail.icon_url,
        repo_url: nonempty(detail.repo_url),
        kind,
        tags: detail.tags,
        category: detail.category,
        downloads: Some(detail.downloads.max(0.0) as u64),
        registry_base_url: None,
        engine,
        paradigms,
        verified,
    }
}

fn nonempty(s: String) -> Option<String> {
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn release_to_legacy(r: &tabularium_sdk::types::GetPluginResponseReleasesItem) -> PluginRelease {
    let mut assets: HashMap<String, String> = HashMap::new();
    for (platform_raw, value) in r.assets.iter() {
        let Some(url) = value.get("url").and_then(|v| v.as_str()) else {
            continue;
        };
        let key = normalise_platform_key(platform_raw);
        assets.entry(key).or_insert_with(|| url.to_string());
    }
    PluginRelease {
        version: r.version.clone(),
        min_tabularis_version: r.min_runtime_version.clone(),
        assets,
    }
}

/// Read the Tabularis driver facets out of a serialized registry plugin:
/// `verified` (top-level) and `engine`/`paradigms` (nested under `extensions`).
/// Works off `serde_json::Value` so it does not depend on the exact generated
/// SDK field types — only that the SDK round-trips these keys.
fn extract_driver_facets(item: &serde_json::Value) -> (Option<String>, Vec<String>, bool) {
    let verified = item.get("verified").and_then(|v| v.as_bool()).unwrap_or(false);
    let ext = item.get("extensions");
    let engine = ext
        .and_then(|e| e.get("engine"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let paradigms = ext
        .and_then(|e| e.get("paradigms"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    (engine, paradigms, verified)
}

/// Picks the first non-empty value between explicit `homepage` and the
/// repo URL — the legacy registry only carries a single homepage field,
/// so we collapse both Tabularium fields into one.
fn choose_homepage(homepage: String, repo: String) -> String {
    if !homepage.is_empty() {
        homepage
    } else {
        repo
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_driver_facets_reads_engine_paradigms_verified() {
        let json = serde_json::json!({
            "verified": true,
            "extensions": { "engine": "firestore", "paradigms": ["document", "vector"] }
        });
        let (engine, paradigms, verified) = extract_driver_facets(&json);
        assert_eq!(engine.as_deref(), Some("firestore"));
        assert_eq!(paradigms, vec!["document".to_string(), "vector".to_string()]);
        assert!(verified);
    }

    #[test]
    fn extract_driver_facets_defaults_when_absent() {
        let json = serde_json::json!({ "name": "x" });
        let (engine, paradigms, verified) = extract_driver_facets(&json);
        assert_eq!(engine, None);
        assert!(paradigms.is_empty());
        assert!(!verified);
    }

    #[test]
    fn normalise_platform_key_handles_aliases() {
        assert_eq!(normalise_platform_key("linux-x64"), "linux-x64");
        assert_eq!(normalise_platform_key("linux-amd64"), "linux-x64");
        assert_eq!(normalise_platform_key("linux-aarch64"), "linux-arm64");
        assert_eq!(normalise_platform_key("darwin-aarch64"), "darwin-arm64");
        assert_eq!(normalise_platform_key("windows-x64"), "win-x64");
        assert_eq!(normalise_platform_key("universal"), "universal");
        assert_eq!(normalise_platform_key("freebsd-x64"), "freebsd-x64");
    }

    #[test]
    fn choose_homepage_prefers_explicit_homepage() {
        assert_eq!(
            choose_homepage("https://home".into(), "https://repo".into()),
            "https://home"
        );
        assert_eq!(
            choose_homepage(String::new(), "https://repo".into()),
            "https://repo"
        );
        assert_eq!(choose_homepage(String::new(), String::new()), "");
    }

    #[test]
    fn builds_tracked_url_from_platform_key() {
        // Platform keys are `{os}-{arch}`; the endpoint wants them split.
        assert_eq!(
            tracked_download_url("https://registry.tabularis.dev", "firestore", "0.2.0", "linux-x64"),
            "https://registry.tabularis.dev/api/plugins/firestore/releases/0.2.0?os=linux&arch=x64&redirect=1"
        );
        assert_eq!(
            tracked_download_url("https://registry.tabularis.dev/", "duckdb", "1.0.0", "darwin-arm64"),
            "https://registry.tabularis.dev/api/plugins/duckdb/releases/1.0.0?os=darwin&arch=arm64&redirect=1"
        );
    }

    #[test]
    fn builds_tracked_latest_url() {
        assert_eq!(
            tracked_latest_download_url("https://registry.tabularis.dev/", "firestore", "linux-x64"),
            "https://registry.tabularis.dev/api/plugins/firestore/latest?os=linux&arch=x64&redirect=1"
        );
    }

    #[test]
    fn tracked_url_handles_platform_without_dash() {
        // Defensive: an unsplittable platform still produces a usable URL.
        assert_eq!(
            tracked_download_url("https://r.example", "x", "1.0.0", "universal"),
            "https://r.example/api/plugins/x/releases/1.0.0?os=universal&arch=&redirect=1"
        );
    }
}
