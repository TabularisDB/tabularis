use super::model::{
    NonRestorableReason, PlanStatus, SaveHistoryFile, SaveRecord, MAX_RECORDS_PER_CONNECTION,
    MAX_RECORD_VALUE_BYTES, RETENTION_DAYS,
};
use super::plan::{
    build_record, evaluate_plan, evaluate_target_mismatch, prune, restore_columns, target_matches,
};
use crate::drivers::recorded_save::{CellImage, ColumnCapture, RowCapture};
use chrono::{Duration, Utc};
use serde_json::json;
use std::collections::BTreeMap;

fn text(value: &str) -> CellImage {
    CellImage::Text {
        value: value.to_string(),
    }
}

fn omitted() -> CellImage {
    CellImage::Omitted {
        reason: "too_large".to_string(),
    }
}

fn column(name: &str, pre: CellImage, post: CellImage) -> ColumnCapture {
    ColumnCapture {
        name: name.to_string(),
        data_type: "text".to_string(),
        generated: false,
        pre,
        post,
    }
}

fn capture(columns: Vec<ColumnCapture>) -> RowCapture {
    RowCapture {
        columns,
        has_triggers: false,
        key_changed: false,
    }
}

fn record_of(capture: RowCapture) -> Option<SaveRecord> {
    let key = BTreeMap::from([("id".to_string(), json!(7))]);
    build_record(
        "rec".to_string(),
        Utc::now().to_rfc3339(),
        Some("app".to_string()),
        Some("public".to_string()),
        "orders".to_string(),
        "target-a".to_string(),
        key,
        capture,
    )
}

fn restorable_record() -> SaveRecord {
    record_of(capture(vec![
        column("status", text("open"), text("closed")),
        column("note", CellImage::Null, text("done")),
    ]))
    .unwrap()
}

mod build_record_tests {
    use super::*;

    #[test]
    fn keeps_the_qualified_target_key_and_changed_columns() {
        let record = restorable_record();
        assert!(record.restorable);
        assert_eq!(record.non_restorable_reason, None);
        assert_eq!(record.database.as_deref(), Some("app"));
        assert_eq!(record.schema.as_deref(), Some("public"));
        assert_eq!(record.table, "orders");
        assert_eq!(record.key["id"], json!(7));
        assert_eq!(record.columns.len(), 2);
        assert_eq!(record.columns[1].pre, CellImage::Null);
    }

    #[test]
    fn leaves_out_columns_that_did_not_change() {
        let record = record_of(capture(vec![
            column("same", text("a"), text("a")),
            column("nulls", CellImage::Null, CellImage::Null),
            column("status", text("open"), text("closed")),
        ]))
        .unwrap();
        assert_eq!(record.columns.len(), 1);
        assert_eq!(record.columns[0].name, "status");
    }

    #[test]
    fn records_nothing_when_no_value_changed() {
        assert!(record_of(capture(vec![column("a", text("x"), text("x"))])).is_none());
    }

    #[test]
    fn marks_a_changed_key_as_not_restorable() {
        let mut moved = capture(vec![column("id", text("7"), omitted())]);
        moved.key_changed = true;
        let record = record_of(moved).unwrap();
        assert!(!record.restorable);
        assert_eq!(
            record.non_restorable_reason,
            Some(NonRestorableReason::KeyChanged)
        );
    }

    #[test]
    fn marks_tables_with_triggers_as_not_restorable() {
        let mut triggered = capture(vec![column("a", text("1"), text("2"))]);
        triggered.has_triggers = true;
        assert_eq!(
            record_of(triggered).unwrap().non_restorable_reason,
            Some(NonRestorableReason::TableHasTriggers)
        );
    }

    #[test]
    fn marks_generated_columns_as_not_restorable() {
        let mut generated = column("total", text("1"), text("2"));
        generated.generated = true;
        assert_eq!(
            record_of(capture(vec![generated]))
                .unwrap()
                .non_restorable_reason,
            Some(NonRestorableReason::GeneratedColumn)
        );
    }

    #[test]
    fn marks_values_that_were_not_captured_as_not_restorable() {
        let record = record_of(capture(vec![column("blob", omitted(), text("\\x00"))])).unwrap();
        assert_eq!(
            record.non_restorable_reason,
            Some(NonRestorableReason::ValueNotCaptured)
        );
    }

