//! Recorded saves: verified before/after images, restore, and its refusals,
//! on real PostgreSQL tables.

use crate::helpers::pg_params;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;
use tabularis_lib::drivers::driver_trait::DatabaseDriver;
use tabularis_lib::drivers::postgres::{self, PostgresDriver};
use tabularis_lib::drivers::recorded_save::{
    CellImage, RecordedCapture, RecordedUpdate, RestoreColumn, RestoreOutcome, RowCapture,
};

const SCHEMA: &str = "public";
const MAX_BLOB: u64 = 10_000_000;

fn text(value: &str) -> CellImage {
    CellImage::Text {
        value: value.to_string(),
    }
}

async fn sql(statement: &str) {
    postgres::execute_query(&pg_params(), statement, None, 1, None)
        .await
        .unwrap_or_else(|error| panic!("{statement}: {error}"));
}

async fn scalar(statement: &str) -> Value {
    let result = postgres::execute_query(&pg_params(), statement, None, 1, None)
        .await
        .unwrap_or_else(|error| panic!("{statement}: {error}"));
    result.rows[0][0].clone()
}

async fn fresh_orders(table: &str) {
    sql(&format!("DROP TABLE IF EXISTS {table} CASCADE")).await;
    sql(&format!(
        "CREATE TABLE {table} (id integer PRIMARY KEY, status text, qty numeric(10,2), \
note text, data bytea, meta jsonb, shipped boolean, at timestamptz)"
    ))
    .await;
    sql(&format!(
        "INSERT INTO {table} VALUES (1, 'open', 10.50, NULL, '\\xdeadbeef', '{{\"a\": 1}}', false, \
'2026-01-02 03:04:05+00'), (2, 'open', 1.00, 'keep', NULL, NULL, NULL, NULL)"
    ))
    .await;
}

fn key(id: i64) -> HashMap<String, Value> {
    HashMap::from([("id".to_string(), json!(id))])
}

async fn save(table: &str, id: i64, changes: Vec<(&str, Value)>) -> Result<RecordedUpdate, String> {
    PostgresDriver::new()
        .update_row_recorded(
            &pg_params(),
            table,
            &key(id),
            changes
                .into_iter()
                .map(|(name, value)| (name.to_string(), value))
                .collect(),
            Some(SCHEMA),
            MAX_BLOB,
        )
        .await
}

fn captured(update: RecordedUpdate) -> RowCapture {
    match update.capture {
        RecordedCapture::Captured(capture) => capture,
        RecordedCapture::Skipped { reason } => panic!("expected a capture, skipped: {reason}"),
    }
}

fn skipped(update: &RecordedUpdate) -> &str {
    match &update.capture {
        RecordedCapture::Skipped { reason } => reason,
        RecordedCapture::Captured(_) => panic!("expected the capture to be skipped"),
    }
}

async fn restore(
    table: &str,
    id: i64,
    columns: Vec<(&str, CellImage, CellImage)>,
) -> Result<RestoreOutcome, String> {
    let columns: Vec<RestoreColumn> = columns
        .into_iter()
        .map(|(name, expected, target)| RestoreColumn {
            name: name.to_string(),
            expected,
            target,
        })
        .collect();
    PostgresDriver::new()
        .restore_row_images(&pg_params(), table, &key(id), &columns, Some(SCHEMA))
        .await
}

fn restore_columns_of(capture: &RowCapture) -> Vec<(String, CellImage, CellImage)> {
    capture
        .columns
        .iter()
        .map(|c| (c.name.clone(), c.post.clone(), c.pre.clone()))
        .collect()
}

async fn restore_capture(
    table: &str,
    id: i64,
    capture: &RowCapture,
) -> Result<RestoreOutcome, String> {
    let columns: Vec<RestoreColumn> = restore_columns_of(capture)
        .into_iter()
        .map(|(name, expected, target)| RestoreColumn {
            name,
            expected,
            target,
        })
        .collect();
    PostgresDriver::new()
        .restore_row_images(&pg_params(), table, &key(id), &columns, Some(SCHEMA))
        .await
}

