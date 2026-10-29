use super::{recipe, KIND};
use crate::drivers::driver_trait::PluginSettingDefinition;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AssistantContract {
    pub api_version: u32,
    pub authentication: Authentication,
    #[serde(default)]
    pub api_key_env: Option<String>,
    #[serde(default)]
    pub default_models: Vec<String>,
    #[serde(default)]
    pub optional_api_key: bool,
    #[serde(default)]
    pub auto_select_priority: Option<u32>,
    #[serde(default = "authorization_header")]
    pub api_key_header: String,
    #[serde(default = "bearer_prefix")]
    pub api_key_prefix: String,
    #[serde(default)]
    pub direct: bool,
    pub generate: GenerationRecipe,
    pub models: ModelDiscovery,
}

fn authorization_header() -> String {
    "Authorization".into()
}
fn bearer_prefix() -> String {
    "Bearer ".into()
}
fn cache_seconds() -> u64 {
    86400
}
fn authenticated() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HttpRequest {
    pub url: String,
    #[serde(default)]
    pub append_path: String,
    #[serde(default)]
    pub headers: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub body: Option<serde_json::Value>,
    #[serde(default = "authenticated")]
    pub authenticated: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JsonFilter {
    pub path: String,
    #[serde(default)]
    pub equals: Option<serde_json::Value>,
    #[serde(default)]
    pub contains: Option<serde_json::Value>,
    #[serde(default)]
    pub starts_with: Option<String>,
    #[serde(default)]
    pub prefixes: Vec<String>,
    #[serde(default)]
    pub missing_matches: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResponseRecipe {
    pub path: String,
    #[serde(default)]
    pub select: Option<JsonFilter>,
    #[serde(default)]
    pub value_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GenerationRecipe {
    pub requests: Vec<HttpRequest>,
    pub response: ResponseRecipe,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelSource {
    pub request: HttpRequest,
    pub items_path: String,
    pub id_path: String,
    #[serde(default)]
    pub filters: Vec<JsonFilter>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelDiscovery {
    pub sources: Vec<ModelSource>,
    #[serde(default = "cache_seconds")]
    pub cache_seconds: u64,
    #[serde(default)]
    pub fallback: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Authentication {
    ApiKey,
    None,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AssistantManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub kind: String,
    #[serde(default)]
    pub min_runtime_version: Option<String>,
    pub ai_assistant: AssistantContract,
    #[serde(default)]
    pub settings: Vec<PluginSettingDefinition>,
}

pub fn destination(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !crate::theme_packages::is_package_slug(id) || id == "chatgpt" {
        return Err("Invalid AI assistant package identity".into());
    }
    Ok(root.join(KIND).join(id))
}

pub fn parse_manifest(source: &[u8]) -> Result<AssistantManifest, String> {
    let value = crate::theme_packages::parse_bounded_json(source, 64 * 1024, 32, 8192)?;
    if [
        "executable",
        "interpreter",
        "ui_extensions",
        "explain_parsers",
    ]
    .iter()
    .any(|key| value.get(key).is_some())
    {
        return Err("AI assistant packages must be declarative".into());
    }
    static SCHEMA: once_cell::sync::Lazy<jsonschema::JSONSchema> =
        once_cell::sync::Lazy::new(|| {
            let schema = serde_json::from_str(include_str!(
                "../../../plugins/ai-assistants/manifest.schema.json"
            ))
            .expect("Bundled AI assistant schema must be valid JSON");
            jsonschema::JSONSchema::compile(&schema)
                .expect("Bundled AI assistant schema must compile")
        });
    if !SCHEMA.is_valid(&value) {
        return Err("Invalid declarative AI assistant manifest".into());
    }
    let manifest: AssistantManifest = serde_json::from_value(value).map_err(|e| e.to_string())?;
    destination(Path::new(""), &manifest.id)?;
    if manifest.kind != KIND || manifest.ai_assistant.api_version != 1 {
        return Err("Unsupported AI assistant kind or API version".into());
    }
    semver::Version::parse(&manifest.version).map_err(|e| e.to_string())?;
    recipe::validate(&manifest.ai_assistant)?;
    if manifest
        .ai_assistant
        .api_key_env
        .as_ref()
        .is_some_and(|name| {
            name.is_empty()
                || !name
                    .bytes()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'_')
        })
    {
        return Err("Invalid AI assistant environment variable".into());
    }
    Ok(manifest)
}

pub fn read_manifest(root: &Path, id: &str) -> Result<AssistantManifest, String> {
    let dir = destination(root, id)?;
    let path = dir.join(".tabularium");
    let meta = std::fs::symlink_metadata(&path).map_err(|_| {
        format!("AI provider '{id}' is not installed. Install it from the Plugin Center.")
    })?;
    if !meta.is_file()
        || meta.len() > 64 * 1024
        || std::fs::symlink_metadata(&dir)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
    {
        return Err("Invalid installed AI assistant manifest".into());
    }
    let manifest = parse_manifest(&std::fs::read(path).map_err(|e| e.to_string())?)?;
    if manifest.id != id {
        return Err("Installed AI assistant identity mismatch".into());
    }
    Ok(manifest)
}

pub fn list_installed(root: &Path) -> Vec<AssistantManifest> {
    let Ok(entries) = std::fs::read_dir(root.join(KIND)) else {
        return vec![];
    };
    let mut manifests = entries
        .filter_map(Result::ok)
        .filter_map(|entry| read_manifest(root, &entry.file_name().to_string_lossy()).ok())
        .collect::<Vec<_>>();
    manifests.sort_by(|a, b| a.name.cmp(&b.name));
    manifests
}
