use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeContribution {
    pub id: String,
    pub name: String,
    pub revision: String,
    pub origin: Value,
    pub read_only: bool,
    pub mode: String,
    pub format: String,
    /// Original author JSON, not a serialized projection of a typed model.
    pub source: String,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub editor: Option<Value>,
}

#[derive(Debug, Default, Serialize)]
pub struct ThemeCatalog {
    pub themes: Vec<ThemeContribution>,
    pub issues: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PersonalDocument {
    pub storage_version: u8,
    pub id: String,
    pub name: String,
    pub format: String,
    pub source: String,
    /// Exact editor snapshots make legacy duplication independent of aliases.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub editor: Option<Value>,
}
