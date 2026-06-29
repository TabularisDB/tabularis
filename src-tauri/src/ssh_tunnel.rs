use async_trait::async_trait;
use russh::client;
use russh_keys::key;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::OnceLock;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc, Mutex,
};
use std::thread;
use std::time::{Duration, Instant};
use tokio::io::copy_bidirectional;
use tokio::runtime::Runtime;
use tokio::sync::Mutex as TokioMutex;

// Constants for timeouts and configuration
const SSH_TUNNEL_TIMEOUT_SECS: u64 = 10;
const SSH_AUTH_TIMEOUT_SECS: u64 = 30;
const SSH_ACCEPT_POLL_MS: u64 = 200;
const SSH_CONNECT_RETRY_MS: u64 = 100;
const DEFAULT_SSH_PORT: u16 = 22;
const LOG_BUFFER_INITIAL_CAPACITY: usize = 64;

#[derive(Clone)]
enum TunnelBackend {
    Russh(Arc<AtomicBool>),
    SystemSsh(Arc<Mutex<Child>>),
}

#[derive(Clone)]
struct RusshClientHandler {
    ssh_host: String,
    ssh_port: u16,
}

#[async_trait]
impl client::Handler for RusshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &key::PublicKey,
    ) -> Result<bool, Self::Error> {
        match russh_keys::check_known_hosts(&self.ssh_host, self.ssh_port, server_public_key) {
            Ok(true) => Ok(true),
            Ok(false) => {
                // Host not yet in known_hosts; add it (trust on first use)
                if let Err(e) =
                    russh_keys::learn_known_hosts(&self.ssh_host, self.ssh_port, server_public_key)
                {
                    eprintln!(
                        "[SSH Tunnel] Warning: could not save host key to known_hosts: {}",
                        e
                    );
                }
                Ok(true)
            }
            Err(russh_keys::Error::KeyChanged { line }) => {
                eprintln!(
                    "[SSH Tunnel Error] Host key mismatch at known_hosts line {}; \
                     possible MITM attack on {}:{}",
                    line, self.ssh_host, self.ssh_port
                );
                Err(russh::Error::KeyChanged { line })
            }
            Err(e) => {
                eprintln!("[SSH Tunnel Error] Host key check failed: {}", e);
                Err(russh::Error::CouldNotReadKey)
            }
        }
    }
}

#[derive(Clone)]
pub struct SshTunnel {
    pub local_port: u16,
    backend: TunnelBackend,
}

pub static TUNNELS: OnceLock<Mutex<HashMap<String, SshTunnel>>> = OnceLock::new();

pub fn get_tunnels() -> &'static Mutex<HashMap<String, SshTunnel>> {
    TUNNELS.get_or_init(|| Mutex::new(HashMap::new()))
}

impl SshTunnel {
    pub fn new(
        ssh_host: &str,
        ssh_port: u16,
        ssh_user: &str,
        ssh_password: Option<&str>,
        ssh_key_file: Option<&str>,
        ssh_key_passphrase: Option<&str>,
        ssh_allow_passphrase_prompt: bool,
        remote_host: &str,
        remote_port: u16,
    ) -> Result<Self, String> {
        let use_system_ssh = should_use_system_ssh(ssh_password);
        println!(
            "[SSH Tunnel] New Request: Host={}, Port={}, User={}, UseSystemSSH={}, AllowPrompt={}",
            ssh_host, ssh_port, ssh_user, use_system_ssh, ssh_allow_passphrase_prompt
        );

        let local_port = {
            let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| {
                let err = format!("Failed to find free local port: {}", e);
                eprintln!("[SSH Tunnel Error] {}", err);
                err
            })?;
            listener.local_addr().unwrap().port()
        };
        println!("[SSH Tunnel] Assigned Local Port: {}", local_port);

