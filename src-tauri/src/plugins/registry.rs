use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::plugins::tabularium;

/// Built-in Tabularium registry used when the user has not pinned one
/// in `config.json`. Operators can override via `tabularium_registry_url`.
pub const DEFAULT_TABULARIUM_URL: &str = "https://registry.tabularis.dev";

/// Resolved action for a deeplink/install decision, derived from the installed
/// version vs the target version.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InstallAction {
    /// Not installed — offer install.
    Install,
    /// Installed, older than target — offer update.
    Update,
    /// Installed at >= target (incl. equal and downgrade links) — no action.
    UpToDate,
}

/// Release-integrity signature state, surfaced to the install UI so the user
/// sees whether the release they're about to install is cryptographically
/// verified. Distinct from the admin-moderation `verified` flag.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SignatureStatus {
    /// JWS present, signature + release-identity guards verified.
    Verified,
    /// Legacy release with no JWS — hash is registry-supplied, not signed.
    Unsigned,
    /// JWS present but verification or an identity guard FAILED — do not trust.
    Invalid,
    /// Couldn't reach the integrity endpoint to decide.
    Unknown,
}

/// SemVer-aware classification. The registry requires semver-formatted
/// versions; if either side fails to parse we degrade to string comparison
/// (equal => up-to-date, else => update) and log, rather than crash callers.
pub fn classify_install(installed: Option<&str>, target: &str) -> InstallAction {
    let Some(installed) = installed else {
        return InstallAction::Install;
    };
    match (semver::Version::parse(installed), semver::Version::parse(target)) {
        (Ok(cur), Ok(tgt)) => {
            if cur < tgt {
                InstallAction::Update
            } else {
                InstallAction::UpToDate
            }
        }
        _ => {
            log::warn!(
                "Non-semver version compare (installed={:?}, target={:?}); string fallback",
                installed, target
            );
            if installed == target {
                InstallAction::UpToDate
            } else {
                InstallAction::Update
            }
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PluginRegistry {
    pub schema_version: u32,
    pub plugins: Vec<RegistryPlugin>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct RegistryPlugin {
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub homepage: String,
    pub latest_version: String,
    pub releases: Vec<PluginRelease>,
    // -- Richer Tabularium-only fields. All optional so the legacy flat
    //    GitHub registry deserializes unchanged (Serde defaults to None /
    //    empty Vec for absent fields).
    /// URL of the plugin's square logo, when the manifest declares one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// Repository URL — surfaced separately from `homepage` because the
    /// Tabularium API distinguishes them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_url: Option<String>,
    /// Admin-defined kind from `/api/kinds` (e.g. `driver`, `theme`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// Tags / categories the author declared on the manifest.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Optional category from the registry's facets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    /// Aggregate download count, when the registry tracks it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub downloads: Option<u64>,
    /// Base URL of the registry that served this plugin — set by the
    /// preview / catalogue commands so the frontend can link card titles
    /// to the registry's detail page (`<base>/plugins/<id>`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub registry_base_url: Option<String>,
    /// Concrete database the driver connects to (manifest `extensions.engine`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
    /// Data-model families (manifest `extensions.paradigms`), primary first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paradigms: Vec<String>,
    /// Registry-assigned verification flag (top-level `verified`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub verified: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PluginRelease {
    pub version: String,
    pub min_tabularis_version: Option<String>,
    pub assets: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RegistryReleaseWithStatus {
    pub version: String,
    pub min_tabularis_version: Option<String>,
    pub platform_supported: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RegistryPluginWithStatus {
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub homepage: String,
    pub latest_version: String,
    pub releases: Vec<RegistryReleaseWithStatus>,
    pub installed_version: Option<String>,
    pub update_available: bool,
    pub platform_supported: bool,
    // -- Richer Tabularium-only fields, surfaced verbatim to the frontend.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub downloads: Option<u64>,
    /// Base URL of the registry that served this plugin. Lets the frontend
    /// link the card title to the registry's detail page (`<base>/plugins/<id>`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub registry_base_url: Option<String>,
    /// Concrete database the driver connects to (manifest `extensions.engine`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
    /// Data-model families (manifest `extensions.paradigms`), primary first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paradigms: Vec<String>,
    /// Registry-assigned verification flag (top-level `verified`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub verified: bool,
    /// Deeplink-only: resolved action (install / update / up_to_date) for the
    /// confirmation modal. `None` outside the deeplink preview path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install_action: Option<InstallAction>,
    /// Release-integrity signature state for the target version. Set by the
    /// preview path so the modal can badge verified / unsigned; `None` on the
    /// plain catalogue path where we don't probe per-release integrity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<SignatureStatus>,
}

pub fn get_current_platform() -> String {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    match (os, arch) {
        ("linux", "x86_64") => "linux-x64".to_string(),
        ("linux", "aarch64") => "linux-arm64".to_string(),
        ("macos", "aarch64") => "darwin-arm64".to_string(),
        ("macos", "x86_64") => "darwin-x64".to_string(),
        ("windows", "x86_64") => "win-x64".to_string(),
        _ => format!("{}-{}", os, arch),
    }
}

/// Fetch a Tabularium-flavoured registry and adapt it to the legacy
/// `PluginRegistry` shape. The plugin list endpoint omits per-release detail,
/// so for each plugin we follow up with `GET /api/plugins/{slug}` to get the
/// full release list — the rest of the install pipeline (frontend cards,
/// version picker, asset resolution) needs `releases[].assets` populated.
pub async fn fetch_tabularium_registry(base_url: &str) -> Result<PluginRegistry, String> {
    let list = tabularium::fetch_plugin_list(base_url).await?;

    // Fetch every plugin's detail concurrently instead of N sequential
    // round-trips, but cap in-flight requests so a large registry can't fire
    // hundreds of simultaneous GETs. `buffered` (not `buffer_unordered`)
    // preserves the list-endpoint order, which surfaces directly to the
    // frontend cards. A failed detail call degrades to the list item (entry
    // visible but not installable — matches "platform unsupported" UX).
    use futures::stream::{self, StreamExt};
    let plugins: Vec<RegistryPlugin> = stream::iter(list)
        .map(|item| async move {
            let slug = item.id.clone();
            match tabularium::fetch_plugin_detail(base_url, &slug).await {
                Ok(detail) => detail,
                Err(err) => {
                    log::warn!(
                        "Tabularium detail fetch failed for {}: {} — falling back to list item",
                        slug,
                        err
                    );
                    item
                }
            }
        })
        .buffered(8)
        .collect::<Vec<_>>()
        .await;

    Ok(PluginRegistry {
        schema_version: 1,
        plugins,
    })
}

/// Thin wrapper so callers don't have to import the SDK adapter type.
pub use crate::plugins::tabularium::AssetResolution as TabulariumAssetResolution;

pub async fn resolve_tabularium_asset(
    base_url: &str,
    slug: &str,
    version: &str,
    platform: &str,
) -> Result<TabulariumAssetResolution, String> {
    tabularium::resolve_asset(base_url, slug, version, platform).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_not_installed_is_install() {
        assert_eq!(classify_install(None, "1.2.3"), InstallAction::Install);
    }

    #[test]
    fn classify_older_installed_is_update() {
        assert_eq!(classify_install(Some("1.0.0"), "1.2.3"), InstallAction::Update);
        assert_eq!(classify_install(Some("0.9.0"), "0.10.0"), InstallAction::Update);
    }

    #[test]
    fn classify_equal_is_up_to_date() {
        assert_eq!(classify_install(Some("1.2.3"), "1.2.3"), InstallAction::UpToDate);
    }

    #[test]
    fn classify_newer_installed_is_up_to_date() {
        // Downgrade link: never auto-downgrade.
        assert_eq!(classify_install(Some("2.0.0"), "1.2.3"), InstallAction::UpToDate);
    }

    #[test]
    fn classify_unparseable_falls_back_to_string_compare() {
        assert_eq!(classify_install(Some("weird"), "weird"), InstallAction::UpToDate);
        assert_eq!(classify_install(Some("weird"), "other"), InstallAction::Update);
    }
}
