use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

// Constants for timeouts and configuration
const K8S_TUNNEL_TIMEOUT_SECS: u64 = 15;
const K8S_CONNECT_RETRY_MS: u64 = 200;
const LOG_BUFFER_INITIAL_CAPACITY: usize = 64;

#[derive(Clone)]
pub struct K8sTunnel {
    pub local_port: u16,
    child: Arc<Mutex<Child>>,
}

pub static TUNNELS: OnceLock<Mutex<HashMap<String, K8sTunnel>>> = OnceLock::new();

pub fn get_tunnels() -> &'static Mutex<HashMap<String, K8sTunnel>> {
    TUNNELS.get_or_init(|| Mutex::new(HashMap::new()))
}

impl K8sTunnel {
    /// Create a new kubectl port-forward tunnel.
    ///
    /// Spawns `kubectl port-forward --context <ctx> -n <ns> <res_type>/<res_name> <local_port>:<remote_port>`
    /// and waits for the local port to become connectable.
    pub fn new(
        context: &str,
        namespace: &str,
        resource_type: &str,
        resource_name: &str,
        remote_port: u16,
    ) -> Result<Self, String> {
        eprintln!(
            "[K8s Tunnel] New request: context={}, namespace={}, {}/{}:{}",
            context, namespace, resource_type, resource_name, remote_port
        );

        // Verify kubectl is available
        Self::verify_kubectl()?;

        // Allocate a free local port
        let local_port = {
            let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| {
                let err = format!("Failed to find free local port: {}", e);
                eprintln!("[K8s Tunnel Error] {}", err);
                err
            })?;
            listener.local_addr().unwrap().port()
        };
        eprintln!("[K8s Tunnel] Assigned local port: {}", local_port);

        // Build the kubectl port-forward command
        let port_forward_spec = format!("{}:{}", local_port, remote_port);
        let resource = format!("{}/{}", resource_type, resource_name);

        let mut args = Vec::with_capacity(10);
        args.extend([
            "port-forward",
            "--context",
            context,
            "--namespace",
            namespace,
            &resource,
            &port_forward_spec,
        ]);

        eprintln!("[K8s Tunnel] Executing: kubectl {:?}", args);

