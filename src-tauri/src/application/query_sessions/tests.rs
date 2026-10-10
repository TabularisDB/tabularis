use super::*;

#[test]
fn tab_keys_are_isolated_by_browser_and_connection() {
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    assert_ne!(
        key(Some(first), "db", "tab"),
        key(Some(second), "db", "tab")
    );
    assert_ne!(
        key(Some(first), "db", "tab"),
        key(Some(first), "other", "tab")
    );
    assert_ne!(key(None, "db", "tab"), key(Some(first), "db", "tab"));
    assert_ne!(key(None, "a:b", "c"), key(None, "a", "b:c"));
}

#[tokio::test]
async fn owner_cleanup_preserves_other_browsers_and_desktop() {
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    let driver: Arc<dyn DatabaseDriver> = Arc::new(crate::drivers::sqlite::SqliteDriver::new());
    let own = register(Some(first), "db", "tab", driver.clone());
    let other = register(Some(second), "db", "tab", driver.clone());
    let desktop = register(None, "isolation-test-db", "tab", driver);
    clear_owner(first);
    {
        let sessions = sessions().lock().unwrap();
        assert!(!sessions.contains_key(&own));
        assert!(sessions.contains_key(&other));
        assert!(sessions.contains_key(&desktop));
    }
    take_matching(Some(second), None);
    take_matching(None, Some("isolation-test-db"));
}

#[test]
fn overlapping_read_completion_keeps_later_transaction_registered() {
    let root = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(crate::runtime::paths::FixedRuntimePaths::new(
            root.path().into(),
            root.path().into(),
        )),
        Arc::new(crate::runtime::events::NoopRuntimeEvents),
        Arc::new(crate::runtime::secrets::KeyringRuntimeSecrets),
    );
    let owner = Some(Uuid::new_v4());
    let driver: Arc<dyn DatabaseDriver> = Arc::new(crate::drivers::sqlite::SqliteDriver::new());
    let key = register(owner, "db", "tab", driver.clone());
    register(owner, "db", "tab", driver);
    report(&runtime, owner, "db", Some("tab"), false);
    assert_eq!(sessions().lock().unwrap()[&key].active_runs, 1);
    report(&runtime, owner, "db", Some("tab"), true);
    let released = take_matching(owner, Some("db"));
    assert_eq!(
        released.len(),
        1,
        "tab close must still find the pinned transaction"
    );
    assert_eq!(released[0].0, key);
}

#[test]
fn out_of_order_completions_keep_later_transaction_registered() {
    let root = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(crate::runtime::paths::FixedRuntimePaths::new(
            root.path().into(),
            root.path().into(),
        )),
        Arc::new(crate::runtime::events::NoopRuntimeEvents),
        Arc::new(crate::runtime::secrets::KeyringRuntimeSecrets),
    );
    let owner = Some(Uuid::new_v4());
    let driver: Arc<dyn DatabaseDriver> = Arc::new(crate::drivers::sqlite::SqliteDriver::new());
    let key = register(owner, "db", "tab", driver.clone());
    register(owner, "db", "tab", driver);
    report(&runtime, owner, "db", Some("tab"), true);
    assert_eq!(sessions().lock().unwrap()[&key].active_runs, 1);
    report(&runtime, owner, "db", Some("tab"), false);
    let released = take_matching(owner, Some("db"));
    assert_eq!(
        released.len(),
        1,
        "tab close must still find the pinned transaction"
    );
    assert_eq!(released[0].0, key);
}
