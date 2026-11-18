//! Driver-neutral types for recorded grid saves.
//!
//! A driver that opts in (`DatabaseDriver::supports_recorded_saves`) applies a
//! single-row update and reports what it verified inside the same transaction.
//! Values travel as the database's own text representation, so a restore
//! writes back exactly what was read, with no JSON round trip in between.

use serde::{Deserialize, Serialize};

/// Largest captured value, in bytes of its text form. A bigger value is not
/// kept; the cell is reported as [`CellImage::Omitted`] and the save cannot be
/// restored.
pub const MAX_CAPTURED_VALUE_BYTES: usize = 64 * 1024;

pub const OMITTED_TOO_LARGE: &str = "too_large";
pub const OMITTED_KEY_CHANGED: &str = "key_changed";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CellImage {
    Null,
    Text { value: String },
    Omitted { reason: String },
}

impl CellImage {
    pub fn is_captured(&self) -> bool {
        !matches!(self, CellImage::Omitted { .. })
    }

    /// Equality that never holds for an omitted value: a cell that was not
    /// captured cannot be compared.
    pub fn same_value(&self, other: &CellImage) -> bool {
        match (self, other) {
            (CellImage::Null, CellImage::Null) => true,
            (CellImage::Text { value: a }, CellImage::Text { value: b }) => a == b,
            _ => false,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ColumnCapture {
    pub name: String,
    pub data_type: String,
    pub generated: bool,
    pub pre: CellImage,
    pub post: CellImage,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RowCapture {
    pub columns: Vec<ColumnCapture>,
    pub has_triggers: bool,
    pub key_changed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RecordedCapture {
    Captured(RowCapture),
    /// The write ran, but nothing could be verified or recorded.
    Skipped {
        reason: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecordedUpdate {
    pub affected: u64,
    pub capture: RecordedCapture,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RestoreColumn {
    pub name: String,
    /// What the column must hold right now for the restore to proceed.
    pub expected: CellImage,
    pub target: CellImage,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RestoreOutcome {
    Restored {
        affected: u64,
    },
    RowMissing,
    /// Current values, in the order of the requested columns.
    Conflict {
        current: Vec<CellImage>,
    },
}