        if use_system_ssh {
            Self::new_system_ssh(
                ssh_host,
                ssh_port,
                ssh_user,
                ssh_key_file,
                ssh_allow_passphrase_prompt,
                remote_host,
                remote_port,
                local_port,
            )
            .map_err(|e| {
                eprintln!("[SSH Tunnel Error] System SSH failed: {}", e);
                e
            })
        } else {
            Self::new_russh(
                ssh_host,
                ssh_port,
                ssh_user,
                ssh_password,
                ssh_key_file,
                ssh_key_passphrase,
                remote_host,
                remote_port,
                local_port,
            )
            .map_err(|e| {
                eprintln!("[SSH Tunnel Error] Russh failed: {}", e);
                e
            })
        }
    }

    fn new_system_ssh(
        ssh_host: &str,
        ssh_port: u16,
        ssh_user: &str,
        ssh_key_file: Option<&str>,
        ssh_allow_passphrase_prompt: bool,
        remote_host: &str,
        remote_port: u16,
        local_port: u16,
    ) -> Result<Self, String> {
        let mut args = Vec::with_capacity(16); // Pre-allocate for typical argument count

        #[cfg(debug_assertions)]
        args.push("-v".to_string()); // Verbose mode only in debug

        args.push("-N".to_string()); // No remote command
        args.push("-L".to_string());
        // Explicitly bind to 127.0.0.1 to avoid ambiguity or public binding
        args.push(format!(
            "127.0.0.1:{}:{}:{}",
            local_port, remote_host, remote_port
        ));

        let destination = if !ssh_user.trim().is_empty() {
            format!("{}@{}", ssh_user, ssh_host)
        } else {
            ssh_host.to_string()
        };

        if ssh_port != DEFAULT_SSH_PORT {
            args.push("-p".to_string());
            args.push(ssh_port.to_string());
        }

        if let Some(key) = ssh_key_file.filter(|k| !k.trim().is_empty()) {
            args.push("-i".to_string());
            args.push(key.to_string());
        }

        args.push("-o".to_string());
        args.push("StrictHostKeyChecking=accept-new".to_string());
        args.push("-o".to_string());
        if ssh_allow_passphrase_prompt {
            args.push("BatchMode=no".to_string());
        } else {
            args.push("BatchMode=yes".to_string());
        }

        args.push(destination);

        println!("[SSH Tunnel] Executing: ssh {:?}", args);

        let mut command = Command::new("ssh");
        command
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let askpass_server = configure_askpass(&mut command, ssh_allow_passphrase_prompt)?;

        let mut child = command.spawn().map_err(|e| {
            let err = format!(
                "Failed to launch system ssh: {}. Ensure 'ssh' is in PATH.",
                e
            );
            eprintln!("[SSH Tunnel Error] {}", err);
            err
        })?;

        let stdout_log = Arc::new(Mutex::new(Vec::with_capacity(LOG_BUFFER_INITIAL_CAPACITY)));
        let stderr_log = Arc::new(Mutex::new(Vec::with_capacity(LOG_BUFFER_INITIAL_CAPACITY)));

        // Spawn threads to capture and log stdout/stderr in real-time
        if let Some(stdout) = child.stdout.take() {
            let log = stdout_log.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(l) = line {
                        #[cfg(debug_assertions)]
                        println!("[SSH System Out] {}", l);

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
                        eprintln!("[SSH System Err] {}", l);

                        if let Ok(mut g) = log.lock() {
                            g.push(l);
                        }
                    }
                }
            });
        }

        let child_arc = Arc::new(Mutex::new(child));

        // Wait for the tunnel to become ready (port listening)
        let mut start = Instant::now();
        let timeout = Duration::from_secs(SSH_TUNNEL_TIMEOUT_SECS);
        let mut ready = false;

        while start.elapsed() < timeout {
            // While the user is answering an askpass prompt (PIN entry,
            // security-key touch) the clock must not run against them. The
            // prompt itself is bounded by the askpass response timeout.
            if askpass_server.as_ref().is_some_and(|s| s.has_pending()) {
                start = Instant::now();
            }

            // Check if process is still alive
            {
                let mut c = child_arc.lock().unwrap();
                if let Ok(Some(status)) = c.try_wait() {
                    // Collect captured logs
                    let stdout_content = stdout_log.lock().unwrap().join("\n");
                    let stderr_content = stderr_log.lock().unwrap().join("\n");

                    let err_msg = format!(
                        "SSH process exited prematurely with status: {}.\nStderr: {}\nStdout: {}",
                        status, stderr_content, stdout_content
                    );
                    eprintln!("[SSH Tunnel Error] {}", err_msg);
                    return Err(err_msg);
                }
            }

            // Try connecting to the local port to see if forwarding is active
            match TcpStream::connect(format!("127.0.0.1:{}", local_port)) {
                Ok(_) => {
                    println!(
                        "[SSH Tunnel] Tunnel established successfully on port {}",
                        local_port
                    );
                    ready = true;
                    break;
                }
                Err(_) => {
                    // Not ready yet, wait a bit
                    thread::sleep(Duration::from_millis(SSH_CONNECT_RETRY_MS));
                }
            }
        }

        if !ready {
            // If we timed out, kill the process
            if let Ok(mut c) = child_arc.lock() {
                let _ = c.kill();
            }
            return Err("Timed out waiting for SSH tunnel to establish connection.".to_string());
        }

        Ok(Self {
            local_port,
            backend: TunnelBackend::SystemSsh(child_arc),
        })
    }

    fn new_russh(
        ssh_host: &str,
        ssh_port: u16,
        ssh_user: &str,
        ssh_password: Option<&str>,
        ssh_key_file: Option<&str>,
        ssh_key_passphrase: Option<&str>,
        remote_host: &str,
        remote_port: u16,
        local_port: u16,
    ) -> Result<Self, String> {
        println!("[SSH Tunnel] Russh connecting to {}:{}", ssh_host, ssh_port);
        let listener = TcpListener::bind(format!("127.0.0.1:{}", local_port)).map_err(|e| {
            let err = format!("Failed to bind local port {}: {}", local_port, e);
            eprintln!("[SSH Tunnel Error] {}", err);
            err
        })?;

        if let Err(e) = listener.set_nonblocking(true) {
            let err = format!("Failed to set listener nonblocking: {}", e);
            eprintln!("[SSH Tunnel Error] {}", err);
            return Err(err);
        }

        let running = Arc::new(AtomicBool::new(true));
        let running_clone = running.clone();
        let ssh_host = ssh_host.to_string();
        let ssh_user = ssh_user.to_string();
        let ssh_password = ssh_password.map(|p| p.to_string());
        let ssh_key_file = ssh_key_file.map(|p| p.to_string());
        let ssh_key_passphrase = ssh_key_passphrase.map(|p| p.to_string());
        let remote_host = remote_host.to_string();

        let (ready_tx, ready_rx) = mpsc::channel();

        thread::spawn(move || {
            let runtime = match Runtime::new() {
                Ok(rt) => rt,
                Err(e) => {
                    let err = format!("Failed to start Tokio runtime: {}", e);
                    eprintln!("[SSH Tunnel Error] {}", err);
                    let _ = ready_tx.send(Err(err));
                    return;
                }
            };

            let ready_tx_inner = ready_tx.clone();
            let result = runtime.block_on(async move {
                let config = Arc::new(client::Config::default());
                let addr = format!("{}:{}", ssh_host, ssh_port);

                let mut handle = client::connect(
                    config,
                    addr,
                    RusshClientHandler {
                        ssh_host: ssh_host.clone(),
                        ssh_port,
                    },
                )
                .await
                .map_err(|e| format!("Failed to connect to SSH server: {}", e))?;

                let authenticated = if let Some(key_path) =
                    ssh_key_file.as_deref().filter(|p| !p.trim().is_empty())
                {
                    println!("[SSH Tunnel] Authenticating with key file: {}", key_path);
                    let passphrase = ssh_key_passphrase
                        .as_deref()
                        .filter(|p| !p.trim().is_empty());
                    let key = russh_keys::load_secret_key(Path::new(key_path), passphrase)
                        .map_err(|e| format!("SSH key auth failed: {}", e))?;

                    tokio::time::timeout(
                        Duration::from_secs(SSH_AUTH_TIMEOUT_SECS),
                        handle.authenticate_publickey(&ssh_user, Arc::new(key)),
                    )
                    .await
                    .map_err(|_| {
                        format!(
                            "SSH key authentication timed out after {} seconds",
                            SSH_AUTH_TIMEOUT_SECS
                        )
                    })?
                    .map_err(|e| format!("SSH key auth failed: {}", e))?
                } else if let Some(pwd) = ssh_password.as_deref() {
                    println!(
                        "[SSH Tunnel] Authenticating with password (length: {})",
                        pwd.len()
                    );

                    let auth_result = tokio::time::timeout(
                        Duration::from_secs(SSH_AUTH_TIMEOUT_SECS),
                        handle.authenticate_password(&ssh_user, pwd),
                    )
                    .await
                    .map_err(|_| {
                        format!(
                            "SSH password authentication timed out after {} seconds",
                            SSH_AUTH_TIMEOUT_SECS
                        )
                    })?
                    .map_err(|e| format!("SSH password auth failed: {}", e))?;

                    println!(
                        "[SSH Tunnel] Password authentication result: {}",
                        auth_result
                    );
                    auth_result
                } else {
                    let err = "No SSH credentials provided for russh".to_string();
                    eprintln!("[SSH Tunnel Error] {}", err);
                    let _ = ready_tx_inner.send(Err(err.clone()));
                    return Err(err);
                };

                if !authenticated {
                    let err = "SSH authentication failed (authenticated=false)".to_string();
                    eprintln!("[SSH Tunnel Error] {}", err);
                    let _ = ready_tx_inner.send(Err(err.clone()));
                    return Err(err);
                }

                println!("[SSH Tunnel] Authentication successful! Setting up tunnel listener...");

                let listener = tokio::net::TcpListener::from_std(listener)
                    .map_err(|e| format!("Failed to configure async listener: {}", e))?;

                let handle = Arc::new(TokioMutex::new(handle));

                println!("[SSH Tunnel] Tunnel is ready, sending success signal");
                let _ = ready_tx_inner.send(Ok(()));

                println!("[SSH Tunnel] Starting tunnel forwarding loop");
                while running_clone.load(Ordering::Relaxed) {
                    let accept = tokio::time::timeout(
                        Duration::from_millis(SSH_ACCEPT_POLL_MS),
                        listener.accept(),
                    )
                    .await;

                    let (stream, _) = match accept {
                        Ok(Ok(result)) => result,
                        Ok(Err(e)) => {
                            eprintln!(
                                "[SSH Tunnel Error] Failed to accept local connection: {}",
                                e
                            );
                            continue;
                        }
                        Err(_) => continue,
                    };

                    let handle = handle.clone();
                    let r_host = remote_host.clone();
                    tokio::spawn(async move {
                        let handle = handle.lock().await;
                        let channel = match handle
                            .channel_open_direct_tcpip(
                                r_host,
                                u32::from(remote_port),
                                "127.0.0.1",
                                0,
                            )
                            .await
                        {
                            Ok(c) => c,
                            Err(e) => {
                                eprintln!("[SSH Tunnel Error] Failed to open SSH channel: {}", e);
                                return;
                            }
                        };
                        drop(handle);

                        let mut stream = stream;
                        let mut channel_stream = channel.into_stream();
                        if let Err(e) = copy_bidirectional(&mut stream, &mut channel_stream).await {
                            eprintln!("[SSH Tunnel Error] Forwarding failed: {}", e);
                        }
                    });
                }

                Ok(())
            });

            if let Err(err) = result {
                let _ = ready_tx.send(Err(err));
            }
        });

        match ready_rx.recv_timeout(Duration::from_secs(SSH_TUNNEL_TIMEOUT_SECS)) {
            Ok(Ok(())) => Ok(Self {
                local_port,
                backend: TunnelBackend::Russh(running),
            }),
            Ok(Err(err)) => Err(err),
            Err(_) => Err(format!(
                "Timed out waiting for Russh tunnel to initialize ({}s)",
                SSH_TUNNEL_TIMEOUT_SECS
            )),
        }
    }

    pub fn stop(&self) {
        match &self.backend {
            TunnelBackend::Russh(running) => {
                running.store(false, Ordering::Relaxed);
            }
            TunnelBackend::SystemSsh(child) => {
                if let Ok(mut c) = child.lock() {
                    let _ = c.kill();
                }
            }
        }
    }
}

