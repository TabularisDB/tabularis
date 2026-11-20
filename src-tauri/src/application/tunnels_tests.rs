use super::*;
use crate::models::DatabaseSelection;
use crate::runtime::events::NoopRuntimeEvents;
use crate::runtime::paths::FixedRuntimePaths;
use crate::runtime::secrets::RuntimeSecrets;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct MemorySecrets {
    values: Mutex<HashMap<String, String>>,
}

impl RuntimeSecrets for MemorySecrets {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.values.lock().unwrap().get(account).cloned())
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        self.values
            .lock()
            .unwrap()
            .insert(account.to_string(), secret.to_string());
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        self.values.lock().unwrap().remove(account);
        Ok(())
    }
}

fn fixture() -> (tempfile::TempDir, RuntimeContext) {
    let temp = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().to_path_buf(),
            temp.path().to_path_buf(),
        )),
        Arc::new(NoopRuntimeEvents),
        Arc::new(MemorySecrets::default()),
    );
    (temp, runtime)
}

fn ssh_input() -> SshConnectionInput {
    SshConnectionInput {
        host: "bastion.example.com".to_string(),
        port: 22,
        user: "browser-user".to_string(),
        auth_type: "password".to_string(),
        password: Some("stored-password".to_string()),
        key_file: None,
        key_passphrase: Some("stored-passphrase".to_string()),
        allow_passphrase_prompt: Some(true),
        save_in_keychain: Some(true),
    }
}

#[test]
fn ssh_profile_secrets_are_write_only_for_web_responses() {
    let (_temp, runtime) = fixture();
    let saved = save_ssh_connection(
        &runtime,
        "Production bastion".to_string(),
        ssh_input(),
        false,
    )
    .unwrap();

    assert!(saved.password.is_none());
    assert!(saved.key_passphrase.is_none());
    let persisted: Vec<SshConnection> = load_json(&ssh_path(&runtime)).unwrap();
    assert!(persisted[0].password.is_none());
    assert!(persisted[0].key_passphrase.is_none());
    assert_eq!(
        runtime
            .secrets
            .get(&secret_account(&saved.id, SSH_SECRET_SUFFIX))
            .unwrap()
            .as_deref(),
        Some("stored-password")
    );

    let desktop = get_ssh_connections(&runtime, true).unwrap();
    assert_eq!(desktop[0].password.as_deref(), Some("stored-password"));
    let web = get_ssh_connections(&runtime, false).unwrap();
    assert!(web[0].password.is_none());
}

#[test]
fn saved_tunnel_profiles_expand_without_exposing_secrets() {
    let (_temp, runtime) = fixture();
    let ssh = save_ssh_connection(
        &runtime,
        "Production bastion".to_string(),
        ssh_input(),
        false,
    )
    .unwrap();
    let k8s = save_k8s_connection(
        &runtime,
        K8sConnectionInput {
            name: "Production cluster".to_string(),
            context: "prod".to_string(),
            namespace: "database".to_string(),
            resource_type: "service".to_string(),
            resource_name: "postgres".to_string(),
            port: 5432,
            kubectl_path: None,
            kubeconfig_path: None,
        },
    )
    .unwrap();

    let ssh_params = expand_connection_params(
        &runtime,
        &ConnectionParams {
            driver: "postgres".to_string(),
            database: DatabaseSelection::Single("app".to_string()),
            ssh_enabled: Some(true),
            ssh_connection_id: Some(ssh.id),
            ..ConnectionParams::default()
        },
    )
    .unwrap();
    assert_eq!(ssh_params.ssh_host.as_deref(), Some("bastion.example.com"));
    assert_eq!(ssh_params.ssh_password.as_deref(), Some("stored-password"));

    let k8s_params = expand_connection_params(
        &runtime,
        &ConnectionParams {
            driver: "postgres".to_string(),
            database: DatabaseSelection::Single("app".to_string()),
            k8s_enabled: Some(true),
            k8s_connection_id: Some(k8s.id),
            ..ConnectionParams::default()
        },
    )
    .unwrap();
    assert_eq!(k8s_params.k8s_context.as_deref(), Some("prod"));
    assert_eq!(k8s_params.k8s_resource_name.as_deref(), Some("postgres"));
}

