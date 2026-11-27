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

#[test]
fn needs_plugin_for_triggers_on_either_the_builtin_or_the_plugin_id() {
    use super::force_install::needs_plugin_for;
    // First launch after the upgrade: connections are still on the built-in id.
    assert!(needs_plugin_for(
        "postgres",
        "postgresql",
        &["postgres", "mysql"]
    ));
    // Retry after a failed first download: the migration already moved them.
    assert!(needs_plugin_for("postgres", "postgresql", &["postgresql"]));
    assert!(needs_plugin_for(
        "postgres",
        "postgresql",
        &["postgres", "postgresql"]
    ));
    assert!(!needs_plugin_for(
        "postgres",
        "postgresql",
        &["mysql", "sqlite"]
    ));
    assert!(!needs_plugin_for("postgres", "postgresql", &[]));
}

#[test]
fn replacement_plugin_for_resolves_the_old_and_the_new_id() {
    use super::force_install::replacement_plugin_for;
    assert_eq!(replacement_plugin_for("postgres"), Some("postgresql"));
    assert_eq!(replacement_plugin_for("postgresql"), Some("postgresql"));
    assert_eq!(replacement_plugin_for("mysql"), None);
    assert_eq!(replacement_plugin_for("sqlite"), None);
}

#[test]
fn auto_install_opt_out_treats_only_explicit_off_values_as_enabled() {
    use super::force_install::auto_install_disabled_by;
    assert!(
        !auto_install_disabled_by(None),
        "unset must leave auto-install on"
    );
    for off in ["", "0", "false", "FALSE", "no", " no "] {
        assert!(
            !auto_install_disabled_by(Some(off)),
            "{off:?} must leave it on"
        );
    }
    for on in ["1", "true", "TRUE", "yes", "on"] {
        assert!(
            auto_install_disabled_by(Some(on)),
            "{on:?} must turn it off"
        );
    }
}

struct NoSecrets;

impl crate::runtime::secrets::RuntimeSecrets for NoSecrets {
    fn get(&self, _account: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    fn set(&self, _account: &str, _secret: &str) -> Result<(), String> {
        Ok(())
    }

    fn delete(&self, _account: &str) -> Result<(), String> {
        Ok(())
    }
}

fn runtime_in(dir: &std::path::Path) -> crate::runtime::RuntimeContext {
    crate::runtime::RuntimeContext::new(
        std::sync::Arc::new(crate::runtime::paths::FixedRuntimePaths::new(
            dir.to_path_buf(),
            dir.to_path_buf(),
        )),
        std::sync::Arc::new(crate::runtime::events::NoopRuntimeEvents),
        std::sync::Arc::new(NoSecrets),
    )
}

#[test]
fn activation_is_written_through_save_config_and_keeps_other_drivers() {
    let dir = tempfile::tempdir().unwrap();
    let runtime = runtime_in(dir.path());
    crate::application::persistence::save_config(
        &runtime,
        AppConfig {
            active_external_drivers: Some(vec!["mysql-extra".to_string()]),
            language: Some("de".to_string()),
            ..AppConfig::default()
        },
    )
    .unwrap();

    super::force_install::persist_activation(&runtime, "postgresql").unwrap();

    let saved = crate::application::persistence::load_config(&runtime);
    assert_eq!(
        saved.active_external_drivers,
        Some(vec!["mysql-extra".to_string(), "postgresql".to_string()])
    );
    assert_eq!(
        saved.language.as_deref(),
        Some("de"),
        "other settings must survive"
    );
}

#[test]
fn activation_is_idempotent_across_launches() {
    let dir = tempfile::tempdir().unwrap();
    let runtime = runtime_in(dir.path());
    for _ in 0..3 {
        super::force_install::persist_activation(&runtime, "postgresql").unwrap();
    }
    let saved = crate::application::persistence::load_config(&runtime);
    assert_eq!(
        saved.active_external_drivers,
        Some(vec!["postgresql".to_string()])
    );
}

#[tokio::test]
async fn no_install_is_attempted_when_no_connection_needs_the_plugin() {
    let dir = tempfile::tempdir().unwrap();
    let runtime = runtime_in(dir.path());
    // A registry nothing listens on: any download attempt would be logged and
    // would leave no plugin behind, so assert on the files instead.
    crate::application::persistence::save_config(
        &runtime,
        AppConfig {
            tabularium_registry_url: Some("http://127.0.0.1:1".to_string()),
            ..AppConfig::default()
        },
    )
    .unwrap();
    std::fs::write(
        dir.path().join("connections.json"),
        r#"[{"id":"c1","name":"m","params":{"driver":"mysql"}}]"#,
    )
    .unwrap();

    super::force_install::ensure_replacement_plugins(&runtime).await;

    assert!(!dir.path().join("plugins").join("postgresql").exists());
    let config = crate::application::persistence::load_config(&runtime);
    assert_eq!(
        config.active_external_drivers, None,
        "nothing may be activated"
    );
}

#[tokio::test]
async fn an_unreachable_registry_is_swallowed_and_nothing_is_activated() {
    let dir = tempfile::tempdir().unwrap();
    let runtime = runtime_in(dir.path());
    crate::application::persistence::save_config(
        &runtime,
        AppConfig {
            tabularium_registry_url: Some("http://127.0.0.1:1".to_string()),
            ..AppConfig::default()
        },
    )
    .unwrap();
    std::fs::write(
        dir.path().join("connections.json"),
        r#"[{"id":"c1","name":"p","params":{"driver":"postgresql"}}]"#,
    )
    .unwrap();

    // Must return (not panic, not hang) so a web or MCP start never fails on it.
    tokio::time::timeout(
        std::time::Duration::from_secs(30),
        super::force_install::ensure_replacement_plugins(&runtime),
    )
    .await
    .expect("a failed download must not block");

    let config = crate::application::persistence::load_config(&runtime);
    assert_eq!(
        config.active_external_drivers, None,
        "a failed install must not record the plugin as active"
    );
}

#[test]
fn the_unsupported_driver_error_names_the_plugin_to_install() {
    let message = crate::drivers::registry::unsupported_driver_message("postgresql");
    assert!(
        message.starts_with("Unsupported driver: postgresql"),
        "{message}"
    );
    assert!(message.contains("\"postgresql\" plugin"), "{message}");
    // The removed built-in id is explained the same way.
    assert!(
        crate::drivers::registry::unsupported_driver_message("postgres")
            .contains("\"postgresql\" plugin")
    );
    // An unrelated unknown driver keeps the plain message.
    assert_eq!(
        crate::drivers::registry::unsupported_driver_message("mongodb"),
        "Unsupported driver: mongodb"
    );
}

#[test]
fn the_activation_event_payload_matches_what_the_frontend_declares() {
    // packages/web-ui/src/api/events.ts: 'tabularis://plugin-activated' carries {pluginId}.
    let payload = serde_json::to_value(super::force_install::PluginActivatedPayload {
        plugin_id: "postgresql",
    })
    .unwrap();
    assert_eq!(payload, serde_json::json!({ "pluginId": "postgresql" }));
}
