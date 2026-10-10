use super::command::{kubectl_command, run_kubectl, KubeconfigSelection, KubectlSelection};
use super::*;
use crate::models::{ConnectionParams, K8sConnection};
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

/// Serialize every test that touches the process-wide `TUNNELS` map.
/// Both `stop_all_tunnels_tests` and `reuse_or_discard_dead_tests` call
/// `stop_all_tunnels()`, so they must share one lock — separate
/// `OnceLock`s race under `--test-threads > 1`.
#[cfg(unix)]
fn tunnels_map_lock() -> &'static std::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
}


mod build_tunnel_key_tests {
    use super::*;

    #[test]
    fn test_default_key_preserves_tunnel_fields() {
        let key = build_tunnel_key(
            "my-cluster",
            "default",
            "service",
            "my-db",
            3306,
            &K8sCommandOptions::default(),
        );

        assert_eq!(key.context, "my-cluster");
        assert_eq!(key.namespace, "default");
        assert_eq!(key.resource_type, "service");
        assert_eq!(key.resource_name, "my-db");
        assert_eq!(key.port, 3306);
        assert_eq!(key.kubectl, KubectlSelection::Default);
    }

    #[test]
    fn test_key_preserves_explicit_override_identity() {
        let options = K8sCommandOptions::new(
            Some(" custom-kubectl ".to_string()),
            Some(" custom-kubeconfig ".to_string()),
        );
        let key = build_tunnel_key("prod", "database", "pod", "mysql-0", 5432, &options);

        assert_eq!(
            key.kubectl,
            KubectlSelection::Explicit(OsString::from("custom-kubectl"))
        );
        assert_eq!(
            key.kubeconfig,
            KubeconfigSelection::Explicit(OsString::from("custom-kubeconfig"))
        );
    }

    #[test]
    fn test_inherited_kubeconfig_has_a_distinct_source() {
        let options = K8sCommandOptions::default();
        assert_eq!(
            options.inherited_kubeconfig_selection_for_test(OsString::from("inherited-config")),
            KubeconfigSelection::Inherited(OsString::from("inherited-config"))
        );
    }

    #[test]
    fn test_explicit_default_labels_do_not_alias_defaults() {
        let default_key = build_tunnel_key(
            "ctx",
            "ns",
            "service",
            "db",
            3306,
            &K8sCommandOptions::default(),
        );
        let explicit_key = build_tunnel_key(
            "ctx",
            "ns",
            "service",
            "db",
            3306,
            &K8sCommandOptions::new(
                Some("kubectl".to_string()),
                Some("<kubectl default>".to_string()),
            ),
        );

        assert_ne!(default_key, explicit_key);
    }

    #[test]
    fn test_delimiter_containing_overrides_cannot_collide() {
        let first = build_tunnel_key(
            "ctx",
            "ns",
            "service",
            "db",
            3306,
            &K8sCommandOptions::new(Some("a:kubeconfig=b".to_string()), Some("c".to_string())),
        );
        let second = build_tunnel_key(
            "ctx",
            "ns",
            "service",
            "db",
            3306,
            &K8sCommandOptions::new(Some("a".to_string()), Some("b:kubeconfig=c".to_string())),
        );

        assert_ne!(first, second);
    }

    #[test]
    fn test_resource_fields_remain_structurally_distinct() {
        let options = K8sCommandOptions::default();
        let first = build_tunnel_key("a:b", "c", "service", "db", 80, &options);
        let second = build_tunnel_key("a", "b:c", "service", "db", 80, &options);

        assert_ne!(first, second);
    }

    #[test]
    fn test_empty_context_is_preserved() {
        let key = build_tunnel_key(
            "",
            "default",
            "service",
            "db",
            80,
            &K8sCommandOptions::default(),
        );

        assert!(key.context.is_empty());
        assert_eq!(key.namespace, "default");
    }
}

mod command_options_tests {
    use super::*;

    #[test]
    fn test_empty_and_whitespace_overrides_use_defaults() {
        let options = K8sCommandOptions::new(Some("  ".to_string()), Some(String::new()));
        assert_eq!(options.kubectl_program(), OsStr::new("kubectl"));
        assert_eq!(options.explicit_kubeconfig_path(), None);
    }

    #[test]
    fn test_overrides_are_trimmed() {
        let options = K8sCommandOptions::new(
            Some("  custom-kubectl  ".to_string()),
            Some("  custom-kubeconfig  ".to_string()),
        );
        assert_eq!(options.kubectl_program(), OsStr::new("custom-kubectl"));
        assert_eq!(
            options.explicit_kubeconfig_path(),
            Some(Path::new("custom-kubeconfig"))
        );
    }