#[tokio::test]
#[ignore]
async fn test_driver_reports_recorded_save_support() {
    assert!(PostgresDriver::new().supports_recorded_saves());
}

#[tokio::test]
#[ignore]
async fn test_recorded_update_captures_verified_before_and_after_values() {
    require_pg!();
    fresh_orders("rec_basic").await;

    let update = save(
        "rec_basic",
        1,
        vec![("status", json!("closed")), ("qty", json!(12))],
    )
    .await
    .unwrap();
    assert_eq!(update.affected, 2);
    let capture = captured(update);
    assert!(!capture.key_changed);
    assert!(!capture.has_triggers);
    let by_name: HashMap<_, _> = capture
        .columns
        .iter()
        .map(|c| (c.name.as_str(), c))
        .collect();
    assert_eq!(by_name["status"].pre, text("open"));
    assert_eq!(by_name["status"].post, text("closed"));
    assert_eq!(by_name["status"].data_type, "text");
    assert_eq!(by_name["qty"].pre, text("10.50"));
    assert_eq!(by_name["qty"].post, text("12.00"));
    assert_eq!(by_name["qty"].data_type, "numeric(10,2)");
    assert_eq!(
        scalar("SELECT status FROM rec_basic WHERE id = 1").await,
        json!("closed")
    );
    sql("DROP TABLE rec_basic").await;
}

#[tokio::test]
#[ignore]
async fn test_recorded_update_distinguishes_null_from_empty_and_handles_binary() {
    require_pg!();
    fresh_orders("rec_nulls").await;

    let capture = captured(
        save(
            "rec_nulls",
            1,
            vec![
                ("note", json!("")),
                ("data", json!(null)),
                ("meta", json!({"b": 2})),
            ],
        )
        .await
        .unwrap(),
    );
    let by_name: HashMap<_, _> = capture
        .columns
        .iter()
        .map(|c| (c.name.as_str(), c))
        .collect();
    assert_eq!(by_name["note"].pre, CellImage::Null);
    assert_eq!(by_name["note"].post, text(""));
    assert_eq!(by_name["data"].pre, text("\\xdeadbeef"));
    assert_eq!(by_name["data"].post, CellImage::Null);
    assert_eq!(by_name["meta"].pre, text("{\"a\": 1}"));
    assert_eq!(by_name["meta"].post, text("{\"b\": 2}"));

    let outcome = restore_capture("rec_nulls", 1, &capture).await.unwrap();
    assert!(matches!(outcome, RestoreOutcome::Restored { affected: 1 }));
    assert_eq!(
        scalar("SELECT note IS NULL FROM rec_nulls WHERE id = 1").await,
        json!(true)
    );
    assert_eq!(
        scalar("SELECT encode(data, 'hex') FROM rec_nulls WHERE id = 1").await,
        json!("deadbeef")
    );
    assert_eq!(
        scalar("SELECT meta->>'a' FROM rec_nulls WHERE id = 1").await,
        json!("1")
    );
    assert_eq!(
        scalar("SELECT meta->>'b' IS NULL FROM rec_nulls WHERE id = 1").await,
        json!(true)
    );
    sql("DROP TABLE rec_nulls").await;
}

#[tokio::test]
#[ignore]
async fn test_restore_round_trips_numeric_boolean_and_timestamp_values() {
    require_pg!();
    fresh_orders("rec_types").await;

    let capture = captured(
        save(
            "rec_types",
            1,
            vec![
                ("qty", json!(99.99)),
                ("shipped", json!(true)),
                ("at", json!("2030-05-06 07:08:09+00")),
                ("data", json!("BLOB:3:application/octet-stream:AAEC")),
            ],
        )
        .await
        .unwrap(),
    );
    assert!(matches!(
        restore_capture("rec_types", 1, &capture).await.unwrap(),
        RestoreOutcome::Restored { .. }
    ));
    assert_eq!(
        scalar("SELECT qty::text FROM rec_types WHERE id = 1").await,
        json!("10.50")
    );
    assert_eq!(
        scalar("SELECT shipped FROM rec_types WHERE id = 1").await,
        json!(false)
    );
    assert_eq!(
        scalar("SELECT at = '2026-01-02 03:04:05+00'::timestamptz FROM rec_types WHERE id = 1")
            .await,
        json!(true)
    );
    assert_eq!(
        scalar("SELECT encode(data, 'hex') FROM rec_types WHERE id = 1").await,
        json!("deadbeef")
    );
    sql("DROP TABLE rec_types").await;
}