    #[test]
    fn withholds_values_beyond_the_record_budget() {
        let big = "x".repeat(MAX_RECORD_VALUE_BYTES - 2);
        let record = record_of(capture(vec![column("a", text(&big), text("small"))])).unwrap();
        assert!(!record.restorable);
        assert_eq!(
            record.non_restorable_reason,
            Some(NonRestorableReason::ValueNotCaptured)
        );
        assert!(matches!(record.columns[0].pre, CellImage::Text { .. }));
        assert!(matches!(record.columns[0].post, CellImage::Omitted { .. }));
    }
}

mod restore_columns_tests {
    use super::*;

    #[test]
    fn expects_what_the_save_wrote_and_restores_what_was_there() {
        let columns = restore_columns(&restorable_record());
        assert_eq!(columns[0].name, "status");
        assert_eq!(columns[0].expected, text("closed"));
        assert_eq!(columns[0].target, text("open"));
        assert_eq!(columns[1].target, CellImage::Null);
    }
}

mod evaluate_plan_tests {
    use super::*;

    #[test]
    fn is_ready_when_the_row_still_holds_the_saved_values() {
        let plan = evaluate_plan(&restorable_record(), Some(&[text("closed"), text("done")]));
        assert_eq!(plan.status, PlanStatus::Ready);
        assert!(plan.columns.iter().all(|c| !c.conflict));
        assert_eq!(plan.columns[0].restore_to, text("open"));
    }

    #[test]
    fn reports_a_conflict_on_each_column_that_moved_on() {
        let plan = evaluate_plan(&restorable_record(), Some(&[text("shipped"), text("done")]));
        assert_eq!(plan.status, PlanStatus::Conflict);
        assert!(plan.columns[0].conflict);
        assert!(!plan.columns[1].conflict);
        assert_eq!(plan.columns[0].current, Some(text("shipped")));
    }

    #[test]
    fn treats_null_and_an_empty_string_as_different() {
        let plan = evaluate_plan(&restorable_record(), Some(&[text("closed"), text("")]));
        assert_eq!(plan.status, PlanStatus::Conflict);
        let plan = evaluate_plan(
            &restorable_record(),
            Some(&[text("closed"), CellImage::Null]),
        );
        assert_eq!(plan.status, PlanStatus::Conflict);
    }

    #[test]
    fn compares_numeric_and_binary_text_exactly() {
        let record = record_of(capture(vec![
            column("price", text("10.50"), text("12.00")),
            column("blob", text("\\xdeadbeef"), text("\\x00")),
        ]))
        .unwrap();
        let ready = evaluate_plan(&record, Some(&[text("12.00"), text("\\x00")]));
        assert_eq!(ready.status, PlanStatus::Ready);
        let scale_changed = evaluate_plan(&record, Some(&[text("12.0"), text("\\x00")]));
        assert_eq!(scale_changed.status, PlanStatus::Conflict);
        let blob_changed = evaluate_plan(&record, Some(&[text("12.00"), text("\\x01")]));
        assert_eq!(blob_changed.status, PlanStatus::Conflict);
    }

    #[test]
    fn reports_a_deleted_or_moved_row() {
        let plan = evaluate_plan(&restorable_record(), None);
        assert_eq!(plan.status, PlanStatus::RowMissing);
        assert!(plan.columns.iter().all(|c| c.current.is_none()));
    }

    #[test]
    fn never_offers_a_restore_for_a_not_restorable_save() {
        let mut triggered = capture(vec![column("a", text("1"), text("2"))]);
        triggered.has_triggers = true;
        let record = record_of(triggered).unwrap();
        let plan = evaluate_plan(&record, Some(&[text("2")]));
        assert_eq!(plan.status, PlanStatus::NotRestorable);
        assert_eq!(plan.reason, Some(NonRestorableReason::TableHasTriggers));
    }

    #[test]
    fn refuses_a_save_that_was_already_restored() {
        let mut record = restorable_record();
        record.restored_at = Some(Utc::now().to_rfc3339());
        let plan = evaluate_plan(&record, Some(&[text("closed"), text("done")]));
        assert_eq!(plan.status, PlanStatus::AlreadyRestored);
    }

