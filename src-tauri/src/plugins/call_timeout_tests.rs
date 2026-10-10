use super::*;
use crate::config::PluginConfig;

fn config_with(global: Option<u32>, overrides: &[(&str, Option<u32>)]) -> AppConfig {
    let plugins = overrides
        .iter()
        .map(|(id, seconds)| {
            (
                id.to_string(),
                PluginConfig {
                    call_timeout_seconds: *seconds,
                    ..PluginConfig::default()
                },
            )
        })
        .collect();
    AppConfig {
        plugin_call_timeout_seconds: global,
        plugins: Some(plugins),
        ..AppConfig::default()
    }
}

#[test]
fn falls_back_to_default_when_nothing_is_configured() {
    let settings = CallTimeoutSettings::from_config(&AppConfig::default());
    assert_eq!(
        settings.resolve("postgresql"),
        Some(Duration::from_secs(u64::from(
            DEFAULT_PLUGIN_CALL_TIMEOUT_SECS
        )))
    );
}

#[test]
fn global_setting_applies_to_every_plugin() {
    let settings = CallTimeoutSettings::from_config(&config_with(Some(600), &[]));
    assert_eq!(
        settings.resolve("postgresql"),
        Some(Duration::from_secs(600))
    );
    assert_eq!(settings.resolve("duckdb"), Some(Duration::from_secs(600)));
}

#[test]
fn plugin_override_wins_over_global() {
    let settings = CallTimeoutSettings::from_config(&config_with(
        Some(600),
        &[("postgresql", Some(30)), ("duckdb", None)],
    ));
    assert_eq!(
        settings.resolve("postgresql"),
        Some(Duration::from_secs(30))
    );
    // A plugin entry without an override inherits the global value.
    assert_eq!(settings.resolve("duckdb"), Some(Duration::from_secs(600)));
}

#[test]
fn zero_disables_the_timeout() {
    let settings = CallTimeoutSettings::from_config(&config_with(Some(0), &[]));
    assert_eq!(settings.resolve("postgresql"), None);

    let settings =
        CallTimeoutSettings::from_config(&config_with(Some(60), &[("postgresql", Some(0))]));
    assert_eq!(settings.resolve("postgresql"), None);
    assert_eq!(settings.resolve("duckdb"), Some(Duration::from_secs(60)));
}

#[test]
fn plugin_override_can_restore_a_limit_when_global_is_disabled() {
    let settings =
        CallTimeoutSettings::from_config(&config_with(Some(0), &[("postgresql", Some(45))]));
    assert_eq!(
        settings.resolve("postgresql"),
        Some(Duration::from_secs(45))
    );
    assert_eq!(settings.resolve("duckdb"), None);
}

#[test]
fn deserializes_camel_case_config_keys() {
    let config: AppConfig = serde_json::from_value(serde_json::json!({
        "pluginCallTimeoutSeconds": 300,
        "plugins": { "postgresql": { "callTimeoutSeconds": 0 } }
    }))
    .unwrap();
    let settings = CallTimeoutSettings::from_config(&config);
    assert_eq!(settings.resolve("postgresql"), None);
    assert_eq!(settings.resolve("duckdb"), Some(Duration::from_secs(300)));
}