        let mut child = Command::new("kubectl")
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                let err = format!(
                    "Failed to launch kubectl: {}. Ensure 'kubectl' is in PATH.",
                    e
                );
                eprintln!("[K8s Tunnel Error] {}", err);
                err
            })?;

        // Capture stdout/stderr in background threads
        let stdout_log = Arc::new(Mutex::new(Vec::with_capacity(LOG_BUFFER_INITIAL_CAPACITY)));
        let stderr_log = Arc::new(Mutex::new(Vec::with_capacity(LOG_BUFFER_INITIAL_CAPACITY)));

        if let Some(stdout) = child.stdout.take() {
            let log = stdout_log.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(l) = line {
                        #[cfg(debug_assertions)]
                        eprintln!("[K8s kubectl Out] {}", l);
                        if let Ok(mut g) = log.lock() {
                            g.push(l);
                        }
                    }
                }
            });
        }

        if let Some(stderr) = child.stderr.take() {
            let log = stderr_log.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(l) = line {
                        #[cfg(debug_assertions)]
                        eprintln!("[K8s kubectl Err] {}", l);
                        if let Ok(mut g) = log.lock() {
                            g.push(l);
                        }
                    }
                }
            });
        }

        let child_arc = Arc::new(Mutex::new(child));

        // Wait for the tunnel to become ready
        let start = Instant::now();
        let timeout = Duration::from_secs(K8S_TUNNEL_TIMEOUT_SECS);
        let mut ready = false;

        while start.elapsed() < timeout {
            // Check if process is still alive
            {
                let mut c = child_arc.lock().unwrap();
                if let Ok(Some(status)) = c.try_wait() {
                    let stdout_content = stdout_log.lock().unwrap().join("\n");
                    let stderr_content = stderr_log.lock().unwrap().join("\n");
                    let err_msg = format!(
                        "kubectl port-forward exited prematurely with status: {}.\nStderr: {}\nStdout: {}",
                        status, stderr_content, stdout_content
                    );
                    eprintln!("[K8s Tunnel Error] {}", err_msg);
                    return Err(err_msg);
                }
            }

            // Try connecting to the local port
            match TcpStream::connect(format!("127.0.0.1:{}", local_port)) {
                Ok(_) => {
                    eprintln!(
                        "[K8s Tunnel] Tunnel established successfully on port {}",
                        local_port
                    );
                    ready = true;
                    break;
                }
                Err(_) => {
                    thread::sleep(Duration::from_millis(K8S_CONNECT_RETRY_MS));
                }
            }
        }

        if !ready {
            if let Ok(mut c) = child_arc.lock() {
                let _ = c.kill();
            }
            let err = format!(
                "Timed out waiting for kubectl port-forward to establish ({}s)",
                K8S_TUNNEL_TIMEOUT_SECS
            );
            eprintln!("[K8s Tunnel Error] {}", err);
            return Err(err);
        }

        Ok(Self {
            local_port,
            child: child_arc,
        })
    }

    /// Stop the tunnel by killing the kubectl child process.
    pub fn stop(&self) {
        if let Ok(mut c) = self.child.lock() {
            let _ = c.kill();
            eprintln!(
                "[K8s Tunnel] Stopped tunnel on port {}",
                self.local_port
            );
        }
    }

    /// Check that kubectl is available in PATH.
    fn verify_kubectl() -> Result<(), String> {
        let output = Command::new("kubectl")
            .arg("version")
            .arg("--client")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| {
                format!(
                    "kubectl not found: {}. Please install kubectl and ensure it is in PATH.",
                    e
                )
            })?;

        if !output.status.success() {
            return Err("kubectl version check failed. Please verify your kubectl installation.".to_string());
        }

        Ok(())
    }
}

/// Build a deterministic tunnel map key from K8s parameters.
#[inline]
pub fn build_tunnel_key(
    context: &str,
    namespace: &str,
    resource_type: &str,
    resource_name: &str,
    port: u16,
) -> String {
    format!(
        "{}:{}:{}/{}:{}",
        context, namespace, resource_type, resource_name, port
    )
}

/// Test a K8s connection by verifying context and namespace reachability.
pub fn test_k8s_connection(
    context: &str,
    namespace: &str,
) -> Result<String, String> {
    eprintln!(
        "[K8s Test] Testing connection: context={}, namespace={}",
        context, namespace
    );

    K8sTunnel::verify_kubectl()?;

    let output = Command::new("kubectl")
        .args(["--context", context, "get", "namespace", namespace, "-o", "name"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to execute kubectl: {}", e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        eprintln!("[K8s Test] Connection successful: {}", stdout);
        Ok(format!(
            "Kubernetes connection to context '{}' namespace '{}' verified successfully!",
            context, namespace
        ))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let err = format!("K8s connection test failed: {}", stderr.trim());
        eprintln!("[K8s Test Error] {}", err);
        Err(err)
    }
}

/// List available kubectl contexts from kubeconfig.
pub fn get_k8s_contexts() -> Result<Vec<String>, String> {
    let output = Command::new("kubectl")
        .args(["config", "get-contexts", "-o", "name"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to execute kubectl: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to list K8s contexts: {}", stderr.trim()));
    }

    let contexts = parse_lines(&String::from_utf8_lossy(&output.stdout));
    eprintln!("[K8s Discovery] Found {} contexts", contexts.len());
    Ok(contexts)
}

/// List namespaces in a given kubectl context.
pub fn get_k8s_namespaces(context: &str) -> Result<Vec<String>, String> {
    let output = Command::new("kubectl")
        .args([
            "--context",
            context,
            "get",
            "namespaces",
            "-o",
            "name",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to execute kubectl: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Failed to list namespaces in context '{}': {}",
            context,
            stderr.trim()
        ));
    }

    let namespaces = parse_lines_with_prefix(&String::from_utf8_lossy(&output.stdout), "namespace/");
    eprintln!(
        "[K8s Discovery] Found {} namespaces in context '{}'",
        namespaces.len(),
        context
    );
    Ok(namespaces)
}

/// List resources (services or pods) in a given context and namespace.
pub fn get_k8s_resources(
    context: &str,
    namespace: &str,
    resource_type: &str,
) -> Result<Vec<String>, String> {
    // Validate resource type
    if resource_type != "service" && resource_type != "pod" {
        return Err(format!(
            "Unsupported resource type '{}'. Only 'service' and 'pod' are supported.",
            resource_type
        ));
    }

    let output = Command::new("kubectl")
        .args([
            "--context",
            context,
            "--namespace",
            namespace,
            "get",
            resource_type,
            "-o",
            "name",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to execute kubectl: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Failed to list {} in context '{}' namespace '{}': {}",
            resource_type,
            context,
            namespace,
            stderr.trim()
        ));
    }

    let prefix = format!("{}/", resource_type);
    let resources = parse_lines_with_prefix(&String::from_utf8_lossy(&output.stdout), &prefix);
    eprintln!(
        "[K8s Discovery] Found {} {} in context '{}' namespace '{}'",
        resources.len(),
        resource_type,
        context,
        namespace
    );
    Ok(resources)
}

