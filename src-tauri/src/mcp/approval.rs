//! MCP approval policy for a classified query. Read-only connection checks
//! are independent of this decision.

use crate::config::DEFAULT_MCP_APPROVAL_MODE;
use crate::models::McpApprovalMode;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum QueryApproval {
    Required,
    ProtectedRead,
    Disabled,
}

pub(crate) fn query_approval(
    global: Option<&str>,
    connection: Option<McpApprovalMode>,
    kind: &str,
) -> QueryApproval {
    let mode = connection.unwrap_or_else(|| match global.unwrap_or(DEFAULT_MCP_APPROVAL_MODE) {
        "all" => McpApprovalMode::All,
        "off" => McpApprovalMode::Off,
        _ => McpApprovalMode::WritesOnly,
    });
    match mode {
        McpApprovalMode::Off => QueryApproval::Disabled,
        McpApprovalMode::WritesOnly if kind == "select" => QueryApproval::ProtectedRead,
        McpApprovalMode::All | McpApprovalMode::WritesOnly => QueryApproval::Required,
    }
}

#[cfg(test)]
mod tests;