    #[test]
    fn test_tilde_paths_are_expanded_from_base_dirs() {
        let base_dirs = directories::BaseDirs::new().expect("home directory should be available");
        let options = K8sCommandOptions::new(
            Some("~/bin/kubectl".to_string()),
            Some("~/.kube/config".to_string()),
        );
        assert_eq!(
            Path::new(options.kubectl_program()),
            base_dirs.home_dir().join("bin/kubectl")
        );
        assert_eq!(
            options.explicit_kubeconfig_path(),
            Some(base_dirs.home_dir().join(".kube/config").as_path())
        );

        let home = K8sCommandOptions::new(None, Some("~".to_string()));
        assert_eq!(home.explicit_kubeconfig_path(), Some(base_dirs.home_dir()));
    }
}

mod command_construction_tests {
    use super::*;

    #[test]
    fn test_default_command_uses_kubectl_without_overriding_environment() {
        let command = kubectl_command(&K8sCommandOptions::default());
        assert_eq!(command.get_program(), OsStr::new("kubectl"));
        assert!(command
            .get_envs()
            .all(|(name, _)| name != OsStr::new("KUBECONFIG")));
    }

    #[test]
    fn test_explicit_command_sets_program_and_kubeconfig_environment() {
        let options = K8sCommandOptions::new(
            Some("custom-kubectl".to_string()),
            Some("custom-kubeconfig".to_string()),
        );
        let command = kubectl_command(&options);
        assert_eq!(command.get_program(), OsStr::new("custom-kubectl"));
        let kubeconfig = command
            .get_envs()
            .find(|(name, _)| *name == OsStr::new("KUBECONFIG"))
            .and_then(|(_, value)| value);
        assert_eq!(kubeconfig, Some(OsStr::new("custom-kubeconfig")));
    }

    #[test]
    fn test_spawn_error_identifies_configured_program() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing-kubectl");
        let options = K8sCommandOptions::new(Some(missing.display().to_string()), None);
        let error = run_kubectl(&["version", "--client"], &options, "version failed")
            .expect_err("missing executable should fail to spawn");
        assert!(error.contains("Failed to launch configured kubectl executable"));
        assert!(error.contains(&missing.display().to_string()));
    }

    #[cfg(unix)]
    #[test]
    fn test_successful_empty_context_output_returns_empty_list() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let kubectl = dir.path().join("kubectl");
        std::fs::write(&kubectl, "#!/bin/sh\nexit 0\n").unwrap();
        let mut permissions = std::fs::metadata(&kubectl).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&kubectl, permissions).unwrap();

        let options = K8sCommandOptions::new(Some(kubectl.display().to_string()), None);
        let contexts = get_k8s_contexts(&options).expect("empty output is still successful");
        assert!(contexts.is_empty());
    }
}

mod path_validation_tests {
    use super::*;

    fn write_temp_file(dir: &tempfile::TempDir, name: &str) -> PathBuf {
        let path = dir.path().join(name);
        std::fs::write(&path, "test").unwrap();
        path
    }

    #[cfg(unix)]
    fn make_executable(path: &Path) {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = std::fs::metadata(path).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(path, permissions).unwrap();
    }

    #[cfg(windows)]
    fn make_executable(_path: &Path) {}

    #[test]
    fn test_empty_paths_are_valid_defaults() {
        assert!(validate_k8s_path("", "kubectl").is_ok());
        assert!(validate_k8s_path("   ", "kubeconfig").is_ok());
    }

    #[test]
    fn test_missing_paths_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing");

        let kubectl_error = validate_k8s_path(missing.to_str().unwrap(), "kubectl").unwrap_err();
        assert!(kubectl_error.contains("kubectl executable was not found"));