/// List exposed service ports in a given context and namespace.
pub fn get_k8s_resource_ports(
    context: &str,
    namespace: &str,
    resource_type: &str,
    resource_name: &str,
) -> Result<Vec<u16>, String> {
    if resource_type != "service" {
        return Err(format!(
            "Unsupported resource type '{}'. Only 'service' is supported.",
            resource_type
        ));
    }

    let output = Command::new("kubectl")
        .args([
            "--context",
            context,
            "--namespace",
            namespace,
            "get",
            resource_type,
            resource_name,
            "-o",
            "jsonpath={.spec.ports[*].port}",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to execute kubectl: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Failed to list ports for {} '{}' in context '{}' namespace '{}': {}",
            resource_type,
            resource_name,
            context,
            namespace,
            stderr.trim()
        ));
    }

    Ok(parse_resource_ports(&String::from_utf8_lossy(&output.stdout)))
}

/// Parse newline-separated output into a list of trimmed, non-empty strings.
fn parse_lines(output: &str) -> Vec<String> {
    output
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect()
}

/// Parse newline-separated output, stripping a prefix from each line.
fn parse_lines_with_prefix(output: &str, prefix: &str) -> Vec<String> {
    output
        .lines()
        .map(|l| l.trim().strip_prefix(prefix).unwrap_or(l.trim()))
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect()
}

fn parse_resource_ports(output: &str) -> Vec<u16> {
    output
        .split_whitespace()
        .filter_map(|value| value.parse::<u16>().ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    mod build_tunnel_key_tests {
        use super::*;

        #[test]
        fn test_basic_key_format() {
            let key = build_tunnel_key(
                "my-cluster",
                "default",
                "service",
                "my-db",
                3306,
            );
            assert_eq!(key, "my-cluster:default:service/my-db:3306");
        }

        #[test]
        fn test_pod_resource_type() {
            let key = build_tunnel_key(
                "prod-cluster",
                "database",
                "pod",
                "mysql-0",
                5432,
            );
            assert_eq!(key, "prod-cluster:database:pod/mysql-0:5432");
        }

        #[test]
        fn test_empty_context() {
            let key = build_tunnel_key("", "default", "service", "db", 80);
            assert_eq!(key, ":default:service/db:80");
        }

        #[test]
        fn test_special_characters() {
            let key = build_tunnel_key(
                "gke_project_us-central1_cluster",
                "my-namespace",
                "service",
                "my-db-svc",
                3306,
            );
            assert_eq!(
                key,
                "gke_project_us-central1_cluster:my-namespace:service/my-db-svc:3306"
            );
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
}
