use serde_json::json;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

// Constants for timeouts and configuration
const SSM_TUNNEL_TIMEOUT_SECS: u64 = 30;
const SSM_CONNECT_RETRY_MS: u64 = 200;
const LOG_BUFFER_INITIAL_CAPACITY: usize = 64;

const AWS_PROGRAM: &str = "aws";
/// Forwards to a port on the managed node itself.
const DOCUMENT_LOCAL: &str = "AWS-StartPortForwardingSession";
/// Forwards through the managed node to another host (RDS, ElastiCache, ...).
const DOCUMENT_REMOTE: &str = "AWS-StartPortForwardingSessionToRemoteHost";

#[derive(Clone)]
pub struct SsmTunnel {
    pub local_port: u16,
    child: Arc<Mutex<Child>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SsmTunnelKey {
    profile: Option<String>,
    region: Option<String>,
    target: String,
    remote_host: String,
    remote_port: u16,
}

pub static TUNNELS: OnceLock<Mutex<HashMap<SsmTunnelKey, SsmTunnel>>> = OnceLock::new();

pub fn get_tunnels() -> &'static Mutex<HashMap<SsmTunnelKey, SsmTunnel>> {
    TUNNELS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Trim a caller-supplied optional field, treating blank as absent.
pub fn normalize(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(String::from)
}

/// Forwarding to `localhost` *through* a managed node is the same thing as
/// forwarding to a port *on* that node, and the plain document is the one some
/// IAM policies grant exclusively, so prefer it whenever it applies.
fn is_node_local(host: &str) -> bool {
    matches!(host.trim(), "" | "localhost" | "127.0.0.1" | "::1")
}

/// The SSM document a given target host resolves to. Surfaced to the user so
/// a failed session can be traced back to the derivation that produced it.
pub fn resolved_document(remote_host: &str) -> &'static str {
    if is_node_local(remote_host) {
        DOCUMENT_LOCAL
    } else {
        DOCUMENT_REMOTE
    }
}

/// Build the `aws` argument vector for a port-forwarding session.
pub fn build_start_session_args(
    target: &str,
    profile: Option<&str>,
    region: Option<&str>,
    remote_host: &str,
    remote_port: u16,
    local_port: u16,
) -> Vec<String> {
    let document = resolved_document(remote_host);
    let parameters = if document == DOCUMENT_LOCAL {
        json!({
            "portNumber": [remote_port.to_string()],
            "localPortNumber": [local_port.to_string()],
        })
    } else {
        json!({
            "host": [remote_host.trim()],
            "portNumber": [remote_port.to_string()],
            "localPortNumber": [local_port.to_string()],
        })
    };

    let mut args = vec![
        "ssm".to_string(),
        "start-session".to_string(),
        "--target".to_string(),
        target.trim().to_string(),
        "--document-name".to_string(),
        document.to_string(),
        "--parameters".to_string(),
        parameters.to_string(),
    ];

    if let Some(profile) = normalize(profile) {
        args.push("--profile".to_string());
        args.push(profile);
    }
    if let Some(region) = normalize(region) {
        args.push("--region".to_string());
        args.push(region);
    }

    args
}

fn aws_command() -> Command {
    let mut command = Command::new(AWS_PROGRAM);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Own process group so the whole session tree can be signalled at once.
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn aws_spawn_error(error: &std::io::Error) -> String {
    format!(
        "Failed to launch the AWS CLI: {}. Install the AWS CLI v2 and the \
         Session Manager plugin, and ensure 'aws' is available in PATH.",
        error
    )
}

/// `aws ssm start-session` runs `session-manager-plugin` as a child, and that
/// child is what holds the forwarded local port. Killing only the CLI leaks
/// the plugin and the port, so signal the whole process group.
fn stop_process_tree(child: &mut Child) {
    #[cfg(unix)]
    {
        // SIGTERM rather than SIGKILL: it lets the CLI close the SSM session
        // server-side instead of leaving it to time out.
        unsafe { libc::kill(-(child.id() as i32), libc::SIGTERM) };
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &child.id().to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(any(unix, windows)))]
    let _ = child.kill();
}

