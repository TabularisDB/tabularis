use crate::drivers::recorded_save::CellImage;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub const STORE_VERSION: u32 = 1;
/// Most saves kept per connection; the oldest are dropped first.
pub const MAX_RECORDS_PER_CONNECTION: usize = 200;
pub const RETENTION_DAYS: i64 = 30;
/// Cap on the captured text of one save (before and after, all columns).
pub const MAX_RECORD_VALUE_BYTES: usize = 256 * 1024;
/// Cap on one connection's history file.
pub const MAX_STORE_BYTES: usize = 4 * 1024 * 1024;

pub const SKIPPED_UNCHANGED: &str = "unchanged";
pub const SKIPPED_RECORDING_DISABLED: &str = "recording_disabled";
pub const SKIPPED_STORAGE_ERROR: &str = "storage_error";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NonRestorableReason {
    /// A primary key column was among the changes, so the row moved.
    KeyChanged,
    /// A trigger may have changed other data or acted outside the table.
    TableHasTriggers,
    GeneratedColumn,
    /// A before or after value was too large to keep or could not be read.
    ValueNotCaptured,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedColumn {
    pub name: String,
    pub data_type: String,
    pub pre: CellImage,
    pub post: CellImage,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRecord {
    pub id: String,
    pub saved_at: String,
    pub database: Option<String>,
    pub schema: Option<String>,
    pub table: String,
    /// Fingerprint of the server the save was written to. A record without
    /// one cannot be tied to a server and is never restored.
    #[serde(default)]
    pub target: Option<String>,
    pub key: BTreeMap<String, Value>,
    pub columns: Vec<RecordedColumn>,
    pub restorable: bool,
    pub non_restorable_reason: Option<NonRestorableReason>,
    pub restored_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveHistoryFile {
    pub version: u32,
    pub enabled: bool,
    pub records: Vec<SaveRecord>,
}

impl Default for SaveHistoryFile {
    fn default() -> Self {
        Self {
            version: STORE_VERSION,
            enabled: false,
            records: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveHistoryStatus {
    /// The connection's driver can record and restore saves.
    pub supported: bool,
    pub enabled: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedSaveResponse {
    pub affected: u64,
    pub record_id: Option<String>,
    pub skipped_reason: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanStatus {
    Ready,
    /// The row no longer holds the values this save wrote.
    Conflict,
    RowMissing,
    NotRestorable,
    AlreadyRestored,
    /// The saved connection no longer points at the server of the save.
    TargetChanged,
    /// Returned by an applied restore.
    Restored,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePlanColumn {
    pub name: String,
    pub data_type: String,
    /// The value the original save wrote, which the row must still hold.
    pub expected: CellImage,
    pub current: Option<CellImage>,
    /// The value from before the original save.
    pub restore_to: CellImage,
    pub conflict: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePlan {
    pub record_id: String,
    pub status: PlanStatus,
    pub reason: Option<NonRestorableReason>,
    pub columns: Vec<RestorePlanColumn>,
}