/// Test an SSH connection without creating a tunnel
pub fn test_ssh_connection(
    ssh_host: &str,
    ssh_port: u16,
    ssh_user: &str,
    ssh_password: Option<&str>,
    ssh_key_file: Option<&str>,
    ssh_key_passphrase: Option<&str>,
    ssh_allow_passphrase_prompt: bool,
) -> Result<String, String> {
    let use_system_ssh = should_use_system_ssh(ssh_password);
    println!(
        "[SSH Test] Testing connection to {}:{} as {} (UseSystemSSH={}, AllowPrompt={})",
        ssh_host, ssh_port, ssh_user, use_system_ssh, ssh_allow_passphrase_prompt
    );

    if use_system_ssh {
        test_ssh_connection_system(
            ssh_host,
            ssh_port,
            ssh_user,
            ssh_key_file,
            ssh_allow_passphrase_prompt,
        )
    } else {
        test_ssh_connection_russh(
            ssh_host,
            ssh_port,
            ssh_user,
            ssh_password,
            ssh_key_file,
            ssh_key_passphrase,
        )
    }
}

/// Test SSH connection using system ssh command (supports ~/.ssh/config)
fn test_ssh_connection_system(
    ssh_host: &str,
    ssh_port: u16,
    ssh_user: &str,
    ssh_key_file: Option<&str>,
    ssh_allow_passphrase_prompt: bool,
) -> Result<String, String> {
    println!("[SSH Test] Using system SSH (supports ~/.ssh/config)");

    // Create owned strings to avoid lifetime issues
    let port_string = ssh_port.to_string();
    let destination = format!("{}@{}", ssh_user, ssh_host);

    let mut args = Vec::with_capacity(12);
    args.extend([
        "-o",
        if ssh_allow_passphrase_prompt {
            "BatchMode=no"
        } else {
            "BatchMode=yes"
        },
        "-o",
        "ConnectTimeout=10",
        "-o",
        "StrictHostKeyChecking=accept-new",
    ]);

    if ssh_port != DEFAULT_SSH_PORT {
        args.push("-p");
        args.push(&port_string);
    }

    if let Some(key) = ssh_key_file.filter(|k| !k.trim().is_empty()) {
        args.push("-i");
        args.push(key);
    }

    args.push(&destination);
    args.push("exit");

    println!("[SSH Test] Executing: ssh {:?}", args);

    let mut command = Command::new("ssh");
    command.args(&args);

    // Keep the askpass server alive while ssh runs: prompts can arrive at any
    // point until the process exits.
    let _askpass_server = configure_askpass(&mut command, ssh_allow_passphrase_prompt)?;

    let output = command.output().map_err(|e| {
        format!(
            "Failed to execute ssh command: {}. Ensure 'ssh' is in PATH.",
            e
        )
    })?;

    if output.status.success() {
        println!("[SSH Test] Connection successful!");
        Ok(format!(
            "SSH connection to {}@{}:{} established successfully!",
            ssh_user, ssh_host, ssh_port
        ))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let err = format!("SSH connection failed: {}", stderr.trim());
        eprintln!("[SSH Test Error] {}", err);
        Err(err)
    }
}