#[test]
fn ssh_tests_restore_inline_plaintext_secrets_from_saved_database_connections() {
    let (_temp, runtime) = fixture();
    let file = crate::models::ConnectionsFile {
        connections: vec![crate::models::SavedConnection {
            id: "database-1".to_string(),
            name: "Database".to_string(),
            params: ConnectionParams {
                driver: "postgres".to_string(),
                database: DatabaseSelection::Single("app".to_string()),
                ssh_password: Some("inline-password".to_string()),
                ssh_key_passphrase: Some("inline-passphrase".to_string()),
                save_in_keychain: Some(false),
                ..ConnectionParams::default()
            },
            plugin_secret_keys: Vec::new(),
            group_id: None,
            sort_order: None,
            detect_json_in_text_columns: None,
            appearance: None,
            tag_ids: None,
            environment: None,
            managed: false,
        }],
        ..crate::models::ConnectionsFile::default()
    };
    crate::persistence::save_connections_file(&runtime.paths.connections_file(), &file).unwrap();
    let mut test = SshTestParams {
        host: "bastion.example.com".to_string(),
        port: 22,
        user: "browser-user".to_string(),
        password: None,
        key_file: None,
        key_passphrase: None,
        allow_passphrase_prompt: None,
        connection_id: None,
        db_connection_id: Some("database-1".to_string()),
        progress_id: None,
    };

    restore_ssh_test_secrets(&runtime, &mut test).unwrap();

    assert_eq!(test.password.as_deref(), Some("inline-password"));
    assert_eq!(test.key_passphrase.as_deref(), Some("inline-passphrase"));
}

#[test]
fn profile_validation_rejects_invalid_inputs() {
    let (_temp, runtime) = fixture();
    let mut ssh = ssh_input();
    ssh.auth_type = "agent".to_string();
    assert!(
        save_ssh_connection(&runtime, "Invalid".to_string(), ssh, false)
            .unwrap_err()
            .contains("password or ssh_key")
    );

    let error = save_k8s_connection(
        &runtime,
        K8sConnectionInput {
            name: "Invalid".to_string(),
            context: "prod".to_string(),
            namespace: "database".to_string(),
            resource_type: "deployment".to_string(),
            resource_name: "postgres".to_string(),
            port: 5432,
            kubectl_path: None,
            kubeconfig_path: None,
        },
    )
    .unwrap_err();
    assert_eq!(error, "Invalid Kubernetes connection profile");
}

#[cfg(unix)]
#[test]
fn ssh_profile_create_and_update_keep_plaintext_secrets_private() {
    use std::os::unix::fs::PermissionsExt;
    let (_temp, runtime) = fixture();
    let mut input = ssh_input();
    input.save_in_keychain = Some(false);
    let saved = save_ssh_connection(&runtime, "Private".into(), input.clone(), true).unwrap();
    let path = ssh_path(&runtime);
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    update_ssh_connection(&runtime, saved.id, "Updated".into(), input, true).unwrap();
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert!(fs::read_to_string(path)
        .unwrap()
        .contains("stored-password"));
}

fn uri_params(uri: Option<&str>) -> ConnectionParams {
    ConnectionParams {
        driver: "mongodb".to_string(),
        host: Some("cluster.example.mongodb.net".to_string()),
        port: Some(27017),
        connection_uri: uri.map(str::to_string),
        ..ConnectionParams::default()
    }
}

const SRV_URI: &str = "mongodb+srv://u:p@cluster.example.mongodb.net/admin";

