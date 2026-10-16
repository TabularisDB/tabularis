use super::*;
use crate::drivers::driver_trait::DriverCapabilities;

fn fake_manifest(id: &str) -> PluginManifest {
    PluginManifest {
        id: id.to_string(),
        name: id.to_string(),
        version: "0.0.0".to_string(),
        description: String::new(),
        default_port: None,
        capabilities: DriverCapabilities::default(),
        is_builtin: false,
        engine: None,
        paradigms: Vec::new(),
        default_username: String::new(),
        color: String::new(),
        icon: String::new(),
        settings: Vec::new(),
        ui_extensions: None,
        explain_parsers: None,
        type_mappings: HashMap::new(),
        deprecated: None,
    }
}

/// Uses a UI-only manifest, which needs no `DatabaseDriver` implementation,
/// to exercise `is_registered` without spinning up a fake driver process.
#[tokio::test]
async fn is_registered_reflects_manifest_registration() {
    let _guard = REGISTRY_TEST_LOCK.lock().await;
    let id = "__test_is_registered_manifest__";
    assert!(!is_registered(id).await);

    register_manifest(fake_manifest(id)).await;
    assert!(is_registered(id).await);

    unregister_manifest(id).await;
    assert!(!is_registered(id).await);
}

#[tokio::test]
async fn is_registered_is_false_for_an_unknown_id() {
    let _guard = REGISTRY_TEST_LOCK.lock().await;
    assert!(!is_registered("__test_is_registered_unknown__").await);
}

#[test]
fn drivers_to_unregister_removes_a_non_builtin_id_absent_from_active_ids() {
    let registered = vec![("postgresql".to_string(), false)];
    let active_ids: Vec<String> = Vec::new();
    assert_eq!(
        drivers_to_unregister(&registered, &active_ids),
        vec!["postgresql".to_string()]
    );
}

#[test]
fn drivers_to_unregister_keeps_a_non_builtin_id_present_in_active_ids() {
    let registered = vec![("postgresql".to_string(), false)];
    let active_ids = vec!["postgresql".to_string()];
    assert!(drivers_to_unregister(&registered, &active_ids).is_empty());
}

#[test]
fn drivers_to_unregister_never_removes_a_builtin_id_even_when_absent() {
    let registered = vec![("mysql".to_string(), true)];
    let active_ids: Vec<String> = Vec::new();
    assert!(drivers_to_unregister(&registered, &active_ids).is_empty());
}

#[test]
fn drivers_to_unregister_handles_a_mixed_registry() {
    let registered = vec![
        ("mysql".to_string(), true),
        ("postgresql".to_string(), false),
        ("dynamodb".to_string(), false),
    ];
    let active_ids = vec!["dynamodb".to_string()];
    assert_eq!(
        drivers_to_unregister(&registered, &active_ids),
        vec!["postgresql".to_string()]
    );
}

/// `None` means "no explicit preference saved" (see
/// `plugins::manager::load_plugins`'s doc comment) — every installed plugin
/// is implicitly active in that state, so a rescan must not unregister
/// anything.
#[tokio::test]
async fn reconcile_active_drivers_is_a_no_op_when_active_ids_is_none() {
    let _guard = REGISTRY_TEST_LOCK.lock().await;
    let id = "__test_reconcile_none__";
    register_manifest(fake_manifest(id)).await;

    let removed = reconcile_active_drivers(None).await;

    assert!(removed.is_empty());
    assert!(is_registered(id).await);

    unregister_manifest(id).await;
}

#[tokio::test]
async fn reconcile_active_drivers_removes_a_manifest_absent_from_an_explicit_empty_list() {
    let _guard = REGISTRY_TEST_LOCK.lock().await;
    let id = "__test_reconcile_empty__";
    register_manifest(fake_manifest(id)).await;

    let removed = reconcile_active_drivers(Some(&[])).await;

    assert_eq!(removed, vec![id.to_string()]);
    assert!(!is_registered(id).await);
}

#[tokio::test]
async fn reconcile_active_drivers_keeps_ids_present_in_the_active_list() {
    let _guard = REGISTRY_TEST_LOCK.lock().await;
    let kept_id = "__test_reconcile_kept__";
    let removed_id = "__test_reconcile_removed__";
    register_manifest(fake_manifest(kept_id)).await;
    register_manifest(fake_manifest(removed_id)).await;

    let removed = reconcile_active_drivers(Some(&[kept_id.to_string()])).await;

    assert_eq!(removed, vec![removed_id.to_string()]);
    assert!(is_registered(kept_id).await);
    assert!(!is_registered(removed_id).await);

    unregister_manifest(kept_id).await;
}

#[tokio::test]
async fn reconcile_active_drivers_never_removes_a_builtin_manifest() {
    let _guard = REGISTRY_TEST_LOCK.lock().await;
    let id = "__test_reconcile_builtin__";
    let mut manifest = fake_manifest(id);
    manifest.is_builtin = true;
    register_manifest(manifest).await;

    let removed = reconcile_active_drivers(Some(&[])).await;

    assert!(!removed.contains(&id.to_string()));
    assert!(is_registered(id).await);

    unregister_manifest(id).await;
}

#[test]
fn local_path_driver_flag_tracks_set_and_clear() {
    let id = "__test_local_path_driver__";
    assert!(!is_local_path_driver(id));

    set_local_path_driver(id, true);
    assert!(is_local_path_driver(id));

    set_local_path_driver(id, false);
    assert!(!is_local_path_driver(id));
}