        let kubeconfig_error =
            validate_k8s_path(missing.to_str().unwrap(), "kubeconfig").unwrap_err();
        assert!(kubeconfig_error.contains("Kubeconfig file was not found"));
    }

    #[test]
    fn test_directories_are_rejected() {
        let dir = tempfile::tempdir().unwrap();

        let kubectl_error = validate_k8s_path(dir.path().to_str().unwrap(), "kubectl").unwrap_err();
        assert!(kubectl_error.contains("must point to an executable file"));

        let kubeconfig_error =
            validate_k8s_path(dir.path().to_str().unwrap(), "kubeconfig").unwrap_err();
        assert!(kubeconfig_error.contains("must point to a file"));
    }

    #[test]
    fn test_kubeconfig_file_is_valid_after_trimming() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_temp_file(&dir, "config");
        let padded = format!("  {}  ", path.display());
        assert!(validate_k8s_path(&padded, "kubeconfig").is_ok());
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn test_executable_kubectl_file_is_valid() {
        let dir = tempfile::tempdir().unwrap();
        let file_name = if cfg!(windows) {
            "kubectl.exe"
        } else {
            "kubectl"
        };
        let path = write_temp_file(&dir, file_name);
        make_executable(&path);
        assert!(validate_k8s_path(path.to_str().unwrap(), "kubectl").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn test_non_executable_kubectl_file_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_temp_file(&dir, "kubectl");
        let error = validate_k8s_path(path.to_str().unwrap(), "kubectl").unwrap_err();
        assert!(error.contains("kubectl path is not executable"));
    }

    #[cfg(windows)]
    #[test]
    fn test_non_executable_kubectl_file_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_temp_file(&dir, "kubectl.txt");
        let error = validate_k8s_path(path.to_str().unwrap(), "kubectl").unwrap_err();
        assert!(error.contains("kubectl path is not executable"));
    }

    #[test]
    fn test_bare_executable_name_resolves_from_path_when_available() {
        #[cfg(windows)]
        let candidates = ["cmd", "where"];
        #[cfg(not(windows))]
        let candidates = ["sh", "env"];

        let Some(candidate) = candidates
            .into_iter()
            .find(|candidate| which::which(candidate).is_ok())
        else {
            eprintln!("Skipping PATH resolution assertion: no stable executable candidate found");
            return;
        };

        assert!(validate_k8s_path(candidate, "kubectl").is_ok());
    }

    #[test]
    fn test_unsupported_validation_kind_is_rejected() {
        let error = validate_k8s_path("anything", "certificate").unwrap_err();
        assert!(error.contains("Unsupported Kubernetes path validation kind 'certificate'"));
        assert!(error.contains("'kubectl' or 'kubeconfig'"));
    }
}

mod persisted_model_compatibility_tests {
    use super::*;

    #[test]
    fn test_old_connection_params_json_defaults_override_fields() {
        let params: ConnectionParams =
            serde_json::from_str(r#"{"driver":"mysql","database":"example"}"#).unwrap();
        assert_eq!(params.k8s_kubectl_path, None);
        assert_eq!(params.k8s_kubeconfig_path, None);

        let serialized = serde_json::to_value(params).unwrap();
        assert!(serialized.get("k8s_kubectl_path").is_none());
        assert!(serialized.get("k8s_kubeconfig_path").is_none());
    }

    #[test]
    fn test_old_saved_k8s_json_defaults_override_fields() {
        let connection: K8sConnection = serde_json::from_str(
            r#"{
                "id":"saved-id",
                "name":"Saved cluster",
                "context":"context",
                "namespace":"default",
                "resource_type":"service",
                "resource_name":"database",
                "port":5432
            }"#,
        )
        .unwrap();
        assert_eq!(connection.kubectl_path, None);
        assert_eq!(connection.kubeconfig_path, None);

        let serialized = serde_json::to_value(connection).unwrap();
        assert!(serialized.get("kubectl_path").is_none());
        assert!(serialized.get("kubeconfig_path").is_none());
    }
}

mod parse_lines_tests {
    use super::*;

    #[test]
    fn test_basic_lines() {
        let output = "line1\nline2\nline3\n";
        let result = parse_lines(output);
        assert_eq!(result, vec!["line1", "line2", "line3"]);
    }

    #[test]
    fn test_empty_output() {
        let result = parse_lines("");
        assert!(result.is_empty());
    }

    #[test]
    fn test_whitespace_handling() {
        let output = "  line1  \n\n  line2  \n";
        let result = parse_lines(output);
        assert_eq!(result, vec!["line1", "line2"]);
    }
}

mod parse_lines_with_prefix_tests {
    use super::*;

    #[test]
    fn test_namespace_prefix() {
        let output = "namespace/default\nnamespace/kube-system\nnamespace/my-ns\n";
        let result = parse_lines_with_prefix(output, "namespace/");
        assert_eq!(result, vec!["default", "kube-system", "my-ns"]);
    }

    #[test]
    fn test_service_prefix() {
        let output = "service/my-db\nservice/api-gateway\n";
        let result = parse_lines_with_prefix(output, "service/");
        assert_eq!(result, vec!["my-db", "api-gateway"]);
    }