/// SSH-enabled params for `driver` through the bastion `ssh_host`. Each test
/// uses its own bastion so the shared tunnel cache does not leak between
/// tests running in parallel.
fn ssh_params(driver: &str, ssh_host: &str, uri: &str) -> ConnectionParams {
    ConnectionParams {
        driver: driver.to_string(),
        connection_uri: Some(uri.to_string()),
        ssh_enabled: Some(true),
        ssh_host: Some(ssh_host.to_string()),
        ssh_port: Some(22),
        ssh_user: Some("user".to_string()),
        ssh_password: Some("password".to_string()),
        ..uri_params(None)
    }
}

fn credentials() -> crate::ssh_socks5::Credentials {
    crate::ssh_socks5::Credentials {
        username: "tabularis-user".to_string(),
        password: "tabularis-secret".to_string(),
    }
}

fn cache(key: &str, tunnel: crate::ssh_tunnel::SshTunnel) {
    crate::ssh_tunnel::get_tunnels()
        .lock()
        .unwrap()
        .insert(key.to_string(), tunnel);
}

fn cached_port(key: &str) -> Option<u16> {
    crate::ssh_tunnel::get_tunnels()
        .lock()
        .unwrap()
        .get(key)
        .map(|t| t.local_port)
}

fn forget(key: &str) {
    crate::ssh_tunnel::get_tunnels().lock().unwrap().remove(key);
}

#[test]
fn fixed_tunnel_rewrites_host_and_port() {
    let tunnel = crate::ssh_tunnel::SshTunnel::russh_for_test(40000, true, None);
    let target = crate::ssh_tunnel::ForwardTarget::Fixed {
        host: "cluster.example.mongodb.net".to_string(),
        port: 27017,
    };
    let resolved = point_at_tunnel(&uri_params(None), &tunnel, &target);

    assert_eq!(resolved.host.as_deref(), Some("127.0.0.1"));
    assert_eq!(resolved.port, Some(40000));
    assert_eq!(resolved.socks5_proxy_host, None);
    assert_eq!(resolved.socks5_proxy_port, None);
}

#[test]
fn socks5_tunnel_leaves_host_and_port_and_sets_the_proxy_with_credentials() {
    let tunnel = crate::ssh_tunnel::SshTunnel::russh_for_test(40000, true, Some(credentials()));
    let resolved = point_at_tunnel(
        &uri_params(Some(SRV_URI)),
        &tunnel,
        &crate::ssh_tunnel::ForwardTarget::Socks5,
    );

    assert_eq!(
        resolved.host.as_deref(),
        Some("cluster.example.mongodb.net")
    );
    assert_eq!(resolved.port, Some(27017));
    assert_eq!(resolved.connection_uri.as_deref(), Some(SRV_URI));
    assert_eq!(resolved.socks5_proxy_host.as_deref(), Some("127.0.0.1"));
    assert_eq!(resolved.socks5_proxy_port, Some(40000));
    assert_eq!(
        resolved.socks5_proxy_username.as_deref(),
        Some("tabularis-user")
    );
    assert_eq!(
        resolved.socks5_proxy_password.as_deref(),
        Some("tabularis-secret")
    );
}

#[test]
fn socks5_tunnel_without_credentials_sends_none() {
    // System `ssh -D` cannot authenticate clients.
    let tunnel = crate::ssh_tunnel::SshTunnel::russh_for_test(40000, true, None);
    let resolved = point_at_tunnel(
        &uri_params(Some(SRV_URI)),
        &tunnel,
        &crate::ssh_tunnel::ForwardTarget::Socks5,
    );

    assert_eq!(resolved.socks5_proxy_port, Some(40000));
    assert_eq!(resolved.socks5_proxy_username, None);
    assert_eq!(resolved.socks5_proxy_password, None);
}

#[test]
fn socks5_proxy_fields_are_omitted_from_json_when_unset() {
    let json = serde_json::to_value(uri_params(None)).unwrap();

    for field in [
        "socks5_proxy_host",
        "socks5_proxy_port",
        "socks5_proxy_username",
        "socks5_proxy_password",
    ] {
        assert!(json.get(field).is_none(), "{field}");
    }
}