/// The plugin prints one of these once it owns the local port.
///
/// Readiness must come from the process we spawned, never from a TCP probe of
/// the local port: a probe also succeeds against whatever else grabbed the
/// port in the gap between our own probe bind and the plugin's bind, and the
/// user would then silently query the wrong database. A wording change in the
/// plugin therefore costs a loud timeout, which is the safe way to be wrong.
fn is_ready_line(line: &str) -> bool {
    let line = line.to_ascii_lowercase();
    line.contains("waiting for connections") || line.contains("opened for sessionid")
}

/// `aws ssm start-session` fails for a handful of reasons that each need a
/// different fix, and its own output rarely says which. Returns the fix.
pub fn classify_failure(output: &str) -> Option<&'static str> {
    let out = output.to_ascii_lowercase();

    if out.contains("sessionmanagerplugin is not found")
        || (out.contains("session-manager-plugin") && out.contains("not found"))
    {
        return Some(
            "The Session Manager plugin is not installed. Install it from \
             https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html",
        );
    }
    if out.contains("address already in use") || out.contains("bind: address") {
        return Some(
            "The local port was taken while the session was starting. Retry the connection.",
        );
    }
    if out.contains("token has expired")
        || out.contains("expiredtoken")
        || out.contains("sso session associated with this profile has expired")
        || out.contains("refresh failed")
    {
        return Some("Your AWS credentials have expired. Run `aws sso login` (or refresh your profile's credentials) and try again.");
    }
    if out.contains("unable to locate credentials") || out.contains("no credentials") {
        return Some(
            "No AWS credentials were found. Set a profile above, or configure credentials with `aws configure`.",
        );
    }
    if out.contains("targetnotconnected") {
        return Some(
            "The target is not connected to Systems Manager. Check that the SSM Agent is installed, running and has an instance profile allowing ssm:UpdateInstanceInformation.",
        );
    }
    if out.contains("ssm:startsession") || out.contains("accessdenied") || out.contains("not authorized") {
        return Some(
            "Access denied. The caller needs ssm:StartSession on this target and on the port-forwarding document.",
        );
    }
    if out.contains("invalidinstanceid") || out.contains("invalid instance id") {
        return Some(
            "The target was not found. Check the managed node id, and that the profile's region matches the one it runs in.",
        );
    }
    None
}

/// Append the actionable fix, when we can name one, to raw AWS output.
fn describe_failure(context: &str, output: &str) -> String {
    match classify_failure(output) {
        Some(hint) => format!("{}\n\n{}\n\nAWS output:\n{}", context, hint, output.trim()),
        None => format!("{}\n\nAWS output:\n{}", context, output.trim()),
    }
}

impl SsmTunnel {
    /// Open an AWS Systems Manager port-forwarding session and wait for the
    /// plugin to report the local port open.
    pub fn new(
        target: &str,
        profile: Option<&str>,
        region: Option<&str>,
        remote_host: &str,
        remote_port: u16,
    ) -> Result<Self, String> {
        eprintln!(
            "[SSM Tunnel] New request: target={}, remote={}:{}",
            target, remote_host, remote_port
        );

        let local_port = {
            let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| {
                let err = format!("Failed to find free local port: {}", e);
                eprintln!("[SSM Tunnel Error] {}", err);
                err
            })?;
            listener.local_addr().unwrap().port()
        };
        eprintln!("[SSM Tunnel] Assigned local port: {}", local_port);

        let args = build_start_session_args(
            target,
            profile,
            region,
            remote_host,
            remote_port,
            local_port,
        );
        eprintln!("[SSM Tunnel] Executing: aws {:?}", args);

