//! Custom URI scheme `tabularis-plugin://` for sandboxed plugin frames.
//! Design note section 8.2 — protocol handler + confined file reader.

use std::fs;
use std::path::{Component, Path};

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Runtime};

const GUEST_CSP: &str = "sandbox allow-scripts; default-src 'none'; script-src 'self'; \
  style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src data:; \
  connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

static GUEST_HTML: &[u8] = include_bytes!("../../resources/guest/__guest__.html");
static GUEST_RUNTIME_JS: &[u8] = include_bytes!("../../resources/guest/runtime.js");
static HOST_CSS: &[u8] = include_bytes!("../../resources/guest/host.css");

fn is_safe_plugin_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn mime_for(path: &str) -> &'static str {
    if path.ends_with(".js") {
        "application/javascript; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".json") {
        "application/json; charset=utf-8"
    } else if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else {
        "application/octet-stream"
    }
}

fn plain(status: StatusCode, msg: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CONTENT_SECURITY_POLICY, GUEST_CSP)
        .body(msg.as_bytes().to_vec())
        .unwrap()
}

/// Path-safe read shared by the protocol handler and `read_plugin_file`.
pub fn read_plugin_file_confined(plugin_id: &str, rel: &str) -> Result<Vec<u8>, String> {
    if rel.is_empty() || rel.contains('\0') {
        return Err("Invalid file path".into());
    }
    if Path::new(rel).components().any(|c| {
        matches!(
            c,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err("Invalid file path: must be relative and contain no '..' components".into());
    }

    let plugin_dir = crate::plugins::installer::resolve_plugin_dir(plugin_id)?;
    let plugin_root = plugin_dir
        .canonicalize()
        .map_err(|e| format!("Plugin dir not found for '{plugin_id}': {e}"))?;

    let full = plugin_root.join(rel);
    let canonical = full
        .canonicalize()
        .map_err(|e| format!("Failed to resolve '{rel}' in plugin '{plugin_id}': {e}"))?;

    if !canonical.starts_with(&plugin_root) {
        return Err("Path escapes plugin directory".into());
    }

    fs::read(&canonical)
        .map_err(|e| format!("Failed to read '{rel}' from plugin '{plugin_id}': {e}"))
}

pub fn handle<R: Runtime>(_app: &AppHandle<R>, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let path = req.uri().path().trim_start_matches('/');
    let mut parts = path.splitn(2, '/');
    let plugin_id = parts.next().unwrap_or("");
    let rel = parts.next().unwrap_or("__guest__.html");

    if !is_safe_plugin_id(plugin_id) {
        return plain(StatusCode::BAD_REQUEST, "invalid plugin id");
    }

    if crate::plugins::installer::resolve_plugin_dir(plugin_id).is_err() {
        return plain(StatusCode::NOT_FOUND, "plugin not installed");
    }

    let (body, content_type) = match rel {
        "__guest__.html" => (GUEST_HTML.to_vec(), "text/html; charset=utf-8"),
        "__runtime__.js" => (
            GUEST_RUNTIME_JS.to_vec(),
            "application/javascript; charset=utf-8",
        ),
        "__host.css__" => (HOST_CSS.to_vec(), "text/css; charset=utf-8"),
        other => match read_plugin_file_confined(plugin_id, other) {
            Ok(bytes) => (bytes, mime_for(other)),
            Err(_) => return plain(StatusCode::NOT_FOUND, "not found"),
        },
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_SECURITY_POLICY, GUEST_CSP)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .unwrap_or_else(|_| plain(StatusCode::INTERNAL_SERVER_ERROR, "response build failed"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_parent_dir() {
        let err = read_plugin_file_confined("any", "../etc/passwd").unwrap_err();
        assert!(err.contains("Invalid file path"));
    }

    #[test]
    fn rejects_absolute() {
        let err = read_plugin_file_confined("any", "/etc/passwd").unwrap_err();
        assert!(err.contains("Invalid file path"));
    }
}