fn base_params() -> ConnectionParams {
    ConnectionParams {
        driver: "mysql".to_string(),
        host: Some("localhost".to_string()),
        port: Some(3306),
        database: DatabaseSelection::Single("testdb".to_string()),
        username: Some("root".to_string()),
        ssh_enabled: Some(true),
        ssh_host: Some("bastion.example.com".to_string()),
        ssh_port: Some(22),
        ssh_user: Some("jump".to_string()),
        ..ConnectionParams::default()
    }
}

#[test]
fn socks5_proxy_capability_selects_the_dynamic_forward() {
    let driver = "__test_socks5_capability_driver__";
    let ssh_host = "socks5-capability.bastion.test";
    let key = crate::ssh_tunnel::build_socks5_tunnel_key("user", ssh_host, 22);
    cache(
        &key,
        crate::ssh_tunnel::SshTunnel::russh_for_test(41001, true, Some(credentials())),
    );
    crate::drivers::registry::set_socks5_proxy_driver(driver, true);

    let resolved = resolve_ssh_params(&ssh_params(driver, ssh_host, SRV_URI), None);

    crate::drivers::registry::set_socks5_proxy_driver(driver, false);
    forget(&key);
    let resolved = resolved.unwrap();
    assert_eq!(resolved.socks5_proxy_port, Some(41001));
    assert_eq!(
        resolved.host.as_deref(),
        Some("cluster.example.mongodb.net")
    );
}

#[test]
fn forward_destination_defaults_to_tcp() {
    let target = ssh_forward_target(&base_params());
    assert_eq!(
        target,
        crate::ssh_tunnel::ForwardTarget::Fixed {
            host: "localhost".to_string(),
            port: 3306,
        }
    );
}

#[test]
fn a_uri_without_the_capability_keeps_the_fixed_forward() {
    let driver = "__test_uri_without_socks5_driver__";
    let ssh_host = "fixed-forward.bastion.test";
    let key = crate::ssh_tunnel::build_tunnel_key(
        "user",
        ssh_host,
        22,
        &crate::ssh_tunnel::ForwardTarget::Fixed {
            host: "cluster.example.mongodb.net".to_string(),
            port: 27017,
        },
    );
    cache(
        &key,
        crate::ssh_tunnel::SshTunnel::russh_for_test(41002, true, None),
    );

    let resolved = resolve_ssh_params(&ssh_params(driver, ssh_host, SRV_URI), None);

    forget(&key);
    let resolved = resolved.unwrap();
    assert_eq!(resolved.host.as_deref(), Some("127.0.0.1"));
    assert_eq!(resolved.port, Some(41002));
    assert_eq!(resolved.socks5_proxy_host, None);
}

#[test]
fn two_connections_through_one_bastion_share_the_socks5_tunnel() {
    let driver = "__test_socks5_shared_driver__";
    let ssh_host = "shared.bastion.test";
    let key = crate::ssh_tunnel::build_socks5_tunnel_key("user", ssh_host, 22);
    cache(
        &key,
        crate::ssh_tunnel::SshTunnel::russh_for_test(41003, true, Some(credentials())),
    );
    crate::drivers::registry::set_socks5_proxy_driver(driver, true);

    let first = resolve_ssh_params(
        &ssh_params(driver, ssh_host, "mongodb+srv://a:p@one.example.net/"),
        None,
    );
    let second = resolve_ssh_params(
        &ssh_params(driver, ssh_host, "mongodb://b:p@h1:27017,h2:27017/db"),
        None,
    );

    crate::drivers::registry::set_socks5_proxy_driver(driver, false);
    let still_cached = cached_port(&key);
    forget(&key);
    let (first, second) = (first.unwrap(), second.unwrap());
    assert_eq!(first.socks5_proxy_port, Some(41003));
    assert_eq!(second.socks5_proxy_port, Some(41003));
    assert_eq!(first.socks5_proxy_password, second.socks5_proxy_password);
    assert_eq!(still_cached, Some(41003));
}

