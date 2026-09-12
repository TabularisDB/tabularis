use super::*;
use std::collections::HashMap;

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
    let mut map = HashMap::new();
    for s in scopes {
        map.insert((*s).to_string(), true);
    }
    GlobalProxySettings {
        enabled: true,
        endpoint: Some(endpoint("proxy.example", 8080)),
        scopes: map,
    }
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
fn inherit_skips_when_global_disabled() {
    let mut g = global_on(&[registry::SCOPE_APP_HTTP]);
    g.enabled = false;
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
    assert_eq!(
        endpoint_to_proxy_url(&ep).unwrap(),
        "http://127.0.0.1:7890"
    );
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