/// Async helper for testing SSH connection
async fn test_ssh_connection_russh_async(
    ssh_host: &str,
    ssh_port: u16,
    ssh_user: &str,
    ssh_password: Option<&str>,
    ssh_key_file: Option<&str>,
    ssh_key_passphrase: Option<&str>,
) -> Result<String, String> {
    let config = Arc::new(client::Config::default());
    let addr = format!("{}:{}", ssh_host, ssh_port);
    let mut handle = client::connect(
        config,
        addr,
        RusshClientHandler {
            ssh_host: ssh_host.to_string(),
            ssh_port,
        },
    )
    .await
    .map_err(|e| {
        format!(
            "Failed to connect to SSH server {}:{}: {}",
            ssh_host, ssh_port, e
        )
    })?;

    let authenticated = if let Some(key_path) = ssh_key_file.filter(|p| !p.trim().is_empty()) {
        println!("[SSH Test] Authenticating with key file: {}", key_path);
        // Don't filter empty passphrase - if provided, use it even if empty
        let key = russh_keys::load_secret_key(Path::new(key_path), ssh_key_passphrase)
            .map_err(|e| format!("SSH key authentication failed: {}", e))?;
        handle
            .authenticate_publickey(ssh_user, Arc::new(key))
            .await
            .map_err(|e| format!("SSH key authentication failed: {}", e))?
    } else if let Some(pwd) = ssh_password {
        println!("[SSH Test] Authenticating with password");
        handle
            .authenticate_password(ssh_user, pwd)
            .await
            .map_err(|e| format!("SSH password authentication failed: {}", e))?
    } else {
        let err = "No SSH credentials provided for russh".to_string();
        eprintln!("[SSH Test Error] {}", err);
        return Err(err);
    };

    if !authenticated {
        let err = "SSH authentication failed".to_string();
        eprintln!("[SSH Test Error] {}", err);
        return Err(err);
    }

    println!("[SSH Test] Connection successful!");
    Ok(format!(
        "SSH connection to {}@{}:{} established successfully!",
        ssh_user, ssh_host, ssh_port
    ))
}

