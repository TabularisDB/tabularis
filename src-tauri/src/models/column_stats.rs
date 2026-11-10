use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Which parts of the statistics the host wants. The host decides this from
/// the column type and from masking: a masked column never asks for min /
/// max or top values, so a plugin must not compute them.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct ColumnStatsParts {
    pub distinct: bool,
    pub min_max: bool,
    pub top_values: bool,
}

/// Request for the optional `get_column_stats` plugin RPC (issue #1137).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnStatsRequest {
    /// Unquoted table name.
    pub table: String,
    /// Unquoted schema name, for drivers with `capabilities.schemas`.
    #[serde(default)]
    pub schema: Option<String>,
    /// Unquoted column name.
    pub column: String,
    /// Column type as the grid reports it, when known.
    #[serde(default)]
    pub data_type: Option<String>,
    /// The tab's current filter: a WHERE clause without the keyword, in the
    /// driver's own dialect, exactly as the grid query applies it.
    #[serde(default)]
    pub filter: Option<String>,
    /// Most frequent values to return when `include.top_values` is set.
    pub top_values_limit: u32,
    pub include: ColumnStatsParts,
}

/// One entry of the most frequent values list.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ColumnTopValue {
    pub value: Value,
    pub count: u64,
}

/// Result of `get_column_stats`, the shape the column statistics popover
/// renders. Optional parts are `null` when not computed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ColumnStatsResult {
    /// Rows matching the filter.
    pub row_count: u64,
    /// Rows where the column is NULL (or missing).
    pub null_count: u64,
    #[serde(default)]
    pub distinct_count: Option<u64>,
    #[serde(default)]
    pub min: Option<Value>,
    #[serde(default)]
    pub max: Option<Value>,
    /// Most frequent non-NULL values, most frequent first.
    #[serde(default)]
    pub top_values: Option<Vec<ColumnTopValue>>,
    /// Set when `distinct_count`, `min`, `max` and `top_values` were computed
    /// over a sample of this many non-NULL values instead of all of them.
    /// `row_count` and `null_count` stay exact.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample_size: Option<u64>,
}

/// Checks a plugin's result and drops every part the request didn't ask for,
/// so a masked column never gets min / max or top values whatever the
/// plugin returns. Top values are capped at `top_values_limit` and NULL
/// entries are removed.
pub fn restrict_column_stats(
    mut result: ColumnStatsResult,
    request: &ColumnStatsRequest,
) -> Result<ColumnStatsResult, String> {
    if result.null_count > result.row_count {
        return Err(format!(
            "Invalid column statistics: null_count ({}) exceeds row_count ({})",
            result.null_count, result.row_count
        ));
    }
    let include = request.include;
    if !include.distinct {
        result.distinct_count = None;
    }
    if !include.min_max {
        result.min = None;
        result.max = None;
    }
    if include.top_values {
        if let Some(values) = result.top_values.as_mut() {
            values.retain(|entry| !entry.value.is_null());
            values.truncate(request.top_values_limit as usize);
        }
    } else {
        result.top_values = None;
    }
    if !include.distinct && !include.min_max && !include.top_values {
        result.sample_size = None;
    }
    Ok(result)
}

#[cfg(test)]
mod tests;
