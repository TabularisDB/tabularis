use serde::{Deserialize, Serialize};

/// SQL preview only: generating a template must never execute it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TableQueryTemplateKind {
    Select,
    Update,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableQueryTemplateRequest {
    pub table: String,
    pub schema: Option<String>,
    pub kind: TableQueryTemplateKind,
    /// An empty list means SELECT * or an UPDATE placeholder.
    #[serde(default)]
    pub columns: Vec<String>,
    /// Explicit SELECT row limit; None leaves the query unbounded.
    pub limit: Option<u32>,
}