#[tokio::test]
#[ignore]
async fn test_restore_refuses_when_the_row_changed_since_the_save() {
    require_pg!();
    fresh_orders("rec_conflict").await;
    let capture = captured(
        save("rec_conflict", 1, vec![("status", json!("closed"))])
            .await
            .unwrap(),
    );
    sql("UPDATE rec_conflict SET status = 'shipped' WHERE id = 1").await;

    let outcome = restore_capture("rec_conflict", 1, &capture).await.unwrap();
    match outcome {
        RestoreOutcome::Conflict { current } => assert_eq!(current, vec![text("shipped")]),
        other => panic!("expected a conflict, got {other:?}"),
    }
    assert_eq!(
        scalar("SELECT status FROM rec_conflict WHERE id = 1").await,
        json!("shipped")
    );
    sql("DROP TABLE rec_conflict").await;
}

#[tokio::test]
#[ignore]
async fn test_restore_reports_deleted_and_moved_rows() {
    require_pg!();
    fresh_orders("rec_gone").await;
    let capture = captured(
        save("rec_gone", 1, vec![("status", json!("closed"))])
            .await
            .unwrap(),
    );

    sql("UPDATE rec_gone SET id = 100 WHERE id = 1").await;
    assert!(matches!(
        restore_capture("rec_gone", 1, &capture).await.unwrap(),
        RestoreOutcome::RowMissing
    ));
    sql("DELETE FROM rec_gone WHERE id = 100").await;
    assert!(matches!(
        restore_capture("rec_gone", 1, &capture).await.unwrap(),
        RestoreOutcome::RowMissing
    ));
    assert_eq!(
        PostgresDriver::new()
            .read_row_images(
                &pg_params(),
                "rec_gone",
                &key(1),
                &["status".to_string()],
                Some(SCHEMA)
            )
            .await
            .unwrap(),
        None
    );
    sql("DROP TABLE rec_gone").await;
}

#[tokio::test]
#[ignore]
async fn test_restore_check_holds_against_a_concurrent_writer() {
    require_pg!();
    fresh_orders("rec_race").await;
    let capture = captured(
        save("rec_race", 1, vec![("status", json!("closed"))])
            .await
            .unwrap(),
    );

    let (writer, connection) = tokio_postgres::connect(
        "host=127.0.0.1 port=54320 user=postgres password=password dbname=testdb",
        tokio_postgres::NoTls,
    )
    .await
    .unwrap();
    tokio::spawn(connection);
    writer.batch_execute("BEGIN").await.unwrap();
    writer
        .batch_execute("UPDATE rec_race SET status = 'shipped' WHERE id = 1")
        .await
        .unwrap();

    let pending = tokio::spawn({
        let columns = restore_columns_of(&capture);
        async move {
            let columns: Vec<RestoreColumn> = columns
                .into_iter()
                .map(|(name, expected, target)| RestoreColumn {
                    name,
                    expected,
                    target,
                })
                .collect();
            PostgresDriver::new()
                .restore_row_images(&pg_params(), "rec_race", &key(1), &columns, Some(SCHEMA))
                .await
        }
    });
    tokio::time::sleep(Duration::from_millis(700)).await;
    assert!(
        !pending.is_finished(),
        "the restore must wait for the row lock"
    );
    writer.batch_execute("COMMIT").await.unwrap();

    let outcome = pending.await.unwrap().unwrap();
    assert!(
        matches!(outcome, RestoreOutcome::Conflict { .. }),
        "the writer's committed value must be seen, got {outcome:?}"
    );
    assert_eq!(
        scalar("SELECT status FROM rec_race WHERE id = 1").await,
        json!("shipped")
    );
    sql("DROP TABLE rec_race").await;
}

