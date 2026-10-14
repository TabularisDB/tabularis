use super::*;
use crate::config::PluginConfig;

fn config_with(global: Option<u32>, overrides: &[(&str, Option<u32>)]) -> AppConfig {
    let plugins = overrides
        .iter()
        .map(|(id, seconds)| {
            (
                id.to_string(),
                PluginConfig {
                    shutdown_grace_seconds: *seconds,
                    ..PluginConfig::default()
                },
            )
        })
        .collect();
    AppConfig {
        plugin_shutdown_grace_seconds: global,
        plugins: Some(plugins),
        ..AppConfig::default()
    }
}

#[test]
fn falls_back_to_default_when_nothing_is_configured() {
    let settings = ShutdownGraceSettings::from_config(&AppConfig::default());
    assert_eq!(
        settings.resolve("postgresql"),
        Some(DEFAULT_PLUGIN_SHUTDOWN_GRACE)
    );
    assert_eq!(DEFAULT_PLUGIN_SHUTDOWN_GRACE, Duration::from_secs(2));
}

#[test]
fn global_setting_applies_to_every_plugin() {
    let settings = ShutdownGraceSettings::from_config(&config_with(Some(30), &[]));
    assert_eq!(
        settings.resolve("postgresql"),
        Some(Duration::from_secs(30))
    );
    assert_eq!(settings.resolve("duckdb"), Some(Duration::from_secs(30)));
}

#[test]
fn plugin_override_wins_over_global() {
    let settings = ShutdownGraceSettings::from_config(&config_with(
        Some(30),
        &[("postgresql", Some(8)), ("duckdb", None)],
    ));
    assert_eq!(settings.resolve("postgresql"), Some(Duration::from_secs(8)));
    // A plugin entry without an override inherits the global value.
    assert_eq!(settings.resolve("duckdb"), Some(Duration::from_secs(30)));
}

#[test]
fn zero_is_clamped_to_the_minimum_grace() {
    let settings = ShutdownGraceSettings::from_config(&config_with(Some(0), &[]));
    assert_eq!(
        settings.resolve("postgresql"),
        Some(Duration::from_secs(MIN_PLUGIN_SHUTDOWN_GRACE_SECS as u64))
    );

    let settings =
        ShutdownGraceSettings::from_config(&config_with(Some(15), &[("postgresql", Some(0))]));
    assert_eq!(
        settings.resolve("postgresql"),
        Some(Duration::from_secs(MIN_PLUGIN_SHUTDOWN_GRACE_SECS as u64))
    );
    assert_eq!(settings.resolve("duckdb"), Some(Duration::from_secs(15)));
}

#[test]
fn plugin_override_wins_when_global_is_clamped() {
    let settings =
        ShutdownGraceSettings::from_config(&config_with(Some(0), &[("postgresql", Some(12))]));
    assert_eq!(
        settings.resolve("postgresql"),
        Some(Duration::from_secs(12))
    );
    assert_eq!(
        settings.resolve("duckdb"),
        Some(Duration::from_secs(MIN_PLUGIN_SHUTDOWN_GRACE_SECS as u64))
    );
}

#[test]
fn deserializes_camel_case_config_keys() {
    let config: AppConfig = serde_json::from_value(serde_json::json!({
        "pluginShutdownGraceSeconds": 45,
        "plugins": { "postgresql": { "shutdownGraceSeconds": 0 } }
    }))
    .unwrap();
    let settings = ShutdownGraceSettings::from_config(&config);
    assert_eq!(
        settings.resolve("postgresql"),
        Some(Duration::from_secs(MIN_PLUGIN_SHUTDOWN_GRACE_SECS as u64))
    );
    assert_eq!(settings.resolve("duckdb"), Some(Duration::from_secs(45)));
}

#[test]
fn missing_keys_keep_the_two_second_default() {
    let config: AppConfig = serde_json::from_value(serde_json::json!({
        "pluginCallTimeoutSeconds": 120
    }))
    .unwrap();
    assert_eq!(config.plugin_shutdown_grace_seconds, None);
    let settings = ShutdownGraceSettings::from_config(&config);
    assert_eq!(settings.resolve("postgresql"), Some(Duration::from_secs(2)));
}

#[test]
fn dropped_signal_uses_the_global_setting() {
    let settings = ShutdownGraceSettings::from_config(&config_with(Some(30), &[("pg", Some(5))]));
    assert_eq!(settings.dropped_signal_grace(), Duration::from_secs(30));
}

#[test]
fn dropped_signal_stays_bounded_when_global_is_unset_or_zero() {
    let unset = ShutdownGraceSettings::from_config(&AppConfig::default());
    assert_eq!(unset.dropped_signal_grace(), DEFAULT_PLUGIN_SHUTDOWN_GRACE);
    let zero = ShutdownGraceSettings::from_config(&config_with(Some(0), &[]));
    assert_eq!(
        zero.dropped_signal_grace(),
        Duration::from_secs(MIN_PLUGIN_SHUTDOWN_GRACE_SECS as u64)
    );
}
