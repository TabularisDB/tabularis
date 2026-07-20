mod command;

pub use command::{validate_k8s_path, K8sCommandOptions};

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Stdio};
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

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct K8sTunnelKey {
    context: String,
    namespace: String,
    resource_type: String,
    resource_name: String,
    port: u16,
    kubectl: command::KubectlSelection,
    kubeconfig: command::KubeconfigSelection,
}

pub static TUNNELS: OnceLock<Mutex<HashMap<K8sTunnelKey, K8sTunnel>>> = OnceLock::new();

pub fn get_tunnels() -> &'static Mutex<HashMap<K8sTunnelKey, K8sTunnel>> {
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
        options: &K8sCommandOptions,
    ) -> Result<Self, String> {
        eprintln!(
            "[K8s Tunnel] New request: context={}, namespace={}, {}/{}:{}",
            context, namespace, resource_type, resource_name, remote_port
        );

        // Verify kubectl is available
        Self::verify_kubectl(options)?;

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
        let args = [
            "port-forward",
            "--context",
            context,
            "--namespace",
            namespace,
            &resource,
            &port_forward_spec,
        ];

        eprintln!(
            "[K8s Tunnel] Executing: {} {:?}",
            options.kubectl_label(),
            args
        );

        let mut child = command::kubectl_command(options)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                let err = command::kubectl_spawn_error(options, &error);
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
            eprintln!("[K8s Tunnel] Stopped tunnel on port {}", self.local_port);
        }
    }

    /// Check that kubectl is available.
    fn verify_kubectl(options: &K8sCommandOptions) -> Result<(), String> {
        command::run_kubectl(
            &["version", "--client"],
            options,
            "kubectl version check failed. Please verify your kubectl installation",
        )
        .map(|_| ())
    }
}

/// Build a deterministic, collision-safe tunnel map key from K8s parameters
/// and the effective command selections.
#[inline]
pub fn build_tunnel_key(
    context: &str,
    namespace: &str,
    resource_type: &str,
    resource_name: &str,
    port: u16,
    options: &K8sCommandOptions,
) -> K8sTunnelKey {
    K8sTunnelKey {
        context: context.to_string(),
        namespace: namespace.to_string(),
        resource_type: resource_type.to_string(),
        resource_name: resource_name.to_string(),
        port,
        kubectl: options.kubectl_selection(),
        kubeconfig: options.kubeconfig_selection(),
    }
}

/// Test a K8s connection by verifying context and namespace reachability.
pub fn test_k8s_connection(
    context: &str,
    namespace: &str,
    options: &K8sCommandOptions,
) -> Result<String, String> {
    eprintln!(
        "[K8s Test] Testing connection: context={}, namespace={}",
        context, namespace
    );

    K8sTunnel::verify_kubectl(options)?;

    let output = command::run_kubectl(
        &[
            "--context",
            context,
            "get",
            "namespace",
            namespace,
            "-o",
            "name",
        ],
        options,
        "K8s connection test failed",
    )?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    eprintln!("[K8s Test] Connection successful: {}", stdout);
    Ok(format!(
        "Kubernetes connection to context '{}' namespace '{}' verified successfully!",
        context, namespace
    ))
}

/// List available kubectl contexts from kubeconfig.
pub fn get_k8s_contexts(options: &K8sCommandOptions) -> Result<Vec<String>, String> {
    let output = command::run_kubectl(
        &["config", "get-contexts", "-o", "name"],
        options,
        "Failed to list K8s contexts",
    )?;

    let contexts = parse_lines(&String::from_utf8_lossy(&output.stdout));
    eprintln!("[K8s Discovery] Found {} contexts", contexts.len());
    Ok(contexts)
}

/// List namespaces in a given kubectl context.
pub fn get_k8s_namespaces(
    context: &str,
    options: &K8sCommandOptions,
) -> Result<Vec<String>, String> {
    let output = command::run_kubectl(
        &["--context", context, "get", "namespaces", "-o", "name"],
        options,
        &format!("Failed to list namespaces in context '{}'", context),
    )?;

    let namespaces =
        parse_lines_with_prefix(&String::from_utf8_lossy(&output.stdout), "namespace/");
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
    options: &K8sCommandOptions,
) -> Result<Vec<String>, String> {
    // Validate resource type
    if resource_type != "service" && resource_type != "pod" {
        return Err(format!(
            "Unsupported resource type '{}'. Only 'service' and 'pod' are supported.",
            resource_type
        ));
    }

    let output = command::run_kubectl(
        &[
            "--context",
            context,
            "--namespace",
            namespace,
            "get",
            resource_type,
            "-o",
            "name",
        ],
        options,
        &format!(
            "Failed to list {} in context '{}' namespace '{}'",
            resource_type, context, namespace
        ),
    )?;

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
    options: &K8sCommandOptions,
) -> Result<Vec<u16>, String> {
    if resource_type != "service" {
        return Err(format!(
            "Unsupported resource type '{}'. Only 'service' is supported.",
            resource_type
        ));
    }

    let output = command::run_kubectl(
        &[
            "--context",
            context,
            "--namespace",
            namespace,
            "get",
            resource_type,
            resource_name,
            "-o",
            "jsonpath={.spec.ports[*].port}",
        ],
        options,
        &format!(
            "Failed to list ports for {} '{}' in context '{}' namespace '{}'",
            resource_type, resource_name, context, namespace
        ),
    )?;

    Ok(parse_resource_ports(&String::from_utf8_lossy(
        &output.stdout,
    )))
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
mod tests;
