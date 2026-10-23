use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EditorPreferences {
    pub tabs: Vec<serde_json::Value>,
    pub active_tab_id: Option<String>,
}

