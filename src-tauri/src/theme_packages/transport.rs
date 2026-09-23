//! Shared registry installation orchestration, exercised against loopback assets.
use super::{
    catalog, install_validated_theme, lifecycle, registry_key, validate_runtime_version,
    validate_theme_archive, ThemeCommit,
};
use crate::plugins::{install_cancellation, tabularium};
use sha2::{Digest, Sha256};
use std::path::Path;

pub(super) async fn install_registry_package(
    root: &Path,
    base: &str,
    expected_registry_key: &str,
    package_name: &str,
    version: Option<&str>,
    host_version: &str,
) -> Result<ThemeCommit, String> {
    lifecycle::validate_package_name(package_name)?;
    let key = registry_key(base)?;
    if key != expected_registry_key {
        return Err(
            "Configured theme registry changed; refresh discovery before installing".into(),
        );
    }
    let guard = install_cancellation::begin(&format!("theme:{key}:{package_name}"))?;
    let cancel = guard.cancellation();
    let detail = tokio::select! {
        _ = cancel.cancelled() => return Err(install_cancellation::INSTALL_CANCELLED_ERROR.into()),
        result = tabularium::fetch_plugin_detail(base, package_name) => result?,
    };
    if detail.kind.as_deref() != Some("theme") || detail.id != package_name {
        return Err("Registry entry is not the requested declarative theme package".into());
    }
    let target = version.unwrap_or(&detail.latest_version);
    let release = detail
        .releases
        .iter()
        .find(|release| release.version == target)
        .ok_or("Theme release not found")?;
    if release.assets.len() != 1 || !release.assets.contains_key("universal") {
        return Err("Themes require exactly one universal release asset".into());
    }
    semver::Version::parse(target).map_err(|e| e.to_string())?;
    if let Some(floor) = &release.min_tabularis_version {
        validate_runtime_version(
            &serde_json::json!({"min_runtime_version":floor}),
            host_version,
        )?;
    }
    let asset = tokio::select! {
        _ = cancel.cancelled() => return Err(install_cancellation::INSTALL_CANCELLED_ERROR.into()),
        result = tabularium::resolve_asset(base, package_name, target, "universal") => result?,
    };
    let expected = asset
        .expected_sha256
        .ok_or("Theme release has no integrity hash")?;
    let download = if version.is_some() {
        tabularium::tracked_download_url(base, package_name, target, "universal")
    } else {
        tabularium::tracked_latest_download_url(base, package_name, "universal")
    };
    let client = crate::proxy::app_http_client()?;
    let mut response = tokio::select! {
        _ = cancel.cancelled() => return Err(install_cancellation::INSTALL_CANCELLED_ERROR.into()),
        result = client.get(download).send() => result.map_err(|e|e.to_string())?.error_for_status().map_err(|e|e.to_string())?,
    };
    if response
        .content_length()
        .is_some_and(|size| size > lifecycle::ARCHIVE_BYTES as u64)
    {
        return Err("Theme archive exceeds download byte limit".into());
    }
    let mut bytes = Vec::new();
    loop {
        let chunk = tokio::select! {
            _ = cancel.cancelled() => return Err(install_cancellation::INSTALL_CANCELLED_ERROR.into()),
            result = response.chunk() => result.map_err(|e|e.to_string())?,
        };
        let Some(chunk) = chunk else {
            break;
        };
        if bytes.len() + chunk.len() > lifecycle::ARCHIVE_BYTES {
            return Err("Theme archive exceeds download byte limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if !format!("{:x}", Sha256::digest(&bytes)).eq_ignore_ascii_case(&expected) {
        return Err("Theme release integrity mismatch".into());
    }
    let cancellation = cancel.clone();
    let root = root.to_path_buf();
    let target = target.to_string();
    let package_name = package_name.to_string();
    let host_version = host_version.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let package =
            validate_theme_archive(&bytes, &package_name, &target, &host_version, &|| {
                cancellation.check()
            })?;
        install_validated_theme(&root.join(catalog::PACKAGES_DIR), &key, &package, &|| {
            cancellation.check()
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