/// Test SSH connection using russh (for password authentication)
fn test_ssh_connection_russh(
    ssh_host: &str,
    ssh_port: u16,
    ssh_user: &str,
    ssh_password: Option<&str>,
    ssh_key_file: Option<&str>,
    ssh_key_passphrase: Option<&str>,
) -> Result<String, String> {
    println!("[SSH Test] Using russh for authentication");

    // Convert parameters to owned strings for the thread
    let ssh_host = ssh_host.to_string();
    let ssh_user = ssh_user.to_string();
    let ssh_password = ssh_password.map(|s| s.to_string());
    let ssh_key_file = ssh_key_file.map(|s| s.to_string());
    let ssh_key_passphrase = ssh_key_passphrase.map(|s| s.to_string());

    // Use std::thread::spawn to run in a completely separate OS thread
    // This avoids any Tokio runtime nesting issues
    std::thread::spawn(move || {
        let runtime =
            Runtime::new().map_err(|e| format!("Failed to start Tokio runtime: {}", e))?;
        runtime.block_on(test_ssh_connection_russh_async(
            &ssh_host,
            ssh_port,
            &ssh_user,
            ssh_password.as_deref(),
            ssh_key_file.as_deref(),
            ssh_key_passphrase.as_deref(),
        ))
    })
    .join()
    .map_err(|e| format!("Thread panicked: {:?}", e))?
}