#[tokio::test]
#[ignore]
async fn test_restore_gives_up_on_a_row_that_stays_locked() {
    require_pg!();
    fresh_orders("rec_locked").await;
    let capture = captured(
        save("rec_locked", 1, vec![("status", json!("closed"))])
            .await
            .unwrap(),
    );

    let (holder, connection) = tokio_postgres::connect(
        "host=127.0.0.1 port=54320 user=postgres password=password dbname=testdb",
        tokio_postgres::NoTls,
    )
    .await
    .unwrap();
    tokio::spawn(connection);
    holder.batch_execute("BEGIN").await.unwrap();
    holder
        .batch_execute("SELECT * FROM rec_locked WHERE id = 1 FOR UPDATE")
        .await
        .unwrap();

    let outcome = restore_capture("rec_locked", 1, &capture).await;
    holder.batch_execute("ROLLBACK").await.unwrap();
    let error = outcome.expect_err("a locked row must not hang the restore");
    assert!(error.contains("lock timeout"), "{error}");
    assert_eq!(
        scalar("SELECT status FROM rec_locked WHERE id = 1").await,
        json!("closed")
    );
    sql("DROP TABLE rec_locked").await;
}

#[tokio::test]
#[ignore]
async fn test_unsupported_targets_are_written_but_not_recorded() {
    require_pg!();
    fresh_orders("rec_target").await;
    sql("DROP VIEW IF EXISTS rec_target_view").await;
    sql("CREATE VIEW rec_target_view AS SELECT id, status FROM rec_target").await;
    sql("DROP TABLE IF EXISTS rec_nokey").await;
    sql("CREATE TABLE rec_nokey (id integer, status text)").await;
    sql("INSERT INTO rec_nokey VALUES (1, 'open')").await;

    let update = save("rec_target_view", 1, vec![("status", json!("via view"))])
        .await
        .unwrap();
    assert_eq!((update.affected, skipped(&update)), (1, "not_a_base_table"));
    assert_eq!(
        scalar("SELECT status FROM rec_target WHERE id = 1").await,
        json!("via view")
    );

    let update = save("rec_nokey", 1, vec![("status", json!("changed"))])
        .await
        .unwrap();
    assert_eq!((update.affected, skipped(&update)), (1, "no_primary_key"));

    let update = PostgresDriver::new()
        .update_row_recorded(
            &pg_params(),
            "rec_target",
            &HashMap::from([("status".to_string(), json!("via view"))]),
            vec![("qty".to_string(), json!(5))],
            Some(SCHEMA),
            MAX_BLOB,
        )
        .await
        .unwrap();
    assert_eq!(skipped(&update), "key_mismatch");

    let update = save("rec_target", 1, vec![("ghost", json!(1))]).await;
    assert!(
        update.is_err(),
        "an unknown column is an error, not a silent skip"
    );

    sql("DROP VIEW rec_target_view").await;
    sql("DROP TABLE rec_nokey").await;
    sql("DROP TABLE rec_target").await;
}

#[tokio::test]
#[ignore]
async fn test_a_missing_row_is_neither_written_nor_recorded() {
    require_pg!();
    fresh_orders("rec_absent").await;
    let update = save("rec_absent", 404, vec![("status", json!("x"))])
        .await
        .unwrap();
    assert_eq!((update.affected, skipped(&update)), (0, "row_missing"));
    sql("DROP TABLE rec_absent").await;
}

#[tokio::test]
#[ignore]
async fn test_changing_the_key_is_recorded_as_a_move_that_cannot_be_restored() {
    require_pg!();
    fresh_orders("rec_move").await;
    let capture = captured(save("rec_move", 1, vec![("id", json!(50))]).await.unwrap());
    assert!(capture.key_changed);
    assert_eq!(capture.columns[0].pre, text("1"));
    assert!(matches!(capture.columns[0].post, CellImage::Omitted { .. }));
    assert_eq!(
        scalar("SELECT count(*) FROM rec_move WHERE id = 50").await,
        json!(1)
    );
    sql("DROP TABLE rec_move").await;
}

