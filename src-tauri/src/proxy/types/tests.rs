use super::*;
use serde_json::{json, Value};

fn migrate(value: Value) -> ProxyScopeModes {
    serde_json::from_value::<GlobalProxySettings>(value)
        .unwrap()
        .modes
}

#[test]
fn missing_legacy_http_scopes_use_system_defaults() {
    for scopes in [json!({}), json!({"database": true})] {
        let modes = migrate(json!({"enabled": true, "scopes": scopes}));
        assert_eq!(modes.app_http, HttpProxyMode::System);
        assert_eq!(modes.ai, HttpProxyMode::System);
        assert_eq!(modes.ssh_tunnel, TcpProxyMode::Disabled);
    }
}

#[test]
fn legacy_scope_choices_are_migrated_independently() {
    let modes = migrate(json!({
        "enabled": true,
        "scopes": {"app_http": true, "ai": false, "database": true}
    }));
    assert_eq!(modes.app_http, HttpProxyMode::Custom);
    assert_eq!(modes.ai, HttpProxyMode::Disabled);
    assert_eq!(modes.database, TcpProxyMode::Custom);
    assert_eq!(modes.ssh_tunnel, TcpProxyMode::Disabled);

    let modes = migrate(json!({
        "enabled": true,
        "scopes": {"app_http": false, "ai": true, "database": false, "ssh_tunnel": true}
    }));
    assert_eq!(modes.app_http, HttpProxyMode::Disabled);
    assert_eq!(modes.ai, HttpProxyMode::Custom);
    assert_eq!(modes.database, TcpProxyMode::Disabled);
    assert_eq!(modes.ssh_tunnel, TcpProxyMode::Custom);
}

#[test]
fn disabled_legacy_master_switch_uses_scope_defaults() {
    for value in [
        json!({"enabled": false}),
        json!({"enabled": false, "scopes": {}}),
        json!({
            "enabled": false,
            "scopes": {"app_http": false, "ai": false, "database": false, "ssh_tunnel": false}
        }),
        json!({
            "enabled": false,
            "scopes": {"app_http": true, "ai": true, "database": true, "ssh_tunnel": true}
        }),
        json!({"enabled": false, "scopes": {"app_http": true, "database": true}}),
    ] {
        assert_eq!(migrate(value), ProxyScopeModes::default());
    }
}

#[test]
fn explicit_disabled_mode_survives_save_and_reload() {
    let settings: GlobalProxySettings = serde_json::from_value(json!({
        "enabled": false,
        "modes": {
            "app_http": "disabled",
            "ai": "disabled",
            "database": "disabled",
            "ssh_tunnel": "disabled"
        }
    }))
    .unwrap();
    let saved = serde_json::to_value(&settings).unwrap();
    assert!(saved.get("enabled").is_none());
    let restored: GlobalProxySettings = serde_json::from_value(saved).unwrap();
    assert_eq!(restored, settings);
    assert_eq!(restored.modes.app_http, HttpProxyMode::Disabled);
    assert_eq!(restored.modes.ai, HttpProxyMode::Disabled);
}

#[test]
fn missing_legacy_master_switch_keeps_unselected_http_scopes_at_the_new_default() {
    let modes = migrate(json!({"scopes": {"app_http": false}}));
    assert_eq!(modes.app_http, HttpProxyMode::Disabled);
    assert_eq!(modes.ai, HttpProxyMode::System);
    let modes = migrate(json!({"scopes": {"app_http": true, "database": true}}));
    assert_eq!(modes.app_http, HttpProxyMode::Custom);
    assert_eq!(modes.database, TcpProxyMode::Custom);
}

#[test]
fn explicit_modes_take_precedence_over_legacy_switches() {
    let modes = ProxyScopeModes::default();
    assert_eq!(
        migrate(json!({
            "enabled": false,
            "scopes": {"app_http": true, "ai": false},
            "appHttpMode": "custom",
            "modes": modes
        })),
        modes
    );
    let modes = migrate(json!({"enabled": true, "appHttpMode": "disabled"}));
    assert_eq!(modes.app_http, HttpProxyMode::Disabled);
    assert_eq!(modes.ai, HttpProxyMode::System);
}
