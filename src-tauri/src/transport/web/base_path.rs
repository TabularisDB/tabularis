//! Trusted startup public path. The reverse proxy strips it from upstream requests.
use axum::{
    body::{to_bytes, Body},
    extract::{Request, State},
    http::{header, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::{path::Path, sync::Arc};

#[derive(Clone, Debug)]
pub struct PublicBasePath(Arc<str>);

impl Default for PublicBasePath {
    fn default() -> Self {
        Self(Arc::from("/"))
    }
}

impl PublicBasePath {
    pub fn parse(value: &str) -> Result<Self, String> {
        if value == "/" {
            return Ok(Self::default());
        }
        if !value.starts_with('/') || value.starts_with("//") || value.len() > 1024 {
            return Err("--base-path must be a local absolute path".into());
        }
        let path = value.strip_suffix('/').unwrap_or(value);
        if path[1..].split('/').any(|segment| {
            segment.is_empty()
                || segment == "."
                || segment == ".."
                || !segment
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'~' | b'.'))
        }) {
            return Err("--base-path contains an unsafe or non-normalized segment".into());
        }
        Ok(Self(Arc::from(format!("{path}/"))))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
    pub fn public_path(&self, path: &str) -> String {
        format!("{}{}", self.0, path.trim_start_matches('/'))
    }

    pub fn for_build(root: &Path, requested: Option<&str>) -> Result<Self, String> {
        let html = std::fs::read_to_string(root.join("index.html"))
            .map_err(|_| "Cannot read Web index.html")?;
        let marker = "name=\"tabularis-build-base\" content=\"";
        let built = html
            .split_once(marker)
            .and_then(|(_, rest)| rest.split_once('"'))
            .map(|(base, _)| base);
        let build_base = built.map(Self::parse).transpose()?.unwrap_or_default();
        let runtime = requested
            .map(Self::parse)
            .transpose()?
            .unwrap_or_else(|| build_base.clone());
        if requested.is_some() && built.is_none() && runtime.as_str() != "/" {
            return Err(
                "Runtime --base-path requires a frontend built with runtime path support".into(),
            );
        }
        if build_base.as_str() != "/" && build_base.as_str() != runtime.as_str() {
            return Err("--base-path conflicts with the frontend TABULARIS_BASE_PATH".into());
        }
        Ok(runtime)
    }
}

pub async fn adapt_response(
    State(base): State<PublicBasePath>,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path().to_owned();
    let is_login = matches!(path.as_str(), "/login" | "/api/v1/auth/login");
    let shell_candidate = !path.starts_with("/api/") && path != "/healthz";
    let mut response = next.run(request).await;
    if let Some(location) = response
        .headers()
        .get(header::LOCATION)
        .and_then(|h| h.to_str().ok())
    {
        if location.starts_with('/') && !location.starts_with("//") {
            if let Ok(value) = HeaderValue::from_str(&base.public_path(location)) {
                response.headers_mut().insert(header::LOCATION, value);
            }
        }
    }
    if let Some(cookie) = response
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|h| h.to_str().ok())
    {
        if let Ok(value) =
            HeaderValue::from_str(&cookie.replace("Path=/;", &format!("Path={};", base.as_str())))
        {
            response.headers_mut().insert(header::SET_COOKIE, value);
        }
    }
    let html = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|h| h.to_str().ok())
        .is_some_and(|h| h.starts_with("text/html"));
    if !html || (!is_login && !shell_candidate) {
        return response;
    }
    let (mut parts, body) = response.into_parts();
    let Ok(bytes) = to_bytes(body, 4 * 1024 * 1024).await else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let Ok(mut html) = String::from_utf8(bytes.to_vec()) else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    if is_login {
        html = html.replace(
            "action=\"/api/v1/auth/login\"",
            &format!("action=\"{}\"", base.public_path("api/v1/auth/login")),
        );
    } else if html.contains("name=\"tabularis-build-base\"") {
        html = html.replacen(
            "<head>",
            &format!(
                "<head><base href=\"{}\"><meta name=\"tabularis-public-base\" content=\"{}\">",
                base.as_str(),
                base.as_str()
            ),
            1,
        );
    }
    parts.headers.remove(header::CONTENT_LENGTH);
    parts.headers.remove(header::ETAG);
    parts.headers.remove(header::LAST_MODIFIED);
    parts
        .headers
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Response::from_parts(parts, Body::from(html))
}

#[cfg(test)]
#[path = "base_path_tests.rs"]
mod tests;
