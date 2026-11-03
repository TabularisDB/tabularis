//! The password sign-in page. It is rendered by the server, not the SPA, so it
//! works before the app bundle loads and needs no script.

use super::login_target::LOGIN_TARGET_PARAM;
use base64::Engine;
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

const LOGIN_PAGE_STYLE: &str = include_str!("login_page.css");

/// The Tabularis mark from `packages/web-ui/public/logo.svg`, inlined because
/// signed-out requests cannot load app assets.
const LOGO_SVG: &str = r##"<svg class="logo" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M499.561 756.104V915.577L337.96 815.641V671.051L499.561 756.104ZM686.677 832.65L525.077 915.577V756.104L686.677 675.304V832.65ZM499.561 728.462L354.971 649.788L499.561 577.493V728.462ZM686.677 645.535L525.077 726.335V568.987L686.677 488.188V645.535ZM318.831 469.051V630.65L159.357 543.472V383.998L318.831 469.051ZM499.561 551.977L342.213 628.524V471.177L499.561 392.503V551.977ZM684.552 458.419L525.079 537.093V381.871L684.552 303.197V458.419ZM484.675 371.24L331.58 447.787L178.485 364.86L331.58 288.313L484.675 371.24ZM865.288 369.113L705.814 445.661V294.692L865.288 213.893V369.113ZM663.286 284.061L512.317 360.608L357.097 275.556L508.064 199.008L663.286 284.061ZM844.028 192.629L693.06 271.303L537.839 186.25L690.934 107.576L844.028 192.629Z" fill="url(#logo-gradient)"/><defs><linearGradient id="logo-gradient" x1="803.953" y1="104.792" x2="159.356" y2="968.425" gradientUnits="userSpaceOnUse"><stop offset="0.264434" stop-color="#376AEC"/><stop offset="0.802885" stop-color="#3EE3CE"/></linearGradient></defs></svg>"##;

const ERROR_ID: &str = "login-error";

/// Content-Security-Policy for the page: nothing loads, and only the page's own
/// stylesheet, pinned by hash, may apply.
pub(super) fn login_page_csp() -> &'static str {
    static CSP: OnceLock<String> = OnceLock::new();
    CSP.get_or_init(|| {
        let hash = base64::engine::general_purpose::STANDARD
            .encode(Sha256::digest(LOGIN_PAGE_STYLE.as_bytes()));
        format!(
            "default-src 'none'; style-src 'sha256-{hash}'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
        )
    })
}

/// `error` is a fixed server message and `target` must come from
/// `login_return_target`, whose character set needs no HTML escaping.
pub(super) fn render_login_page(action: &str, error: Option<&str>, target: Option<&str>) -> String {
    let (error, described) = match error {
        Some(message) => (
            format!("<p id=\"{ERROR_ID}\" class=\"error\" role=\"alert\">{message}</p>"),
            format!(" aria-invalid=\"true\" aria-describedby=\"{ERROR_ID}\""),
        ),
        None => (String::new(), String::new()),
    };
    let target = target
        .map(|target| {
            format!("<input type=\"hidden\" name=\"{LOGIN_TARGET_PARAM}\" value=\"{target}\">")
        })
        .unwrap_or_default();
    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta name=\"color-scheme\" content=\"light dark\"><title>Tabularis Web sign in</title><style>{LOGIN_PAGE_STYLE}</style></head><body><main>{LOGO_SVG}<h1>Sign in to Tabularis Web</h1><p class=\"hint\">Enter the password for this server.</p>{error}<form method=\"post\" action=\"{action}\">{target}<label for=\"password\">Password</label><input id=\"password\" type=\"password\" name=\"password\" required autofocus autocomplete=\"current-password\"{described}><button type=\"submit\">Sign in</button></form></main></body></html>"
    )
}