/// When passphrase/PIN prompts are allowed, wire ssh's askpass machinery to
/// the in-app prompt bridge (see the `askpass` module). Falls back to the
/// system askpass helper when the app is not fully initialised (e.g. tests),
/// preserving the plain `SSH_ASKPASS_REQUIRE=force` behaviour.
fn configure_askpass(
    command: &mut Command,
    ssh_allow_passphrase_prompt: bool,
) -> Result<Option<crate::askpass::AskpassServer>, String> {
    if !ssh_allow_passphrase_prompt {
        return Ok(None);
    }
    match crate::askpass::start_frontend_server() {
        Ok(server) => {
            server.configure_command(command)?;
            println!(
                "[SSH Tunnel] In-app askpass bridge active at {}",
                server.endpoint()
            );
            Ok(Some(server))
        }
        Err(e) => {
            eprintln!(
                "[SSH Tunnel] In-app askpass unavailable ({}); falling back to system askpass",
                e
            );
            command.env("SSH_ASKPASS_REQUIRE", "force");
            Ok(None)
        }
    }
}

/// Build tunnel map key from SSH parameters.
/// This is a pure function that can be tested in isolation.
#[inline]
pub fn build_tunnel_key(
    ssh_user: &str,
    ssh_host: &str,
    ssh_port: u16,
    remote_host: &str,
    remote_port: u16,
) -> String {
    format!(
        "{}@{}:{}:{}->{}",
        ssh_user, ssh_host, ssh_port, remote_host, remote_port
    )
}

