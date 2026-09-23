use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonacoThemeDefinition {
    pub base: String,
    pub inherit: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rules: Option<Vec<MonacoThemeRule>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub colors: Option<HashMap<String, String>>,
    #[serde(rename = "themeName", skip_serializing_if = "Option::is_none")]
    pub theme_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonacoThemeRule {
    pub token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub foreground: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_style: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeColors {
    pub bg: ThemeBgColors,
    pub surface: ThemeSurfaceColors,
    pub text: ThemeTextColors,
    pub accent: ThemeAccentColors,
    pub border: ThemeBorderColors,
    pub semantic: ThemeSemanticColors,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeBgColors {
    pub base: String,
    pub elevated: String,
    pub overlay: String,
    pub input: String,
    pub tooltip: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeSurfaceColors {
    pub primary: String,
    pub secondary: String,
    pub tertiary: String,
    pub hover: String,
    pub active: String,
    pub disabled: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeTextColors {
    pub primary: String,
    pub secondary: String,
    pub muted: String,
    pub disabled: String,
    pub accent: String,
    pub inverse: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeAccentColors {
    pub primary: String,
    pub secondary: String,
    pub success: String,
    pub warning: String,
    pub error: String,
    pub info: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeBorderColors {
    pub subtle: String,
    pub default: String,
    pub strong: String,
    pub focus: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeSemanticColors {
    pub string: String,
    pub number: String,
    pub boolean: String,
    pub date: String,
    pub null: String,
    #[serde(rename = "primaryKey")]
    pub primary_key: String,
    #[serde(rename = "foreignKey")]
    pub foreign_key: String,
    pub index: String,
    pub connection_active: String,
    pub connection_inactive: String,
    pub modified: String,
    pub deleted: String,
    pub new: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeTypography {
    #[serde(rename = "fontFamily")]
    pub font_family: ThemeFontFamily,
    #[serde(rename = "fontSize")]
    pub font_size: ThemeFontSize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeFontFamily {
    pub base: String,
    pub mono: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeFontSize {
    pub xs: String,
    pub sm: String,
    pub base: String,
    pub lg: String,
    pub xl: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeLayout {
    #[serde(rename = "borderRadius")]
    pub border_radius: ThemeBorderRadius,
    pub spacing: ThemeSpacing,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeBorderRadius {
    pub sm: String,
    pub base: String,
    pub lg: String,
    pub xl: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeSpacing {
    pub xs: String,
    pub sm: String,
    pub base: String,
    pub lg: String,
    pub xl: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskbarIconConfig {
    #[serde(rename = "type")]
    pub icon_type: String,
    pub color: Option<String>,
    #[serde(rename = "iconPath")]
    pub icon_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Theme {
    pub id: String,
    pub name: String,
    pub author: Option<String>,
    pub version: Option<String>,
    #[serde(rename = "isPreset")]
    pub is_preset: bool,
    #[serde(rename = "isReadOnly")]
    pub is_read_only: bool,
    #[serde(rename = "createdAt")]
    pub created_at: Option<String>,
    #[serde(rename = "updatedAt")]
    pub updated_at: Option<String>,
    pub colors: ThemeColors,
    pub typography: ThemeTypography,
    pub layout: ThemeLayout,
    #[serde(rename = "monacoTheme")]
    pub monaco_theme: MonacoThemeDefinition,
    #[serde(rename = "taskbarIcon")]
    pub taskbar_icon: Option<TaskbarIconConfig>,
}
