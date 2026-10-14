//! Unit tests for `session.rs`'s per-session lock. Pinning itself needs a
//! live connection and is covered by the postgres integration tests.

use super::{check_pinned_database, lock, sweep_idle, Slot};
use std::time::Duration;

#[tokio::test]
async fn a_second_run_for_the_same_session_waits_for_the_first() {
    let first = lock("session-tests-same").await;
    let second = tokio::spawn(async { drop(lock("session-tests-same").await) });

    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(
        !second.is_finished(),
        "overlapping run must wait for the lock"
    );

    drop(first);
    tokio::time::timeout(Duration::from_secs(1), second)
        .await
        .expect("second run proceeds once the first releases")
        .unwrap();
}

#[tokio::test]
async fn different_sessions_do_not_block_each_other() {
    let _a = lock("session-tests-a").await;
    tokio::time::timeout(Duration::from_secs(1), lock("session-tests-b"))
        .await
        .expect("another session must not wait");
}

#[tokio::test]
async fn sweep_keeps_a_slot_that_a_run_holds() {
    let held = lock("session-tests-held").await;
    sweep_idle().await;
    let waiter = tokio::spawn(async { drop(lock("session-tests-held").await) });
    tokio::time::sleep(Duration::from_millis(50)).await;
    // Had the sweep dropped the slot, the waiter would get a fresh one and not block.
    assert!(!waiter.is_finished());
    drop(held);
    waiter.await.unwrap();
}

#[tokio::test]
async fn sweep_forgets_a_slot_nothing_uses() {
    drop(lock("session-tests-unused").await);
    sweep_idle().await;
    assert!(!super::sessions()
        .lock()
        .await
        .contains_key("session-tests-unused"));
}

#[tokio::test]
async fn release_all_keeps_tracking_a_slot_a_run_holds() {
    let held = lock("session-tests-busy-shutdown").await;
    super::release_all().await;
    // The run would otherwise pin into a slot nothing tracks, and it would never be rolled back.
    assert!(super::sessions()
        .lock()
        .await
        .contains_key("session-tests-busy-shutdown"));
    drop(held);
}

#[test]
fn an_empty_slot_reports_no_pinned_database() {
    // A default slot holds no pinned connection, so `database()` returns
    // `None` — the mismatch guard in `execute_batch_in_session` treats this
    // as "no transaction open" and acquires a fresh client.
    let slot = Slot::default();
    assert!(slot.database().is_none());
}

#[test]
fn check_pinned_database_allows_a_matching_database() {
    // When the pinned and requested databases match, the run proceeds.
    assert_eq!(
        check_pinned_database(Some("orders"), "orders", "run"),
        Ok(())
    );
}

#[test]
fn check_pinned_database_rejects_a_mismatch_with_the_action_in_the_message() {
    // A mismatch names both databases and the action, so the user knows
    // whether the rejected operation was a run or an export. Both verbs are
    // exercised so a regression that hardcodes one verb is caught.
    let run_err = check_pinned_database(Some("orders"), "inventory", "run").unwrap_err();
    assert!(
        run_err.contains("cannot run on"),
        "error should use the 'run' action verb: {run_err}"
    );
    let export_err = check_pinned_database(Some("orders"), "inventory", "export").unwrap_err();
    assert!(
        export_err.contains("\"orders\""),
        "error should name the pinned database: {export_err}"
    );
    assert!(
        export_err.contains("\"inventory\""),
        "error should name the requested database: {export_err}"
    );
    assert!(
        export_err.contains("cannot export on"),
        "error should use the 'export' action verb: {export_err}"
    );
    assert!(
        export_err.contains("ROLLBACK or COMMIT"),
        "error should tell the user how to resolve it: {export_err}"
    );
}

#[test]
fn check_pinned_database_allows_any_database_when_nothing_is_pinned() {
    // `None` means no transaction is open, so the caller may acquire a fresh
    // connection on whatever database it was asked for.
    assert_eq!(check_pinned_database(None, "anything", "run"), Ok(()));
}
