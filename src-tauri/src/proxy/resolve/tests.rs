use super::*;
use crate::proxy::{ProxyScopeModes, TcpProxyMode};

fn endpoint(host: &str, port: u16) -> ProxyEndpoint {
    ProxyEndpoint {
        protocol: ProxyProtocol::Http,
        host: host.into(),
        port,
        username: None,
        password: None,
    }
}

fn global_on(scopes: &[&str]) -> GlobalProxySettings {
    let mut settings = GlobalProxySettings {
        endpoint: Some(endpoint("proxy.example", 8080)),
        ..Default::default()
    };
    for scope in scopes {
        match *scope {
            registry::SCOPE_APP_HTTP => settings.modes.app_http = HttpProxyMode::Custom,
            registry::SCOPE_AI => settings.modes.ai = HttpProxyMode::Custom,
            registry::SCOPE_DATABASE => settings.modes.database = TcpProxyMode::Custom,
            registry::SCOPE_SSH_TUNNEL => settings.modes.ssh_tunnel = TcpProxyMode::Custom,
            _ => panic!("unknown test proxy scope"),
        }
    }
    settings
}

#[test]
fn inherit_uses_global_when_scope_on() {
    let g = global_on(&[registry::SCOPE_APP_HTTP]);
    let got = resolve(&g, registry::SCOPE_APP_HTTP, None, None).unwrap();
    assert_eq!(got.host, "proxy.example");
    assert_eq!(got.port, 8080);
}

#[test]
fn inherit_skips_when_scope_off() {
    let g = global_on(&[registry::SCOPE_AI]);
    assert!(resolve(&g, registry::SCOPE_APP_HTTP, None, None).is_none());
}

#[test]
fn inherit_skips_when_global_scope_disabled() {
    let mut g = global_on(&[registry::SCOPE_APP_HTTP]);
    g.modes.app_http = HttpProxyMode::Disabled;
    assert!(resolve(&g, registry::SCOPE_APP_HTTP, None, None).is_none());
}

#[test]
fn disabled_beats_global() {
    let g = global_on(&[registry::SCOPE_DATABASE]);
    let ov = ProxyOverride {
        mode: ProxyMode::Disabled,
        endpoint: None,
    };
    assert!(resolve(&g, registry::SCOPE_DATABASE, Some(&ov), None).is_none());
}

#[test]
fn custom_beats_global() {
    let g = global_on(&[registry::SCOPE_DATABASE]);
    let ov = ProxyOverride {
        mode: ProxyMode::Custom,
        endpoint: Some(endpoint("custom.proxy", 1080)),
    };
    let got = resolve(&g, registry::SCOPE_DATABASE, Some(&ov), None).unwrap();
    assert_eq!(got.host, "custom.proxy");
    assert_eq!(got.port, 1080);
}

#[test]
fn custom_empty_host_yields_none() {
    let g = global_on(&[registry::SCOPE_AI]);
    let ov = ProxyOverride {
        mode: ProxyMode::Custom,
        endpoint: Some(endpoint("  ", 1080)),
    };
    assert!(resolve(&g, registry::SCOPE_AI, Some(&ov), None).is_none());
}

#[test]
fn proxy_url_http_and_socks5h() {
    let mut ep = endpoint("127.0.0.1", 7890);
    assert_eq!(endpoint_to_proxy_url(&ep).unwrap(), "http://127.0.0.1:7890");
    ep.protocol = ProxyProtocol::Socks5;
    ep.username = Some("u".into());
    ep.password = Some("p@ss".into());
    let url = endpoint_to_proxy_url(&ep).unwrap();
    assert!(url.starts_with("socks5h://u:p%40ss@127.0.0.1:7890"));
}

#[test]
fn proxy_url_brackets_ipv6_host() {
    let ep = ProxyEndpoint {
        protocol: ProxyProtocol::Http,
        host: "2001:db8::1".into(),
        port: 8080,
        username: None,
        password: None,
    };
    assert_eq!(
        endpoint_to_proxy_url(&ep).unwrap(),
        "http://[2001:db8::1]:8080"
    );
}