#[tokio::test]
#[ignore]
async fn test_tables_with_triggers_and_generated_columns_are_flagged() {
    require_pg!();
    fresh_orders("rec_trigger").await;
    sql("DROP TABLE IF EXISTS rec_trigger_log").await;
    sql("CREATE TABLE rec_trigger_log (note text)").await;
    sql(
        "CREATE OR REPLACE FUNCTION rec_trigger_fn() RETURNS trigger AS $$ \
BEGIN INSERT INTO rec_trigger_log VALUES (NEW.status); RETURN NEW; END $$ LANGUAGE plpgsql",
    )
    .await;
    sql("CREATE TRIGGER rec_trigger_t AFTER UPDATE ON rec_trigger FOR EACH ROW EXECUTE FUNCTION rec_trigger_fn()").await;
    let capture = captured(
        save("rec_trigger", 1, vec![("status", json!("closed"))])
            .await
            .unwrap(),
    );
    assert!(capture.has_triggers);

    let refused = restore_capture("rec_trigger", 1, &capture).await;
    assert!(
        refused.is_err(),
        "a restore on a table with triggers is refused"
    );
    assert_eq!(
        scalar("SELECT status FROM rec_trigger WHERE id = 1").await,
        json!("closed")
    );

    sql("DROP TABLE rec_trigger CASCADE").await;
    sql("DROP TABLE rec_trigger_log").await;
    sql("DROP FUNCTION rec_trigger_fn()").await;

    sql("DROP TABLE IF EXISTS rec_gen").await;
    sql("CREATE TABLE rec_gen (id integer PRIMARY KEY, a integer, doubled integer GENERATED ALWAYS AS (a * 2) STORED)").await;
    sql("INSERT INTO rec_gen (id, a) VALUES (1, 2)").await;
    let capture = captured(save("rec_gen", 1, vec![("a", json!(5))]).await.unwrap());
    assert!(!capture.columns[0].generated);
    let refused = restore("rec_gen", 1, vec![("doubled", text("10"), text("4"))]).await;
    assert!(refused.is_err(), "a generated column is never written");
    sql("DROP TABLE rec_gen").await;
}

#[tokio::test]
#[ignore]
async fn test_values_over_the_capture_limit_are_withheld() {
    require_pg!();
    fresh_orders("rec_big").await;
    let big = "z".repeat(70_000);
    let capture = captured(
        save("rec_big", 1, vec![("note", json!(big))])
            .await
            .unwrap(),
    );
    assert_eq!(capture.columns[0].pre, CellImage::Null);
    assert!(matches!(capture.columns[0].post, CellImage::Omitted { .. }));
    assert_eq!(
        scalar("SELECT length(note) FROM rec_big WHERE id = 1").await,
        json!(70_000)
    );
    sql("DROP TABLE rec_big").await;
}

#[tokio::test]
#[ignore]
async fn test_a_failing_change_rolls_back_the_whole_row() {
    require_pg!();
    fresh_orders("rec_partial").await;
    let outcome = save(
        "rec_partial",
        1,
        vec![("status", json!("closed")), ("qty", json!("not a number"))],
    )
    .await;
    assert!(outcome.is_err());
    assert_eq!(
        scalar("SELECT status FROM rec_partial WHERE id = 1").await,
        json!("open")
    );
    assert_eq!(
        scalar("SELECT qty::text FROM rec_partial WHERE id = 1").await,
        json!("10.50")
    );
    sql("DROP TABLE rec_partial").await;
}