/// Check if a string is empty or contains only whitespace.
#[inline]
fn is_empty_or_whitespace(s: Option<&str>) -> bool {
    s.map(|p| p.trim().is_empty()).unwrap_or(true)
}

/// Determine if system SSH should be used based on password availability.
/// System SSH with BatchMode=yes can't handle interactive password auth.
#[inline]
pub fn should_use_system_ssh(ssh_password: Option<&str>) -> bool {
    is_empty_or_whitespace(ssh_password)
}

#[cfg(test)]
mod tests {
    use super::*;

    mod build_tunnel_key_tests {
        use super::*;

        #[test]
        fn test_basic_key_format() {
            let key = build_tunnel_key("user", "host.example.com", 22, "db.internal", 3306);
            assert_eq!(key, "user@host.example.com:22:db.internal->3306");
        }

        #[test]
        fn test_non_standard_port() {
            let key = build_tunnel_key("admin", "jump.server", 2222, "localhost", 5432);
            assert_eq!(key, "admin@jump.server:2222:localhost->5432");
        }

        #[test]
        fn test_empty_user() {
            let key = build_tunnel_key("", "host", 22, "remote", 80);
            assert_eq!(key, "@host:22:remote->80");
        }
    }

    mod should_use_system_ssh_tests {
        use super::*;

        #[test]
        fn test_none_password_uses_system() {
            assert!(should_use_system_ssh(None));
        }

        #[test]
        fn test_empty_password_uses_system() {
            assert!(should_use_system_ssh(Some("")));
        }

        #[test]
        fn test_whitespace_password_uses_system() {
            assert!(should_use_system_ssh(Some("   ")));
        }

        #[test]
        fn test_valid_password_uses_russh() {
            assert!(!should_use_system_ssh(Some("secret")));
        }

        #[test]
        fn test_password_with_spaces_uses_russh() {
            assert!(!should_use_system_ssh(Some("my password")));
        }
    }

    mod is_empty_or_whitespace_tests {
        use super::*;

        #[test]
        fn test_none_is_empty() {
            assert!(is_empty_or_whitespace(None));
        }

        #[test]
        fn test_empty_string_is_empty() {
            assert!(is_empty_or_whitespace(Some("")));
        }

        #[test]
        fn test_whitespace_is_empty() {
            assert!(is_empty_or_whitespace(Some("  \t\n  ")));
        }

        #[test]
        fn test_content_is_not_empty() {
            assert!(!is_empty_or_whitespace(Some("content")));
        }

        #[test]
        fn test_content_with_whitespace_is_not_empty() {
            assert!(!is_empty_or_whitespace(Some("  content  ")));
        }
    }
}