    #[test]
    fn a_withheld_current_value_is_a_conflict() {
        let plan = evaluate_plan(&restorable_record(), Some(&[omitted(), text("done")]));
        assert_eq!(plan.status, PlanStatus::Conflict);
    }
}

mod target_tests {
    use super::*;

    #[test]
    fn a_record_remembers_the_server_it_was_written_to() {
        let record = restorable_record();
        assert!(target_matches(&record, "target-a"));
        assert!(!target_matches(&record, "target-b"));
    }

    #[test]
    fn a_record_without_a_target_matches_nothing() {
        let mut record = restorable_record();
        record.target = None;
        assert!(!target_matches(&record, "target-a"));
        assert!(!target_matches(&record, ""));
    }

    #[test]
    fn a_restorable_record_on_another_server_is_blocked() {
        let plan = evaluate_target_mismatch(&restorable_record());
        assert_eq!(plan.status, PlanStatus::TargetChanged);
        assert!(plan.columns.iter().all(|c| c.current.is_none()));
    }

    #[test]
    fn restored_and_review_only_records_keep_their_status() {
        let mut restored = restorable_record();
        restored.restored_at = Some(Utc::now().to_rfc3339());
        assert_eq!(
            evaluate_target_mismatch(&restored).status,
            PlanStatus::AlreadyRestored
        );
        let mut review = restorable_record();
        review.restorable = false;
        assert_eq!(
            evaluate_target_mismatch(&review).status,
            PlanStatus::NotRestorable
        );
    }

    #[test]
    fn an_old_record_without_a_target_field_still_loads() {
        let mut value = serde_json::to_value(restorable_record()).unwrap();
        value.as_object_mut().unwrap().remove("target");
        let record: SaveRecord = serde_json::from_value(value).unwrap();
        assert_eq!(record.target, None);
    }
}

mod prune_tests {
    use super::*;

    fn file_with(records: Vec<SaveRecord>) -> SaveHistoryFile {
        SaveHistoryFile {
            records,
            ..SaveHistoryFile::default()
        }
    }

    fn aged(days: i64, id: &str) -> SaveRecord {
        let mut record = restorable_record();
        record.id = id.to_string();
        record.saved_at = (Utc::now() - Duration::days(days)).to_rfc3339();
        record
    }

    #[test]
    fn drops_records_older_than_the_retention_window() {
        let mut file = file_with(vec![aged(RETENTION_DAYS + 1, "old"), aged(1, "new")]);
        prune(&mut file, Utc::now());
        assert_eq!(file.records.len(), 1);
        assert_eq!(file.records[0].id, "new");
    }

    #[test]
    fn drops_records_with_an_unreadable_timestamp() {
        let mut broken = aged(0, "broken");
        broken.saved_at = "yesterday".to_string();
        let mut file = file_with(vec![broken]);
        prune(&mut file, Utc::now());
        assert!(file.records.is_empty());
    }

    #[test]
    fn keeps_the_newest_records_up_to_the_count_limit() {
        let records = (0..MAX_RECORDS_PER_CONNECTION + 5)
            .map(|index| aged(0, &index.to_string()))
            .collect();
        let mut file = file_with(records);
        prune(&mut file, Utc::now());
        assert_eq!(file.records.len(), MAX_RECORDS_PER_CONNECTION);
        assert_eq!(file.records[0].id, "5");
    }

    #[test]
    fn keeps_the_file_under_the_size_limit() {
        let big = "y".repeat(MAX_RECORD_VALUE_BYTES - 10);
        let records = (0..40)
            .map(|index| {
                let mut record = aged(0, &index.to_string());
                record.columns[0].pre = text(&big);
                record.columns[0].post = CellImage::Null;
                record
            })
            .collect();
        let mut file = file_with(records);
        prune(&mut file, Utc::now());
        let size = serde_json::to_vec(&file).unwrap().len();
        assert!(size <= super::super::model::MAX_STORE_BYTES);
        assert_eq!(file.records.last().unwrap().id, "39");
    }
}
