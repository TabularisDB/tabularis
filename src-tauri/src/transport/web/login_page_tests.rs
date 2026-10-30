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
