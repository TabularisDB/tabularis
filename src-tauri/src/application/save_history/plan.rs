//! Pure rules for what a recorded save is worth: which saves can be
//! restored, what a restore would do, and what the history keeps.

use super::model::{
    NonRestorableReason, PlanStatus, RecordedColumn, RestorePlan, RestorePlanColumn,
    SaveHistoryFile, SaveRecord, MAX_RECORDS_PER_CONNECTION, MAX_RECORD_VALUE_BYTES,
    MAX_STORE_BYTES, RETENTION_DAYS,
};
use crate::drivers::recorded_save::{
    CellImage, ColumnCapture, RestoreColumn, RowCapture, OMITTED_TOO_LARGE,
};
use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use std::collections::BTreeMap;

/// Builds the record of a verified save. Columns whose value did not change
/// are left out, and `None` means there is nothing worth keeping.
#[allow(clippy::too_many_arguments)]
pub fn build_record(
    id: String,
    saved_at: String,
    database: Option<String>,
    schema: Option<String>,
    table: String,
    target: String,
    key: BTreeMap<String, Value>,
    capture: RowCapture,
) -> Option<SaveRecord> {
    let changed: Vec<&ColumnCapture> = capture
        .columns
        .iter()
        .filter(|column| !column.pre.same_value(&column.post))
        .collect();
    if changed.is_empty() {
        return None;
    }
    let reason = non_restorable_reason(&capture, &changed);
    let mut columns: Vec<RecordedColumn> = changed
        .into_iter()
        .map(|column| RecordedColumn {
            name: column.name.clone(),
            data_type: column.data_type.clone(),
            pre: column.pre.clone(),
            post: column.post.clone(),
        })
        .collect();
    let trimmed = enforce_value_budget(&mut columns);
    let reason = reason.or(trimmed.then_some(NonRestorableReason::ValueNotCaptured));
    Some(SaveRecord {
        id,
        saved_at,
        database,
        schema,
        table,
        target: Some(target),
        key,
        columns,
        restorable: reason.is_none(),
        non_restorable_reason: reason,
        restored_at: None,
    })
}

fn non_restorable_reason(
    capture: &RowCapture,
    changed: &[&ColumnCapture],
) -> Option<NonRestorableReason> {
    if capture.key_changed {
        Some(NonRestorableReason::KeyChanged)
    } else if capture.has_triggers {
        Some(NonRestorableReason::TableHasTriggers)
    } else if changed.iter().any(|column| column.generated) {
        Some(NonRestorableReason::GeneratedColumn)
    } else if changed
        .iter()
        .any(|column| !column.pre.is_captured() || !column.post.is_captured())
    {
        Some(NonRestorableReason::ValueNotCaptured)
    } else {
        None
    }
}

fn image_bytes(image: &CellImage) -> usize {
    match image {
        CellImage::Text { value } => value.len(),
        _ => 0,
    }
}

/// Keeps the captured text of one save under [`MAX_RECORD_VALUE_BYTES`] by
/// withholding values, in column order, once the budget is spent. Returns
/// whether anything was withheld.
fn enforce_value_budget(columns: &mut [RecordedColumn]) -> bool {
    let mut spent = 0usize;
    let mut withheld = false;
    for column in columns {
        for image in [&mut column.pre, &mut column.post] {
            let size = image_bytes(image);
            if spent + size > MAX_RECORD_VALUE_BYTES {
                *image = CellImage::Omitted {
                    reason: OMITTED_TOO_LARGE.to_string(),
                };
                withheld = true;
            } else {
                spent += size;
            }
        }
    }
    withheld
}

/// The columns a restore writes: each must still hold what the save wrote
/// (`expected`) and gets what was there before (`target`).
pub fn restore_columns(record: &SaveRecord) -> Vec<RestoreColumn> {
    record
        .columns
        .iter()
        .map(|column| RestoreColumn {
            name: column.name.clone(),
            expected: column.post.clone(),
            target: column.pre.clone(),
        })
        .collect()
}

/// Compares a record with the row as it is now. `current` holds the images
/// in the record's column order, or `None` when the row is gone.
pub fn evaluate_plan(record: &SaveRecord, current: Option<&[CellImage]>) -> RestorePlan {
    let columns: Vec<RestorePlanColumn> = record
        .columns
        .iter()
        .enumerate()
        .map(|(index, column)| {
            let now = current.and_then(|images| images.get(index)).cloned();
            let conflict = now.as_ref().is_some_and(|now| !column.post.same_value(now));
            RestorePlanColumn {
                name: column.name.clone(),
                data_type: column.data_type.clone(),
                expected: column.post.clone(),
                current: now,
                restore_to: column.pre.clone(),
                conflict,
            }
        })
        .collect();
    let status = if record.restored_at.is_some() {
        PlanStatus::AlreadyRestored
    } else if !record.restorable {
        PlanStatus::NotRestorable
    } else if current.is_none() {
        PlanStatus::RowMissing
    } else if columns.iter().any(|column| column.conflict) {
        PlanStatus::Conflict
    } else {
        PlanStatus::Ready
    };
    RestorePlan {
        record_id: record.id.clone(),
        status,
        reason: record.non_restorable_reason,
        columns,
    }
}

/// Applies the retention limits: age, count and total size. The newest
/// records are kept.
pub fn prune(file: &mut SaveHistoryFile, now: DateTime<Utc>) {
    let cutoff = now - Duration::days(RETENTION_DAYS);
    file.records.retain(|record| {
        DateTime::parse_from_rfc3339(&record.saved_at)
            .map(|saved| saved.with_timezone(&Utc) >= cutoff)
            .unwrap_or(false)
    });
    if file.records.len() > MAX_RECORDS_PER_CONNECTION {
        let excess = file.records.len() - MAX_RECORDS_PER_CONNECTION;
        file.records.drain(..excess);
    }
    while file.records.len() > 1 && serialized_size(file) > MAX_STORE_BYTES {
        file.records.remove(0);
    }
}

fn serialized_size(file: &SaveHistoryFile) -> usize {
    serde_json::to_vec(file)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX)
}

/// The plan for a record whose server cannot be confirmed. Records that are
/// already restored or not restorable keep that status.
pub fn evaluate_target_mismatch(record: &SaveRecord) -> RestorePlan {
    let mut plan = evaluate_plan(record, None);
    if plan.status == PlanStatus::RowMissing {
        plan.status = PlanStatus::TargetChanged;
    }
    plan
}

pub fn target_matches(record: &SaveRecord, current_target: &str) -> bool {
    record.target.as_deref() == Some(current_target)
}