#[test]
fn new_http_config_uses_system_proxy_and_legacy_config_keeps_old_behavior() {
    assert_eq!(
        http_policy_from_settings(None, registry::SCOPE_APP_HTTP, None, None).unwrap(),
        HttpProxyPolicy::System
    );
    let legacy: GlobalProxySettings = serde_json::from_value(serde_json::json!({
        "enabled": true,
        "endpoint": {"protocol": "http", "host": "proxy.example", "port": 8080},
        "scopes": {"app_http": true, "ai": false, "database": true}
    }))
    .unwrap();
    assert!(matches!(
        http_policy_from_settings(Some(&legacy), registry::SCOPE_APP_HTTP, None, None).unwrap(),
        HttpProxyPolicy::Custom(_)
    ));
    assert_eq!(legacy.modes.ai, HttpProxyMode::Disabled);
    assert_eq!(legacy.modes.database, TcpProxyMode::Custom);
    let saved = serde_json::to_value(&legacy).unwrap();
    assert_eq!(saved["modes"]["app_http"], "custom");
    assert!(saved.get("enabled").is_none());
    assert!(saved.get("scopes").is_none());
    assert!(saved.get("appHttpMode").is_none());
    let restored: GlobalProxySettings = serde_json::from_value(saved).unwrap();
    assert_eq!(restored, legacy);
}

#[test]
fn explicit_http_modes_and_provider_override_take_precedence() {
    let mut global = global_on(&[registry::SCOPE_APP_HTTP]);
    global.modes.app_http = HttpProxyMode::System;
    global.modes.ai = HttpProxyMode::Custom;
    assert_eq!(
        http_policy_from_settings(Some(&global), registry::SCOPE_APP_HTTP, None, None).unwrap(),
        HttpProxyPolicy::System
    );
    let disabled = ProxyOverride {
        mode: ProxyMode::Disabled,
        endpoint: None,
    };
    assert_eq!(
        http_policy_from_settings(
            Some(&global),
            registry::SCOPE_AI,
            Some(&disabled),
            Some("proxy:ai:test"),
        )
        .unwrap(),
        HttpProxyPolicy::Disabled
    );
    global.modes.ai = HttpProxyMode::Disabled;
    let custom = ProxyOverride {
        mode: ProxyMode::Custom,
        endpoint: Some(endpoint("provider.proxy", 1080)),
    };
    let resolved = http_policy_from_settings(
        Some(&global),
        registry::SCOPE_AI,
        Some(&custom),
        Some("proxy:ai:test"),
    )
    .unwrap();
    assert!(matches!(
        resolved,
        HttpProxyPolicy::Custom(ProxyEndpoint { host, port: 1080, .. }) if host == "provider.proxy"
    ));
}

#[test]
fn incomplete_custom_proxy_fails_instead_of_bypassing_proxy() {
    let mut global = global_on(&[]);
    global.modes.app_http = HttpProxyMode::Custom;
    global.endpoint = None;
    assert!(
        http_policy_from_settings(Some(&global), registry::SCOPE_APP_HTTP, None, None)
            .unwrap_err()
            .contains("host and port")
    );
}

#[test]
fn transitional_config_is_migrated_without_duplicate_fields() {
    let config: GlobalProxySettings = serde_json::from_value(serde_json::json!({
        "enabled": true,
        "endpoint": {"protocol": "http", "host": "", "port": 7890},
        "scopes": {"app_http": false, "ai": false, "database": false, "ssh_tunnel": false},
        "appHttpMode": "system",
        "aiMode": "system"
    }))
    .unwrap();
    assert_eq!(config.modes, ProxyScopeModes::default());
    let saved = serde_json::to_value(config).unwrap();
    assert_eq!(saved["modes"]["app_http"], "system");
    assert_eq!(saved["modes"]["ssh_tunnel"], "disabled");
    assert!(saved.get("enabled").is_none());
    assert!(saved.get("scopes").is_none());
    assert!(saved.get("appHttpMode").is_none());
    assert!(saved.get("aiMode").is_none());
}

#[test]
fn empty_proxy_config_uses_new_defaults() {
    let config: GlobalProxySettings = serde_json::from_str("{}").unwrap();
    assert_eq!(config.modes, ProxyScopeModes::default());
}
