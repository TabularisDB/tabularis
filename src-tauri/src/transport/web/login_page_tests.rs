use super::auth::AuthenticationError;
use super::login_page::{login_page_csp, render_login_page};
use super::server::authentication_error_response;
use axum::http::header::{CONTENT_SECURITY_POLICY, RETRY_AFTER};
use axum::http::StatusCode;
use base64::Engine;
use sha2::{Digest, Sha256};

const ACTION: &str = "/api/v1/auth/login";
const TARGET: &str = "/connections/abc/editor";

fn inline_style(page: &str) -> &str {
    let start = page.find("<style>").expect("inline stylesheet") + "<style>".len();
    let end = page[start..].find("</style>").expect("closed stylesheet") + start;
    &page[start..end]
}

async fn body_text(response: axum::response::Response) -> String {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    String::from_utf8(bytes.to_vec()).unwrap()
}

#[test]
fn renders_a_labelled_password_form_without_app_assets() {
    let page = render_login_page(ACTION, None, Some(TARGET));

    assert!(page.contains("<form method=\"post\" action=\"/api/v1/auth/login\">"));
    assert!(page.contains("<label for=\"password\">Password</label>"));
    assert!(page.contains("id=\"password\" type=\"password\" name=\"password\" required"));
    assert!(page.contains("autocomplete=\"current-password\""));
    assert!(page.contains("<button type=\"submit\">Sign in</button>"));
    assert!(
        page.contains("<input type=\"hidden\" name=\"next\" value=\"/connections/abc/editor\">")
    );
    // Nothing is fetched: no script, stylesheet link, image or font.
    for external in ["<script", "<link", "<img", "src=", "@import", "url(http"] {
        assert!(!page.contains(external), "{external}");
    }
    // Without an error there is no alert and the field is not marked invalid.
    assert!(!page.contains("role=\"alert\""));
    assert!(!page.contains("aria-invalid"));
}

#[test]
fn styles_follow_the_system_light_and_dark_appearance() {
    let page = render_login_page(ACTION, None, None);
    let style = inline_style(&page);

    assert!(page.contains("<meta name=\"color-scheme\" content=\"light dark\">"));
    assert!(style.contains("@media (prefers-color-scheme: dark)"));
    assert!(style.contains("--bg-base:"));
    assert!(style.contains("button:focus-visible"));
    assert!(style.contains("@media (max-width: 480px)"));
}

#[test]
fn csp_allows_only_the_page_stylesheet() {
    let page = render_login_page(ACTION, None, None);
    let hash = base64::engine::general_purpose::STANDARD
        .encode(Sha256::digest(inline_style(&page).as_bytes()));

    assert_eq!(
        login_page_csp(),
        format!(
            "default-src 'none'; style-src 'sha256-{hash}'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
        )
    );
}

#[tokio::test]
async fn authentication_errors_render_on_the_same_page() {
    for (error, status, message) in [
        (
            AuthenticationError::InvalidCredentials,
            StatusCode::UNAUTHORIZED,
            "Invalid credentials",
        ),
        (
            AuthenticationError::RateLimited,
            StatusCode::TOO_MANY_REQUESTS,
            "Too many attempts",
        ),
        (
            AuthenticationError::SessionLimitReached,
            StatusCode::SERVICE_UNAVAILABLE,
            "The server has reached its session limit. Try again later.",
        ),
    ] {
        let response = authentication_error_response(error, true, Some(TARGET));
        assert_eq!(response.status(), status, "{message}");
        assert_eq!(
            response.headers().get(CONTENT_SECURITY_POLICY).unwrap(),
            login_page_csp()
        );
        if status == StatusCode::TOO_MANY_REQUESTS {
            assert_eq!(response.headers().get(RETRY_AFTER).unwrap(), "300");
        }
        let page = body_text(response).await;
        assert!(
            page.contains(&format!(
                "<p id=\"login-error\" class=\"error\" role=\"alert\">{message}</p>"
            )),
            "{message}"
        );
        assert!(page.contains("aria-invalid=\"true\" aria-describedby=\"login-error\""));
        assert!(
            page.contains("value=\"/connections/abc/editor\""),
            "{message}"
        );
        assert!(page.contains("<label for=\"password\">Password</label>"));
    }
}

const BUILTIN_THEMES: &str =
    include_str!("../../../../packages/web-ui/src/themes/builtin-themes.json");

fn custom_properties(block: &str) -> Vec<(&str, &str)> {
    block
        .split(';')
        .filter_map(|declaration| declaration.trim().strip_prefix("--"))
        .map(|declaration| {
            let (name, value) = declaration.split_once(':').expect("name: value");
            (name.trim(), value.trim())
        })
        .collect()
}

fn root_block(css: &str) -> &str {
    let start = css.find(":root {").expect(":root block") + ":root {".len();
    let end = css[start..].find('}').expect("closed :root block") + start;
    &css[start..end]
}

fn theme_token<'a>(theme: &'a serde_json::Value, property: &str) -> &'a str {
    let (group, key) = property.split_once('-').expect("group-key");
    let path = match group {
        "bg" | "text" | "accent" | "border" => format!("/colors/{group}/{key}"),
        "font" => format!("/typography/fontFamily/{key}"),
        "radius" => format!("/layout/borderRadius/{key}"),
        _ => panic!("--{property} has no theme token mapping"),
    };
    theme
        .pointer(&path)
        .and_then(serde_json::Value::as_str)
        .unwrap_or_else(|| panic!("--{property}: {path} missing from the theme"))
}

#[test]
fn copied_tokens_match_the_builtin_tabularis_themes() {
    let themes: Vec<serde_json::Value> = serde_json::from_str(BUILTIN_THEMES).unwrap();
    let theme = |id: &str| {
        themes
            .iter()
            .find(|theme| theme["id"] == id)
            .unwrap_or_else(|| panic!("{id} in builtin-themes.json"))
    };
    let css = include_str!("login_page.css");
    let dark_query = css
        .find("@media (prefers-color-scheme: dark)")
        .expect("dark media query");

    for (block, theme) in [
        (root_block(css), theme("tabularis-light")),
        (root_block(&css[dark_query..]), theme("tabularis-dark")),
    ] {
        let properties = custom_properties(block);
        assert!(!properties.is_empty());
        for (property, value) in properties {
            assert_eq!(
                value,
                theme_token(theme, property),
                "--{property} in login_page.css drifted from {}",
                theme["id"]
            );
        }
    }
}
