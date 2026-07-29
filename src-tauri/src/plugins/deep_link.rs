//! `tabularis://` deep-link handling.
//!
//! When a Tabularium registry renders an "Open in App" button (see its
//! `GET /api/instance/info` `appUrlSchemes` payload), the registry mints a
//! URL of the form:
//!
//! ```text
//! tabularis://install/<slug>?version=<v>&registry=<base_url>
//! ```
//!
//! * `<slug>`     — required path segment, the plugin id on the registry.
//! * `version`    — optional, pins a release; absent ⇒ latest.
//! * `registry`   — optional, full base URL of the registry that minted
//!                  the link. Lets a user installed against registry A
//!                  follow a link from registry B; the frontend should
//!                  prompt before switching the configured registry.
//!
//! The Tauri layer parses incoming URLs into a [`PluginInstallRequest`]
//! and emits it on the `tabularis://plugin-install` event so the React
//! frontend can show the install confirmation modal. Anything else (an
//! unknown action, a malformed slug) is logged and dropped — we never
//! auto-install without a user click.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use url::Url;

/// Tauri-managed state holding the most recent install request that has not
/// yet been picked up by the frontend. Buffered separately from the emitted
/// event so we don't drop URLs that arrive before the React listener mounts
/// (typical for cold-start launches).
#[derive(Default)]
pub struct PendingInstall(pub Mutex<Option<PluginInstallRequest>>);

/// Event name the frontend listens on. Kept stable as part of the
/// public contract with the Tabularium registry.
pub const PLUGIN_INSTALL_EVENT: &str = "tabularis://plugin-install";

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallRequest {
    /// Plugin slug on the registry (matches the manifest `id`).
    pub slug: String,
    /// Optional pinned version. `None` ⇒ install latest.
    pub version: Option<String>,
    /// Optional source registry. `None` ⇒ use whichever registry the
    /// user currently has configured.
    pub registry: Option<String>,
}

/// Parses a `tabularis://...` URL into a typed install request.
/// Returns `None` for URLs we don't (yet) handle so callers can ignore
/// them quietly.
///
/// Accepted forms (Tabularium currently emits the query-based one):
///   * `tabularis://install?slug=<slug>&version=<v>&registry=<base>`
///   * `tabularis://install/<slug>?version=<v>&registry=<base>`
///   * `tabularis:install/<slug>` (some launchers strip the `//`)
pub fn parse_install_url(raw: &str) -> Option<PluginInstallRequest> {
    let url = Url::parse(raw).ok()?;
    if url.scheme() != "tabularis" {
        return None;
    }

    // Action = host if present (`tabularis://install...`), otherwise the
    // first path segment (`tabularis:install/...`).
    let host = url.host_str();
    let action_from_path = || {
        url.path()
            .trim_start_matches('/')
            .split('/')
            .next()
            .unwrap_or("")
            .to_string()
    };
    let action = host.map(str::to_string).unwrap_or_else(action_from_path);
    if action != "install" {
        log::debug!("Ignoring tabularis:// URL with unknown action: {}", raw);
        return None;
    }

    // Collect query first — Tabularium's "Open in App" link puts slug there.
    let mut version = None;
    let mut registry = None;
    let mut query_slug: Option<String> = None;
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "slug" => query_slug = Some(v.into_owned()),
            "version" => version = Some(v.into_owned()),
            "registry" => registry = Some(v.into_owned()),
            _ => {}
        }
    }

    // Fall back to path segments after the action if no `?slug=` was given.
    // For the `//` forms the URL is a base and `path_segments()` works; for the
    // no-`//` form (`tabularis:install/<slug>`) the URL is cannot-be-a-base,
    // so `path_segments()` returns `None` and we split `path()` by hand.
    let slug = query_slug.or_else(|| {
        let mut segments: Vec<&str> = match url.path_segments() {
            Some(s) => s.collect(),
            None => url.path().trim_start_matches('/').split('/').collect(),
        };
        if host.is_none() && segments.first().copied() == Some("install") {
            segments.remove(0);
        }
        segments
            .into_iter()
            .find(|s| !s.is_empty())
            .map(|s| s.to_string())
    })?;
    if !is_valid_slug(&slug) {
        log::warn!("Rejected tabularis:// URL — bad slug: {:?}", slug);
        return None;
    }

    Some(PluginInstallRequest {
        slug,
        version,
        registry,
    })
}