#[test]
fn a_dead_cached_tunnel_is_discarded_and_reopened() {
    // The bastion is unreachable, so reopening fails; what matters is that
    // the dead tunnel's port is not handed out again.
    let driver = "__test_socks5_dead_tunnel_driver__";
    let ssh_host = "127.0.0.1";
    let mut params = ssh_params(driver, ssh_host, SRV_URI);
    params.ssh_port = Some(1);
    let key = crate::ssh_tunnel::build_socks5_tunnel_key("user", ssh_host, 1);
    cache(
        &key,
        crate::ssh_tunnel::SshTunnel::russh_for_test(41004, false, Some(credentials())),
    );
    crate::drivers::registry::set_socks5_proxy_driver(driver, true);

    let resolved = resolve_ssh_params(&params, None);

    crate::drivers::registry::set_socks5_proxy_driver(driver, false);
    let still_cached = cached_port(&key);
    forget(&key);
    assert!(resolved.is_err());
    assert_eq!(still_cached, None);
}

#[test]
fn live_tunnel_keeps_a_live_entry_and_drops_a_dead_one() {
    let key = "test-live-tunnel-key";
    cache(
        key,
        crate::ssh_tunnel::SshTunnel::russh_for_test(41005, true, None),
    );
    assert_eq!(live_tunnel(key).map(|t| t.local_port), Some(41005));

    cache(
        key,
        crate::ssh_tunnel::SshTunnel::russh_for_test(41005, false, None),
    );
    assert!(live_tunnel(key).is_none());
    assert_eq!(cached_port(key), None);
}

#[test]
fn cache_tunnel_keeps_a_live_tunnel_opened_concurrently() {
    let key = "test-cache-tunnel-race-key";
    cache(
        key,
        crate::ssh_tunnel::SshTunnel::russh_for_test(41006, true, None),
    );
    let late = crate::ssh_tunnel::SshTunnel::russh_for_test(41007, true, None);

    let used = cache_tunnel(key.to_string(), late.clone());

    let cached = cached_port(key);
    forget(key);
    assert_eq!(used.local_port, 41006);
    assert_eq!(cached, Some(41006));
    assert!(!late.is_alive(), "the duplicate tunnel is stopped");
}

#[test]
fn concurrent_opens_of_one_tunnel_log_in_once() {
    let key = "test-open-shared-tunnel-once-key";
    let callers = 8;
    let opens = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let start = Arc::new(std::sync::Barrier::new(callers));
    let handles: Vec<_> = (0..callers)
        .map(|_| {
            let opens = opens.clone();
            let start = start.clone();
            std::thread::spawn(move || {
                start.wait();
                open_shared_tunnel(key, || {
                    opens.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    // A login takes a while; the other callers arrive meanwhile.
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    Ok(crate::ssh_tunnel::SshTunnel::russh_for_test(
                        41020, true, None,
                    ))
                })
                .map(|tunnel| tunnel.generation)
            })
        })
        .collect();
    let generations: Vec<u64> = handles
        .into_iter()
        .map(|handle| handle.join().unwrap().unwrap())
        .collect();
    forget(key);

    assert_eq!(opens.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert!(
        generations.iter().all(|g| *g == generations[0]),
        "every caller gets the one opened tunnel"
    );
}

#[test]
fn opening_one_tunnel_does_not_hold_up_another_key() {
    let slow_key = "test-open-shared-tunnel-slow-key";
    let fast_key = "test-open-shared-tunnel-fast-key";
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
    let slow = std::thread::spawn(move || {
        open_shared_tunnel(slow_key, || {
            entered_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            Ok(crate::ssh_tunnel::SshTunnel::russh_for_test(
                41021, true, None,
            ))
        })
        .map(|tunnel| tunnel.local_port)
    });
    entered_rx.recv().unwrap();

    let (done_tx, done_rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let port = open_shared_tunnel(fast_key, || {
            Ok(crate::ssh_tunnel::SshTunnel::russh_for_test(
                41022, true, None,
            ))
        })
        .map(|tunnel| tunnel.local_port);
        let _ = done_tx.send(port);
    });
    let fast = done_rx.recv_timeout(std::time::Duration::from_secs(5));
    release_tx.send(()).unwrap();
    let slow = slow.join().unwrap();
    forget(slow_key);
    forget(fast_key);

    assert_eq!(
        fast,
        Ok(Ok(41022)),
        "the other key opened while one was opening"
    );
    assert_eq!(slow, Ok(41021));
}