#[tokio::test]
#[ignore]
async fn test_a_failing_restore_changes_nothing() {
    require_pg!();
    fresh_orders("rec_badrestore").await;
    sql("UPDATE rec_badrestore SET status = 'closed' WHERE id = 1").await;
    let outcome = restore(
        "rec_badrestore",
        1,
        vec![
            ("status", text("closed"), text("open")),
            ("qty", text("10.50"), text("not a number")),
        ],
    )
    .await;
    assert!(outcome.is_err());
    assert_eq!(
        scalar("SELECT status FROM rec_badrestore WHERE id = 1").await,
        json!("closed")
    );
    assert_eq!(
        scalar("SELECT qty::text FROM rec_badrestore WHERE id = 1").await,
        json!("10.50")
    );

    let withheld = restore(
        "rec_badrestore",
        1,
        vec![(
            "status",
            text("closed"),
            CellImage::Omitted {
                reason: "too_large".into(),
            },
        )],
    )
    .await;
    assert!(
        withheld.is_err(),
        "a value that was never captured cannot be written"
    );
    sql("DROP TABLE rec_badrestore").await;
}

#[tokio::test]
#[ignore]
async fn test_composite_and_uuid_keys_address_exactly_one_row() {
    require_pg!();
    sql("DROP TABLE IF EXISTS rec_keys").await;
    sql("CREATE TABLE rec_keys (a integer, b uuid, v text, PRIMARY KEY (a, b))").await;
    sql(
        "INSERT INTO rec_keys VALUES (1, '11111111-1111-1111-1111-111111111111', 'x'), \
(1, '22222222-2222-2222-2222-222222222222', 'y')",
    )
    .await;
    let pk = HashMap::from([
        ("a".to_string(), json!(1)),
        (
            "b".to_string(),
            json!("22222222-2222-2222-2222-222222222222"),
        ),
    ]);
    let driver = PostgresDriver::new();
    let update = driver
        .update_row_recorded(
            &pg_params(),
            "rec_keys",
            &pk,
            vec![("v".to_string(), json!("z"))],
            Some(SCHEMA),
            MAX_BLOB,
        )
        .await
        .unwrap();
    let capture = captured(update);
    assert_eq!(
        (&capture.columns[0].pre, &capture.columns[0].post),
        (&text("y"), &text("z"))
    );
    let columns = vec![RestoreColumn {
        name: "v".into(),
        expected: text("z"),
        target: text("y"),
    }];
    assert!(matches!(
        driver
            .restore_row_images(&pg_params(), "rec_keys", &pk, &columns, Some(SCHEMA))
            .await
            .unwrap(),
        RestoreOutcome::Restored { affected: 1 }
    ));
    assert_eq!(
        scalar("SELECT string_agg(v, ',' ORDER BY b) FROM rec_keys").await,
        json!("x,y")
    );
    sql("DROP TABLE rec_keys").await;
}

mod application_flow {
    use super::*;
    use crate::table_transfer::runtime;
    use tabularis_lib::application::save_history::{
        apply_restore, delete, list, plan_restore, save_row, set_enabled, status, PlanStatus,
    };

    async fn change(
        runtime: &tabularis_lib::runtime::RuntimeContext,
        table: &str,
        id: i64,
        changes: Vec<(&str, Value)>,
    ) -> Result<tabularis_lib::application::save_history::RecordedSaveResponse, String> {
        save_row(
            runtime,
            None,
            "pg",
            table.to_string(),
            key(id),
            changes
                .into_iter()
                .map(|(name, value)| (name.to_string(), value))
                .collect(),
            Some(SCHEMA.to_string()),
            None,
        )
        .await
    }