/// Slug must match Tabularium's own pattern (`^[a-z0-9][a-z0-9-]*$`,
/// length 1–64). Stops path-traversal-ish input from reaching the installer
/// without forcing assumptions about the registry's host (self-hosting must
/// keep working without an allowlist).
fn is_valid_slug(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.is_empty() || bytes.len() > 64 {
        return false;
    }
    let valid_char = |b: &u8| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-';
    bytes.iter().all(valid_char) && bytes.first().is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

/// Dispatch a single URL to the frontend. Called from:
///   * the deep-link plugin's `on_open_url` handler (warm handoff),
///   * the cold-start `get_current()` path on app boot,
///   * the `single_instance` callback when a second launch forwards args.
///
/// We both **emit** an event (so an already-mounted listener reacts
/// immediately) AND **stash** the request in `PendingInstall` so a fresh
/// React subscription can drain it on mount. Without the stash a cold-start
/// URL is delivered before the webview's event listener exists and silently
/// dropped.
pub fn handle_url(app: &AppHandle, raw: &str) {
    let Some(req) = parse_install_url(raw) else {
        log::info!("Ignoring tabularis:// URL: {}", raw);
        return;
    };

    // Stash for cold-start replay; the frontend pulls this on mount via
    // `consume_pending_deep_link_install`.
    if let Some(state) = app.try_state::<PendingInstall>() {
        if let Ok(mut slot) = state.0.lock() {
            *slot = Some(req.clone());
        }
    }

    if let Err(err) = app.emit(PLUGIN_INSTALL_EVENT, &req) {
        log::error!(
            "Failed to emit {}: {} (request: {:?})",
            PLUGIN_INSTALL_EVENT,
            err,
            req
        );
    } else {
        log::info!("Emitted {} for slug '{}'", PLUGIN_INSTALL_EVENT, req.slug);
    }

    // Focus the main window so the user sees the confirmation modal —
    // a second launch may otherwise leave Tabularis in the background.
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Drains the pending deep-link install request, if any. Called from the
/// frontend immediately after the listener mounts to recover URLs that
/// arrived during cold-start before the event subscription existed.
#[tauri::command]
pub fn consume_pending_deep_link_install(
    state: tauri::State<'_, PendingInstall>,
) -> Option<PluginInstallRequest> {
    state.0.lock().ok().and_then(|mut slot| slot.take())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_canonical_install_url() {
        let req =
            parse_install_url("tabularis://install/duckdb?version=0.2.0&registry=https%3A%2F%2Fr.example")
                .expect("valid URL");
        assert_eq!(req.slug, "duckdb");
        assert_eq!(req.version.as_deref(), Some("0.2.0"));
        assert_eq!(req.registry.as_deref(), Some("https://r.example"));
    }

    #[test]
    fn parses_query_based_install_url() {
        // Format emitted by the Tabularium frontend's "Open in App" button.
        let req = parse_install_url(
            "tabularis://install?registry=https%3A%2F%2Fregistry.spitzli.dev&slug=firestore-tabularis&version=0.2.0",
        )
        .expect("valid URL");
        assert_eq!(req.slug, "firestore-tabularis");
        assert_eq!(req.version.as_deref(), Some("0.2.0"));
        assert_eq!(req.registry.as_deref(), Some("https://registry.spitzli.dev"));
    }

    #[test]
    fn parses_minimal_install_url() {
        let req = parse_install_url("tabularis://install/csv").expect("valid URL");
        assert_eq!(req.slug, "csv");
        assert!(req.version.is_none());
        assert!(req.registry.is_none());
    }

    #[test]
    fn rejects_other_schemes() {
        assert!(parse_install_url("https://example.com").is_none());
        assert!(parse_install_url("tabularium://install/foo").is_none());
    }

    #[test]
    fn rejects_unknown_actions() {
        assert!(parse_install_url("tabularis://browse/foo").is_none());
    }

    #[test]
    fn rejects_missing_slug() {
        assert!(parse_install_url("tabularis://install/").is_none());
        assert!(parse_install_url("tabularis://install").is_none());
    }

    #[test]
    fn parses_no_double_slash_form() {
        // Some launchers strip the `//`, leaving a cannot-be-a-base URL.
        let req = parse_install_url("tabularis:install/duckdb").expect("valid URL");
        assert_eq!(req.slug, "duckdb");
        assert!(req.version.is_none());

        let req = parse_install_url("tabularis:install/duckdb?version=1.2.3").expect("valid URL");
        assert_eq!(req.slug, "duckdb");
        assert_eq!(req.version.as_deref(), Some("1.2.3"));
    }

    #[test]
    fn rejects_bad_slug_in_no_double_slash_form() {
        assert!(parse_install_url("tabularis:install/../etc").is_none());
    }
}