#[test]
fn a_failed_open_lets_the_next_caller_try_again() {
    let key = "test-open-shared-tunnel-failed-key";
    let mut opens = 0;

    let failed = open_shared_tunnel(key, || {
        opens += 1;
        Err("Permission denied (publickey)".to_string())
    });
    let retried = open_shared_tunnel(key, || {
        opens += 1;
        Ok(crate::ssh_tunnel::SshTunnel::russh_for_test(
            41023, true, None,
        ))
    })
    .map(|tunnel| tunnel.local_port);
    let cached = cached_port(key);
    forget(key);

    assert_eq!(
        failed.map(|t| t.local_port),
        Err("Permission denied (publickey)".to_string())
    );
    assert_eq!(retried, Ok(41023));
    assert_eq!(cached, Some(41023));
    assert_eq!(opens, 2);
}

#[test]
fn cache_tunnel_replaces_a_dead_entry() {
    let key = "test-cache-tunnel-dead-key";
    let dead = crate::ssh_tunnel::SshTunnel::russh_for_test(41008, false, None);
    cache(key, dead);
    let fresh = crate::ssh_tunnel::SshTunnel::russh_for_test(41009, true, None);

    let used = cache_tunnel(key.to_string(), fresh);

    let cached = cached_port(key);
    forget(key);
    assert_eq!(used.local_port, 41009);
    assert_eq!(cached, Some(41009));
}

#[test]
fn socks5_proxy_fields_sent_by_the_caller_are_discarded() {
    let params = ConnectionParams {
        socks5_proxy_host: Some("attacker.example".to_string()),
        socks5_proxy_port: Some(1080),
        socks5_proxy_username: Some("u".to_string()),
        socks5_proxy_password: Some("p".to_string()),
        ..uri_params(Some(SRV_URI))
    };

    let resolved = resolve_connection_transport(&params, None).unwrap();

    assert_eq!(resolved.socks5_proxy_host, None);
    assert_eq!(resolved.socks5_proxy_port, None);
    assert_eq!(resolved.socks5_proxy_username, None);
    assert_eq!(resolved.socks5_proxy_password, None);
    assert_eq!(resolved.connection_uri.as_deref(), Some(SRV_URI));
}

#[test]
fn forward_destination_ignores_blank_socket_path() {
    let params = ConnectionParams {
        unix_socket_path: Some("   ".to_string()),
        ..base_params()
    };
    assert!(matches!(
        ssh_forward_target(&params),
        crate::ssh_tunnel::ForwardTarget::Fixed { .. }
    ));
}

#[test]
fn forward_destination_uses_trimmed_socket_path() {
    let params = ConnectionParams {
        unix_socket_path: Some(" /var/run/mysqld/mysqld.sock ".to_string()),
        ..base_params()
    };
    assert_eq!(
        ssh_forward_target(&params),
        crate::ssh_tunnel::ForwardTarget::UnixSocket {
            path: "/var/run/mysqld/mysqld.sock".to_string(),
        }
    );
}

#[test]
fn ssh_tunnel_route_keeps_the_existing_keys() {
    let fixed = ConnectionParams {
        host: Some("db.internal".to_string()),
        port: Some(5432),
        ..ssh_params("postgres", "route-bastion", "postgres://db")
    };
    let (target, proxy, key) = ssh_tunnel_route(&fixed).unwrap();
    assert_eq!(
        target,
        crate::ssh_tunnel::ForwardTarget::Fixed {
            host: "db.internal".to_string(),
            port: 5432,
        }
    );
    assert!(proxy.is_none());
    assert_eq!(key, "user@route-bastion:22:db.internal->5432");
}

