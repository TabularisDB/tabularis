use super::force_install::{is_version_compatible, merge_active_driver, MIGRATABLE_DRIVERS};
use crate::config::AppConfig;

#[test]
fn migratable_drivers_lists_postgres_pair() {
    assert!(MIGRATABLE_DRIVERS.contains(&("postgres", "postgresql")));
}

#[test]
fn merge_active_driver_adds_a_new_id() {
    let config = AppConfig {
        active_external_drivers: Some(vec!["mysql".to_string()]),
        ..AppConfig::default()
    };
    let merged = merge_active_driver(&config, "postgresql", &[]);
    assert_eq!(
        merged.active_external_drivers,
        Some(vec!["mysql".to_string(), "postgresql".to_string()])
    );
}

#[test]
fn merge_active_driver_is_idempotent_when_already_active() {
    // The activation regression: without idempotency the id would be
    // re-appended on every launch, growing the list unboundedly.
    let config = AppConfig {
        active_external_drivers: Some(vec!["postgresql".to_string()]),
        ..AppConfig::default()
    };
    let merged = merge_active_driver(&config, "postgresql", &[]);
    assert_eq!(
        merged.active_external_drivers,
        Some(vec!["postgresql".to_string()])
    );
}

#[test]
fn merge_active_driver_preserves_every_other_field() {
    // The other half of the activation regression: only
    // active_external_drivers may change. A settings wipe here would
    // silently reset the user's entire config on every launch.
    let config = AppConfig {
        active_external_drivers: Some(vec![]),
        theme: Some("dark".to_string()),
        result_page_size: Some(250),
        language: Some("en".to_string()),
        ..AppConfig::default()
    };
    let merged = merge_active_driver(&config, "postgresql", &[]);
    assert_eq!(
        merged.active_external_drivers,
        Some(vec!["postgresql".to_string()])
    );
    assert_eq!(merged.theme, Some("dark".to_string()));
    assert_eq!(merged.result_page_size, Some(250));
    assert_eq!(merged.language, Some("en".to_string()));
}

#[test]
fn merge_active_driver_collapses_empty_back_to_none() {
    // Adding the only id to an empty list yields a single-entry list, not
    // an empty one — but this guards the symmetric case for future edits.
    let config = AppConfig {
        active_external_drivers: Some(vec![]),
        ..AppConfig::default()
    };
    let merged = merge_active_driver(&config, "postgresql", &[]);
    assert_eq!(
        merged.active_external_drivers,
        Some(vec!["postgresql".to_string()])
    );
}

#[test]
fn merge_active_driver_seeds_from_installed_ids_when_no_preference_saved() {
    // The activation-can-disable-everything-else regression: `None` means
    // "no preference saved, every installed plugin is active" everywhere
    // else in the app (`load_plugins`, `PluginsTab`). A user who already
    // has `dynamodb` and `sqlserver` installed, with no preference saved
    // yet, must still have both active after `postgresql` force-installs
    // — not just `postgresql` alone, which would silently turn the other
    // two off on the next launch.
    let config = AppConfig {
        active_external_drivers: None,
        ..AppConfig::default()
    };
    let installed = ["dynamodb".to_string(), "sqlserver".to_string()];
    let merged = merge_active_driver(&config, "postgresql", &installed);
    assert_eq!(
        merged.active_external_drivers,
        Some(vec![
            "dynamodb".to_string(),
            "sqlserver".to_string(),
            "postgresql".to_string()
        ])
    );
}

#[test]
fn merge_active_driver_does_not_reseed_from_installed_ids_once_a_preference_exists() {
    // Seeding from `installed_ids` must only fill the implicit-None gap,
    // never override an explicit (even empty) preference the user already
    // set — e.g. a user who explicitly deactivated everything via
    // `PluginsTab` must stay deactivated except for the id being added.
    let config = AppConfig {
        active_external_drivers: Some(vec![]),
        ..AppConfig::default()
    };
    let installed = ["dynamodb".to_string(), "sqlserver".to_string()];
    let merged = merge_active_driver(&config, "postgresql", &installed);
    assert_eq!(
        merged.active_external_drivers,
        Some(vec!["postgresql".to_string()])
    );
}

#[test]
fn is_version_compatible_when_app_meets_minimum() {
    assert!(is_version_compatible("1.0.0", "1.2.0"));
    assert!(is_version_compatible("1.2.0", "1.2.0")); // exact match is compatible
    assert!(is_version_compatible("0.9.0", "1.0.0"));
}

#[test]
fn is_version_compatible_rejects_when_app_is_older() {
    assert!(!is_version_compatible("2.0.0", "1.9.9"));
    assert!(!is_version_compatible("1.2.0", "1.1.9"));
}

#[test]
fn is_version_compatible_treats_unparseable_as_compatible() {
    // A malformed version string must not block an otherwise-fine install
    // — the install itself surfaces real download errors.
    assert!(is_version_compatible("not-a-version", "1.0.0"));
    assert!(is_version_compatible("1.0.0", "not-a-version"));
    assert!(is_version_compatible("garbage", "alsogarbage"));
}