    #[test]
    fn test_pod_prefix() {
        let output = "pod/mysql-0\npod/mysql-1\n";
        let result = parse_lines_with_prefix(output, "pod/");
        assert_eq!(result, vec!["mysql-0", "mysql-1"]);
    }

    #[test]
    fn test_no_match_returns_full_line() {
        let output = "something/else\n";
        let result = parse_lines_with_prefix(output, "namespace/");
        assert_eq!(result, vec!["something/else"]);
    }

    #[test]
    fn test_empty_output() {
        let result = parse_lines_with_prefix("", "namespace/");
        assert!(result.is_empty());
    }
}

mod parse_resource_ports_tests {
    use super::*;

    #[test]
    fn test_single_port() {
        let result = parse_resource_ports("5432");
        assert_eq!(result, vec![5432]);
    }

    #[test]
    fn test_multiple_ports() {
        let result = parse_resource_ports("80 443 5432");
        assert_eq!(result, vec![80, 443, 5432]);
    }

    #[test]
    fn test_ignores_invalid_values() {
        let result = parse_resource_ports("abc 3306 70000 8123");
        assert_eq!(result, vec![3306, 8123]);
    }

    #[test]
    fn test_empty_output() {
        let result = parse_resource_ports("");
        assert!(result.is_empty());
    }
}

#[cfg(unix)]
mod is_alive_tests {
    use super::*;
    use std::process::{Command, Stdio};
    use std::sync::{Arc, Mutex};

    fn tunnel_running(script: &str) -> K8sTunnel {
        let child = Command::new("sh")
            .args(["-c", script])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        K8sTunnel {
            local_port: 54321,
            child: Arc::new(Mutex::new(child)),
        }
    }

    #[test]
    fn a_running_port_forward_is_alive() {
        let tunnel = tunnel_running("sleep 30");
        assert!(tunnel.is_alive());
        tunnel.stop();
    }

    #[test]
    fn an_ended_port_forward_is_not_alive() {
        let tunnel = tunnel_running("exit 0");
        tunnel.child.lock().unwrap().wait().unwrap();
        assert!(!tunnel.is_alive());
    }

    #[test]
    fn stop_ends_a_running_port_forward() {
        let tunnel = tunnel_running("sleep 30");
        assert!(tunnel.is_alive());
        tunnel.stop();
        // give the OS a moment to report the exit after kill
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(!tunnel.is_alive());
    }
}

#[cfg(unix)]
mod stop_all_tunnels_tests {
    use super::*;
    use std::process::{Command, Stdio};
    use std::sync::{Arc, Mutex};