#[test]
fn tunnel_params_keep_ssl_mode_for_tcp_destination() {
    let params = ConnectionParams {
        ssl_mode: Some("require".to_string()),
        ..base_params()
    };
    let target = ssh_forward_target(&params);
    let tunnel = crate::ssh_tunnel::SshTunnel::russh_for_test(15000, true, None);
    let resolved = point_at_tunnel(&params, &tunnel, &target);
    assert_eq!(resolved.host.as_deref(), Some("127.0.0.1"));
    assert_eq!(resolved.port, Some(15000));
    assert_eq!(resolved.ssl_mode.as_deref(), Some("require"));
}

#[test]
fn tunnel_params_disable_ssl_for_socket_destination() {
    let params = ConnectionParams {
        ssl_mode: Some("require".to_string()),
        unix_socket_path: Some("/tmp/db.sock".to_string()),
        ..base_params()
    };
    let target = ssh_forward_target(&params);
    let tunnel = crate::ssh_tunnel::SshTunnel::russh_for_test(15000, true, None);
    let resolved = point_at_tunnel(&params, &tunnel, &target);
    assert_eq!(resolved.host.as_deref(), Some("127.0.0.1"));
    assert_eq!(resolved.port, Some(15000));
    assert_eq!(resolved.ssl_mode.as_deref(), Some("disable"));
}

#[test]
fn tunnel_params_clear_local_socket_path() {
    // A leftover local socket path would make the drivers dial the socket
    // instead of the tunnel's forwarded local port.
    let params = ConnectionParams {
        unix_socket_path: Some("/tmp/db.sock".to_string()),
        ..base_params()
    };
    let target = ssh_forward_target(&params);
    let tunnel = crate::ssh_tunnel::SshTunnel::russh_for_test(15000, true, None);
    let resolved = point_at_tunnel(&params, &tunnel, &target);
    assert_eq!(resolved.unix_socket_path, None);
}

#[test]
fn ssh_tunnel_lease_names_the_cached_generation() {
    let params = ssh_params("postgres", "lease-bastion", "postgres://db");
    assert_eq!(ssh_tunnel_lease(&params), None);

    let (_, _, key) = ssh_tunnel_route(&params).unwrap();
    let tunnel = crate::ssh_tunnel::SshTunnel::russh_for_test(41010, true, None);
    let generation = tunnel.generation;
    cache(&key, tunnel);
    let lease = ssh_tunnel_lease(&params);
    forget(&key);

    assert_eq!(lease, Some(TunnelLease { key, generation }));
    let direct = ConnectionParams {
        ssh_enabled: Some(false),
        ..params
    };
    assert_eq!(ssh_tunnel_lease(&direct), None);
}

#[test]
fn discard_stops_only_the_leased_generation() {
    let key = "test-discard-tunnel-key";
    let old = crate::ssh_tunnel::SshTunnel::russh_for_test(41011, true, None);
    let stale = TunnelLease {
        key: key.to_string(),
        generation: old.generation,
    };
    cache(key, old.clone());

    assert!(discard_ssh_tunnel(&stale));
    assert!(!old.is_alive());
    assert_eq!(cached_port(key), None);
    assert!(!discard_ssh_tunnel(&stale), "a second discard is a no-op");

    let fresh = crate::ssh_tunnel::SshTunnel::russh_for_test(41012, true, None);
    assert!(fresh.generation > stale.generation);
    cache(key, fresh.clone());
    let replaced = discard_ssh_tunnel(&stale);
    let cached = cached_port(key);
    forget(key);
    assert!(!replaced);
    assert!(fresh.is_alive());
    assert_eq!(cached, Some(41012));
}