    #[tokio::test]
    #[ignore]
    async fn test_recording_is_opt_in_and_a_save_can_be_reviewed_and_restored() {
        require_pg!();
        tabularis_lib::drivers::registry::register_driver(PostgresDriver::new()).await;
        fresh_orders("rec_flow").await;
        let temp = tempfile::tempdir().unwrap();
        let runtime = runtime(temp.path());

        let state = status(&runtime, None, "pg").await.unwrap();
        assert!(state.supported && !state.enabled);

        let unrecorded = change(&runtime, "rec_flow", 1, vec![("status", json!("a"))])
            .await
            .unwrap();
        assert_eq!(unrecorded.affected, 1);
        assert_eq!(
            unrecorded.skipped_reason.as_deref(),
            Some("recording_disabled")
        );
        assert!(list(&runtime, "pg", None, None, None).unwrap().is_empty());

        assert!(
            set_enabled(&runtime, None, "pg", true)
                .await
                .unwrap()
                .enabled
        );
        let saved = change(
            &runtime,
            "rec_flow",
            1,
            vec![("status", json!("closed")), ("note", json!("done"))],
        )
        .await
        .unwrap();
        assert_eq!(saved.affected, 2);
        let record_id = saved.record_id.expect("the save is recorded");

        let unchanged = change(&runtime, "rec_flow", 2, vec![("status", json!("open"))])
            .await
            .unwrap();
        assert_eq!(unchanged.skipped_reason.as_deref(), Some("unchanged"));

        let records = list(&runtime, "pg", Some("rec_flow".into()), None, None).unwrap();
        assert_eq!(records.len(), 1);
        assert!(records[0].restorable);
        assert_eq!(records[0].key["id"], json!(1));
        assert_eq!(records[0].schema.as_deref(), Some("public"));

        let plan = plan_restore(&runtime, None, "pg", &record_id)
            .await
            .unwrap();
        assert_eq!(plan.status, PlanStatus::Ready);
        assert_eq!(
            scalar("SELECT status FROM rec_flow WHERE id = 1").await,
            json!("closed")
        );

        sql("UPDATE rec_flow SET note = 'edited elsewhere' WHERE id = 1").await;
        let plan = plan_restore(&runtime, None, "pg", &record_id)
            .await
            .unwrap();
        assert_eq!(plan.status, PlanStatus::Conflict);
        let refused = apply_restore(&runtime, None, "pg", &record_id)
            .await
            .unwrap();
        assert_eq!(refused.status, PlanStatus::Conflict);
        assert_eq!(
            scalar("SELECT status FROM rec_flow WHERE id = 1").await,
            json!("closed")
        );

        sql("UPDATE rec_flow SET note = 'done' WHERE id = 1").await;
        let restored = apply_restore(&runtime, None, "pg", &record_id)
            .await
            .unwrap();
        assert_eq!(restored.status, PlanStatus::Restored);
        assert_eq!(
            scalar("SELECT status FROM rec_flow WHERE id = 1").await,
            json!("a")
        );
        assert_eq!(
            scalar("SELECT note IS NULL FROM rec_flow WHERE id = 1").await,
            json!(true)
        );

        let again = apply_restore(&runtime, None, "pg", &record_id)
            .await
            .unwrap();
        assert_eq!(again.status, PlanStatus::AlreadyRestored);

        assert_eq!(delete(&runtime, "pg", Some(&record_id)).unwrap(), 1);
        assert!(list(&runtime, "pg", None, None, None).unwrap().is_empty());
        sql("DROP TABLE rec_flow").await;
    }

    #[tokio::test]
    #[ignore]
    async fn test_saves_that_cannot_be_restored_are_kept_for_review_only() {
        require_pg!();
        tabularis_lib::drivers::registry::register_driver(PostgresDriver::new()).await;
        fresh_orders("rec_flow_move").await;
        let temp = tempfile::tempdir().unwrap();
        let runtime = runtime(temp.path());
        set_enabled(&runtime, None, "pg", true).await.unwrap();

        let saved = change(&runtime, "rec_flow_move", 1, vec![("id", json!(9))])
            .await
            .unwrap();
        let record_id = saved.record_id.expect("a moved row is still recorded");
        let record = &list(&runtime, "pg", None, None, None).unwrap()[0];
        assert!(!record.restorable);

        let plan = apply_restore(&runtime, None, "pg", &record_id)
            .await
            .unwrap();
        assert_eq!(plan.status, PlanStatus::NotRestorable);
        assert_eq!(
            scalar("SELECT count(*) FROM rec_flow_move WHERE id = 9").await,
            json!(1)
        );
        sql("DROP TABLE rec_flow_move").await;
    }
}
