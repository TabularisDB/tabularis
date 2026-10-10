//! Unit tests for `session.rs`'s per-session lock. Pinning itself needs a
//! live connection and is covered by the postgres integration tests.

use super::{lock, sweep_idle};
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
