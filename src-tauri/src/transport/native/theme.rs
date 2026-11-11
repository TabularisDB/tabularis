use crate::application::{persistence, themes};
use crate::runtime::RuntimeContext;
use gpui::{Hsla, Rgba};
use gpui_component::theme::ThemeColor;
use serde::Deserialize;

const FALLBACK_ID: &str = "tabularis-dark";
const BUILTIN: &str = include_str!("../../../../packages/web-ui/src/themes/builtin-themes.json");

// Not `theme_models::Colors`: its semantic keys do not match the legacy theme JSON.
#[derive(Deserialize)]
pub struct Colors {
    pub bg: Bg,
    pub surface: Surface,
    pub text: Text,
    pub accent: Accent,
    pub border: Border,
}

#[derive(Deserialize)]
pub struct Bg {
    pub base: String,
    pub elevated: String,
}

#[derive(Deserialize)]
pub struct Surface {
    pub primary: String,
    pub secondary: String,
}

#[derive(Deserialize)]
pub struct Text {
    pub primary: String,
    pub muted: String,
}

#[derive(Deserialize)]
pub struct Accent {
    pub primary: String,
}

#[derive(Deserialize)]
pub struct Border {
    pub subtle: String,
    pub default: String,
    pub focus: String,
}

pub fn colors_from_source(source: &str) -> Option<Colors> {
    let value: serde_json::Value = serde_json::from_str(source).ok()?;
    serde_json::from_value(value.get("colors")?.clone()).ok()
}

/// Active theme from the catalog; unknown ids and non-legacy theme formats use the built-in dark theme.
pub fn load(context: &RuntimeContext) -> Colors {
    let id = persistence::load_config(context)
        .theme
        .unwrap_or_else(|| FALLBACK_ID.into());
    themes::catalog(context)
        .themes
        .iter()
        .find(|theme| theme.id == id && theme.available)
        .and_then(|theme| colors_from_source(&theme.source))
        .unwrap_or_else(builtin_fallback)
}

fn builtin_fallback() -> Colors {
    let themes: Vec<serde_json::Value> =
        serde_json::from_str(BUILTIN).expect("built-in themes are valid JSON");
    let dark = themes
        .iter()
        .find(|theme| theme["id"] == FALLBACK_ID)
        .expect("built-in dark theme exists");
    colors_from_source(&dark.to_string()).expect("built-in dark theme has colors")
}

pub fn hsla(hex: &str) -> Hsla {
    Rgba::try_from(hex).map(Into::into).unwrap_or_default()
}

pub fn apply(c: &Colors, t: &mut ThemeColor) {
    t.background = hsla(&c.bg.base);
    t.foreground = hsla(&c.text.primary);
    t.border = hsla(&c.border.default);
    t.sidebar = hsla(&c.surface.primary);
    t.sidebar_foreground = hsla(&c.text.primary);
    t.sidebar_border = hsla(&c.border.subtle);
    t.muted = hsla(&c.surface.secondary);
    t.muted_foreground = hsla(&c.text.muted);
    t.primary = hsla(&c.accent.primary);
    t.ring = hsla(&c.border.focus);
}