    fn map_lock() -> &'static Mutex<()> {
        super::tunnels_map_lock()
    }

    fn stub_tunnel(script: &str, local_port: u16) -> K8sTunnel {
        let child = Command::new("sh")
            .args(["-c", script])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        K8sTunnel {
            local_port,
            child: Arc::new(Mutex::new(child)),
        }
    }

    #[test]
    fn stop_all_kills_cached_tunnels_and_clears_the_map() {
        let _guard = map_lock().lock().unwrap();
        // Start from a clean map so parallel suites cannot leave leftovers.
        stop_all_tunnels();
        let key = build_tunnel_key(
            "test-ctx-stop-all",
            "ns",
            "service",
            "db",
            3306,
            &K8sCommandOptions::default(),
        );
        let tunnel = stub_tunnel("sleep 30", 54322);
        // Keep a handle so we can observe the kill after stop_all drops the map entry.
        let child = Arc::clone(&tunnel.child);

        {
            let mut tunnels = get_tunnels().lock().unwrap();
            tunnels.insert(key.clone(), tunnel);
        }

        stop_all_tunnels();

        {
            let tunnels = get_tunnels().lock().unwrap();
            assert!(!tunnels.contains_key(&key));
            assert!(tunnels.is_empty());
        }

        // stop() kills; try_wait reaps. Retry briefly for the SIGKILL race.
        let mut exited = false;
        for _ in 0..20 {
            if matches!(child.lock().unwrap().try_wait(), Ok(Some(_))) {
                exited = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        assert!(exited, "stub child still running after stop_all_tunnels");
    }

    #[test]
    fn stop_all_is_a_noop_when_the_map_is_empty() {
        let _guard = map_lock().lock().unwrap();
        // Ensure a clean map first.
        stop_all_tunnels();
        stop_all_tunnels();
        assert!(get_tunnels().lock().unwrap().is_empty());
    }
}

#[cfg(unix)]
mod reuse_or_discard_dead_tests {
    use super::*;
    use std::process::{Command, Stdio};
    use std::sync::{Arc, Mutex};

    fn map_lock() -> &'static Mutex<()> {
        super::tunnels_map_lock()
    }

    fn stub_tunnel(script: &str, local_port: u16) -> K8sTunnel {
        let child = Command::new("sh")
            .args(["-c", script])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        K8sTunnel {
            local_port,
            child: Arc::new(Mutex::new(child)),
        }
    }

    fn test_key(suffix: &str) -> K8sTunnelKey {
        build_tunnel_key(
            &format!("test-ctx-reuse-{suffix}"),
            "ns",
            "service",
            "db",
            3306,
            &K8sCommandOptions::default(),
        )
    }

    #[test]
    fn alive_entry_is_reused() {
        let _guard = map_lock().lock().unwrap();
        stop_all_tunnels();
        let key = test_key("alive");
        let tunnel = stub_tunnel("sleep 30", 54331);
        {
            let mut tunnels = get_tunnels().lock().unwrap();
            tunnels.insert(key.clone(), tunnel);
        }

        assert_eq!(reuse_or_discard_dead(&key), Ok(54331));
        assert!(get_tunnels().lock().unwrap().contains_key(&key));

        stop_all_tunnels();
    }

    #[test]
    fn dead_entry_returns_previous_port_but_stays_until_insert() {
        let _guard = map_lock().lock().unwrap();
        stop_all_tunnels();
        let key = test_key("dead");
        let tunnel = stub_tunnel("exit 0", 54332);
        // Reap the child so is_alive() reports dead.
        tunnel.child.lock().unwrap().wait().unwrap();
        {
            let mut tunnels = get_tunnels().lock().unwrap();
            tunnels.insert(key.clone(), tunnel);
        }

        // Dead entry is kept so a failed respawn still remembers the port.
        assert_eq!(reuse_or_discard_dead(&key), Err(Some(54332)));
        assert!(get_tunnels().lock().unwrap().contains_key(&key));
        // A second peek still returns the same previous port.
        assert_eq!(reuse_or_discard_dead(&key), Err(Some(54332)));

        // Only insert_tunnel removes/replaces it.
        let replacement = stub_tunnel("sleep 30", 54332);
        insert_tunnel(key.clone(), replacement);
        assert_eq!(
            get_tunnels().lock().unwrap().get(&key).unwrap().local_port,
            54332
        );
        assert_eq!(reuse_or_discard_dead(&key), Ok(54332));

        stop_all_tunnels();
    }

    #[test]
    fn missing_entry_returns_none() {
        let _guard = map_lock().lock().unwrap();
        stop_all_tunnels();
        let key = test_key("missing");
        assert_eq!(reuse_or_discard_dead(&key), Err(None));
    }

    #[test]
    fn insert_tunnel_stops_displaced_child() {
        let _guard = map_lock().lock().unwrap();
        stop_all_tunnels();
        let key = test_key("displace");
        let first = stub_tunnel("sleep 30", 54333);
        let first_child = Arc::clone(&first.child);
        {
            let mut tunnels = get_tunnels().lock().unwrap();
            tunnels.insert(key.clone(), first);
        }

        let second = stub_tunnel("sleep 30", 54334);
        insert_tunnel(key.clone(), second);

        {
            let tunnels = get_tunnels().lock().unwrap();
            assert_eq!(tunnels.get(&key).unwrap().local_port, 54334);
        }

        let mut exited = false;
        for _ in 0..20 {
            if matches!(first_child.lock().unwrap().try_wait(), Ok(Some(_))) {
                exited = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        assert!(exited, "displaced stub child still running after insert_tunnel");

        stop_all_tunnels();
    }
}

mod allocate_local_port_tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn preferred_port_is_used_when_free() {
        // Bind then drop so we know a free port, then ask allocate for it.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        assert_eq!(allocate_local_port(Some(port)).unwrap(), port);
    }

    #[test]
    fn preferred_port_falls_back_when_taken() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let taken = listener.local_addr().unwrap().port();
        // Keep listener alive so the preferred port is occupied.
        let allocated = allocate_local_port(Some(taken)).unwrap();
        assert_ne!(allocated, taken);
        assert!(allocated > 0);
        drop(listener);
    }

    #[test]
    fn none_allocates_an_ephemeral_port() {
        let port = allocate_local_port(None).unwrap();
        assert!(port > 0);
    }
}