        let mut child = aws_command()
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                let err = aws_spawn_error(&error);
                eprintln!("[SSM Tunnel Error] {}", err);
                err
            })?;

        let stdout_log = Arc::new(Mutex::new(Vec::with_capacity(LOG_BUFFER_INITIAL_CAPACITY)));
        let stderr_log = Arc::new(Mutex::new(Vec::with_capacity(LOG_BUFFER_INITIAL_CAPACITY)));
        let port_open = Arc::new(AtomicBool::new(false));

        if let Some(stdout) = child.stdout.take() {
            let log = stdout_log.clone();
            let port_open = port_open.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines().map_while(Result::ok) {
                    #[cfg(debug_assertions)]
                    eprintln!("[SSM aws Out] {}", line);
                    if is_ready_line(&line) {
                        port_open.store(true, Ordering::Relaxed);
                    }
                    if let Ok(mut g) = log.lock() {
                        g.push(line);
                    }
                }
            });
        }

        if let Some(stderr) = child.stderr.take() {
            let log = stderr_log.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    #[cfg(debug_assertions)]
                    eprintln!("[SSM aws Err] {}", line);
                    if let Ok(mut g) = log.lock() {
                        g.push(line);
                    }
                }
            });
        }

        let child_arc = Arc::new(Mutex::new(child));

        let collected_output = || {
            let stdout_content = stdout_log.lock().unwrap().join("\n");
            let stderr_content = stderr_log.lock().unwrap().join("\n");
            format!("{}\n{}", stderr_content, stdout_content)
        };

        let start = Instant::now();
        let timeout = Duration::from_secs(SSM_TUNNEL_TIMEOUT_SECS);
        let mut ready = false;

        while start.elapsed() < timeout {
            {
                let mut c = child_arc.lock().unwrap();
                if let Ok(Some(status)) = c.try_wait() {
                    let err_msg = describe_failure(
                        &format!(
                            "The AWS SSM session ended before the port was open (exit status {}).",
                            status
                        ),
                        &collected_output(),
                    );
                    eprintln!("[SSM Tunnel Error] {}", err_msg);
                    return Err(err_msg);
                }
            }

            if port_open.load(Ordering::Relaxed) {
                eprintln!(
                    "[SSM Tunnel] Tunnel established successfully on port {}",
                    local_port
                );
                ready = true;
                break;
            }

            thread::sleep(Duration::from_millis(SSM_CONNECT_RETRY_MS));
        }

        if !ready {
            if let Ok(mut c) = child_arc.lock() {
                stop_process_tree(&mut c);
            }
            let err = describe_failure(
                &format!(
                    "The AWS SSM session did not report an open port within {}s.",
                    SSM_TUNNEL_TIMEOUT_SECS
                ),
                &collected_output(),
            );
            eprintln!("[SSM Tunnel Error] {}", err);
            return Err(err);
        }

        Ok(Self {
            local_port,
            child: child_arc,
        })
    }

    /// An SSM session is torn down server-side on idle timeout or once
    /// MaxSessionDuration is reached, and the CLI exits with it. A cached tunnel
    /// therefore goes stale on its own, so reuse has to prove the process is
    /// still running rather than trust the map.
    pub fn is_alive(&self) -> bool {
        match self.child.lock() {
            Ok(mut c) => matches!(c.try_wait(), Ok(None)),
            Err(_) => false,
        }
    }

    pub fn stop(&self) {
        if let Ok(mut c) = self.child.lock() {
            stop_process_tree(&mut c);
            eprintln!("[SSM Tunnel] Stopped tunnel on port {}", self.local_port);
        }
    }
}

pub fn stop_all_tunnels() {
    if let Some(tunnels) = TUNNELS.get() {
        if let Ok(mut guard) = tunnels.lock() {
            for (_, tunnel) in guard.drain() {
                tunnel.stop();
            }
        }
    }
}

/// Build a deterministic tunnel map key from the session parameters.
#[inline]
pub fn build_tunnel_key(
    target: &str,
    profile: Option<&str>,
    region: Option<&str>,
    remote_host: &str,
    remote_port: u16,
) -> SsmTunnelKey {
    SsmTunnelKey {
        profile: normalize(profile),
        region: normalize(region),
        target: target.trim().to_string(),
        remote_host: remote_host.trim().to_string(),
        remote_port,
    }
}

/// Test an SSM connection by opening a real port-forwarding session and
/// tearing it down again. Nothing short of this exercises the credentials,
/// the Session Manager plugin and the target's reachability together.
pub fn test_ssm_connection(
    target: &str,
    profile: Option<&str>,
    region: Option<&str>,
    remote_host: &str,
    remote_port: u16,
) -> Result<String, String> {
    eprintln!("[SSM Test] Testing session to target={}", target);

    let tunnel = SsmTunnel::new(target, profile, region, remote_host, remote_port)?;
    let local_port = tunnel.local_port;
    tunnel.stop();

    eprintln!("[SSM Test] Connection successful!");
    Ok(format!(
        "Session opened via {} to {}:{} through {}, forwarded to 127.0.0.1:{}.",
        resolved_document(remote_host),
        remote_host.trim(),
        remote_port,
        target.trim(),
        local_port
    ))
}

#[cfg(test)]
mod tests;
