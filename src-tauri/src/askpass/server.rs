//! Askpass server.
//!
//! Listens on a private local socket for prompt requests coming from askpass
//! client processes (see `client.rs`) and bridges them to an [`AskpassUi`]
//! implementation. The server lives only as long as the ssh process that
//! needs it: the SSH tunnel code starts one, injects its endpoint into the
//! ssh command's environment, and drops it once the tunnel is up (or failed).

use std::io::{BufRead, BufReader, Write};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use super::client::{SOCKET_ENV, TOKEN_ENV};
use super::protocol::{decode_request, encode_response, PromptKind};

const ACCEPT_POLL_MS: u64 = 100;

/// `sockaddr_un.sun_path` on macOS is 104 bytes, including the trailing NUL.
#[cfg(unix)]
const UNIX_SUN_PATH_MAX: usize = 103;

/// Credentials already collected in the connection form. Matching prompts are
/// answered from these values, so a saved passphrase or password does not
/// require a second interactive prompt.
#[derive(Clone, Default)]
pub struct AskpassOptions {
    pub password: Option<String>,
    pub key_passphrase: Option<String>,
    /// Private key path passed to `ssh -i`. The stored passphrase is returned
    /// only for OpenSSH's local prompt for this path.
    pub key_path: Option<String>,
    /// Show the in-app modal for prompts that stored credentials do not answer.
    pub allow_ui: bool,
}

impl AskpassOptions {
    /// Interactive prompts and no stored credentials.
    pub fn interactive() -> Self {
        Self {
            allow_ui: true,
            ..Self::default()
        }
    }
}

#[derive(Default)]
pub(super) struct StoredSecrets {
    pub(super) password: Option<String>,
    pub(super) key_passphrase: Option<String>,
    pub(super) key_path: Option<String>,
}

/// Bytes of the key path OpenSSH includes in its local passphrase prompt
/// (`%.100s` in `authfile.c`).
pub(super) const OPENSSH_KEY_PATH_PROMPT_BYTES: usize = 100;

impl StoredSecrets {
    fn from_options(options: &AskpassOptions) -> Self {
        Self {
            password: non_blank(options.password.clone()),
            key_passphrase: non_blank(options.key_passphrase.clone()),
            key_path: non_blank(options.key_path.clone()),
        }
    }

    /// Return a stored secret for this prompt, consuming it so a rejected
    /// value is not submitted again in a loop.
    ///
    /// The key passphrase is released only for OpenSSH's own local prompt for
    /// the selected key. A remote keyboard-interactive prompt can say
    /// "passphrase" but cannot know that full local path. The account password
    /// is released for password prompts, because that secret is for this server.
    pub(super) fn take_for_prompt(&mut self, prompt: &str) -> Option<String> {
        if let Some(path) = self.key_path.as_deref() {
            // OpenSSH expands a leading `~` in `-i` before building the prompt.
            let expanded = expand_leading_tilde(path);
            if prompt == openssh_key_passphrase_prompt(&expanded) {
                return self.key_passphrase.take();
            }
        }
        if prompt.to_ascii_lowercase().contains("password") {
            return self.password.take();
        }
        None
    }
}

/// Expand a leading `~` or `~/` to the current user's home directory.
/// `~otheruser` is left unchanged. If the home directory is unavailable, the
/// path is returned as typed.
fn expand_leading_tilde(path: &str) -> String {
    let relative = if path == "~" {
        Some("")
    } else {
        path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\"))
    };
    match (relative, directories::BaseDirs::new()) {
        (Some(rest), Some(base_dirs)) => base_dirs
            .home_dir()
            .join(rest)
            .to_string_lossy()
            .into_owned(),
        _ => path.to_string(),
    }
}

/// `Enter passphrase for key '<path>': `, matching OpenSSH `authfile.c`.
pub(super) fn openssh_key_passphrase_prompt(key_path: &str) -> String {
    let shown = openssh_displayed_key_path(key_path);
    format!("Enter passphrase for key '{shown}': ")
}

fn openssh_displayed_key_path(key_path: &str) -> &str {
    if key_path.len() <= OPENSSH_KEY_PATH_PROMPT_BYTES {
        return key_path;
    }
    let mut end = OPENSSH_KEY_PATH_PROMPT_BYTES;
    while end > 0 && !key_path.is_char_boundary(end) {
        end -= 1;
    }
    &key_path[..end]
}

fn non_blank(value: Option<String>) -> Option<String> {
    value.filter(|v| !v.trim().is_empty())
}

/// Pick a socket path that fits in `sun_path`. macOS per-user temp directories
/// (`/var/folders/.../T`) plus a long file name exceed 104 bytes, `bind` fails,
/// and OpenSSH then executes its compiled-in `/usr/X11R6/bin/ssh-askpass`.
#[cfg(unix)]
pub(crate) fn askpass_socket_path() -> Result<std::path::PathBuf, String> {
    let name = format!(
        "tb-ask-{}.sock",
        &uuid::Uuid::new_v4().simple().to_string()[..12]
    );
    let candidates = [
        std::env::temp_dir().join(&name),
        std::path::PathBuf::from("/tmp").join(&name),
    ];
    candidates
        .into_iter()
        .find(|path| path.to_string_lossy().len() <= UNIX_SUN_PATH_MAX)
        .ok_or_else(|| {
            "Could not find a directory short enough for the SSH askpass socket".to_string()
        })
}

/// User-interface side of an askpass exchange. Implementations block inside
/// [`AskpassUi::request`] until the user answers (or a timeout fires).
pub trait AskpassUi: Send + Sync {
    /// Ask the user to answer a secret or confirmation prompt. `None` means
    /// the prompt was cancelled.
    fn request(&self, kind: PromptKind, prompt: &str) -> Option<String>;
    /// Show a notification that requires no textual answer (e.g. "touch your
    /// security key"). Returns an identifier used to dismiss it later.
    fn show_notification(&self, prompt: &str) -> u64;
    /// Remove a notification previously shown via `show_notification`.
    fn dismiss_notification(&self, id: u64);
}

pub struct AskpassServer {
    endpoint: String,
    token: String,
    pending: Arc<AtomicUsize>,
    stop: Arc<AtomicBool>,
    #[cfg(unix)]
    socket_path: std::path::PathBuf,
}

impl AskpassServer {
    /// Bind the local socket and spawn the accept loop.
    pub fn start(ui: Arc<dyn AskpassUi>) -> Result<Self, String> {
        Self::start_with(ui, AskpassOptions::interactive())
    }

    /// Like [`Self::start`], but stored credentials can answer prompts before
    /// the UI is shown.
    pub fn start_with(ui: Arc<dyn AskpassUi>, options: AskpassOptions) -> Result<Self, String> {
        let pending = Arc::new(AtomicUsize::new(0));
        let stop = Arc::new(AtomicBool::new(false));
        let allow_ui = options.allow_ui;
        let secrets = Arc::new(std::sync::Mutex::new(StoredSecrets::from_options(&options)));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            use std::os::unix::net::UnixListener;

            let socket_path = askpass_socket_path()?;
            let listener = UnixListener::bind(&socket_path)
                .map_err(|e| format!("Failed to bind askpass socket: {}", e))?;
            // The socket carries secrets: restrict it to the current user.
            // Mode 0600 is not enough on its own — the path is listable — so
            // clients must also present `token`.
            std::fs::set_permissions(&socket_path, std::fs::Permissions::from_mode(0o600))
                .map_err(|e| format!("Failed to restrict askpass socket permissions: {}", e))?;
            listener
                .set_nonblocking(true)
                .map_err(|e| format!("Failed to configure askpass socket: {}", e))?;

            let endpoint = socket_path.to_string_lossy().to_string();
            let token = uuid::Uuid::new_v4().simple().to_string();
            spawn_accept_loop(
                listener,
                ui,
                pending.clone(),
                stop.clone(),
                secrets,
                allow_ui,
                token.clone(),
            );
            Ok(Self {
                endpoint,
                token,
                pending,
                stop,
                socket_path,
            })
        }

        #[cfg(windows)]
        {
            use std::net::TcpListener;

            let listener = TcpListener::bind("127.0.0.1:0")
                .map_err(|e| format!("Failed to bind askpass socket: {}", e))?;
            let endpoint = listener
                .local_addr()
                .map_err(|e| format!("Failed to read askpass socket address: {}", e))?
                .to_string();
            listener
                .set_nonblocking(true)
                .map_err(|e| format!("Failed to configure askpass socket: {}", e))?;

            let token = uuid::Uuid::new_v4().simple().to_string();
            spawn_accept_loop(
                listener,
                ui,
                pending.clone(),
                stop.clone(),
                secrets,
                allow_ui,
                token.clone(),
            );
            Ok(Self {
                endpoint,
                token,
                pending,
                stop,
            })
        }
    }

    /// Endpoint clients must connect to (socket path or `host:port`).
    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    /// Point ssh's askpass machinery at this server: ssh re-executes the
    /// Tabularis binary, which detects [`SOCKET_ENV`] and runs in client mode.
    pub fn configure_command(&self, command: &mut Command) -> Result<(), String> {
        let exe = std::env::current_exe()
            .map_err(|e| format!("Failed to locate Tabularis executable: {}", e))?;
        command
            .env("SSH_ASKPASS", exe)
            .env("SSH_ASKPASS_REQUIRE", "force")
            .env(SOCKET_ENV, &self.endpoint)
            .env(TOKEN_ENV, &self.token);
        Ok(())
    }

    /// Shared secret the askpass client must send before any prompt is served.
    #[cfg(test)]
    pub(crate) fn token(&self) -> &str {
        &self.token
    }

    /// Whether a prompt is currently waiting on the user. Callers use this to
    /// pause connection timeouts while the user is typing a PIN.
    pub fn has_pending(&self) -> bool {
        self.pending.load(Ordering::Relaxed) > 0
    }
}

impl Drop for AskpassServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        #[cfg(unix)]
        let _ = std::fs::remove_file(&self.socket_path);
    }
}

#[cfg(unix)]
fn spawn_accept_loop(
    listener: std::os::unix::net::UnixListener,
    ui: Arc<dyn AskpassUi>,
    pending: Arc<AtomicUsize>,
    stop: Arc<AtomicBool>,
    secrets: Arc<std::sync::Mutex<StoredSecrets>>,
    allow_ui: bool,
    token: String,
) {
    thread::spawn(move || {
        while !stop.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let ui = ui.clone();
                    let pending = pending.clone();
                    let secrets = secrets.clone();
                    let token = token.clone();
                    thread::spawn(move || {
                        handle_connection(stream, ui, pending, secrets, allow_ui, &token)
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(ACCEPT_POLL_MS));
                }
                Err(e) => {
                    eprintln!("[Askpass] Accept failed: {}", e);
                    thread::sleep(Duration::from_millis(ACCEPT_POLL_MS));
                }
            }
        }
    });
}

#[cfg(windows)]
fn spawn_accept_loop(
    listener: std::net::TcpListener,
    ui: Arc<dyn AskpassUi>,
    pending: Arc<AtomicUsize>,
    stop: Arc<AtomicBool>,
    secrets: Arc<std::sync::Mutex<StoredSecrets>>,
    allow_ui: bool,
    token: String,
) {
    thread::spawn(move || {
        while !stop.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let ui = ui.clone();
                    let pending = pending.clone();
                    let secrets = secrets.clone();
                    let token = token.clone();
                    thread::spawn(move || {
                        let mut reader =
                            BufReader::new(stream.try_clone().expect("clone askpass stream"));
                        let mut auth = String::new();
                        if reader.read_line(&mut auth).is_err()
                            || auth.trim_end_matches(['\n', '\r']) != format!("AUTH {}", token)
                        {
                            eprintln!("[Askpass] Rejected connection with bad token");
                            return;
                        }
                        handle_authenticated(reader, stream, ui, pending, secrets, allow_ui);
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(ACCEPT_POLL_MS));
                }
                Err(e) => {
                    eprintln!("[Askpass] Accept failed: {}", e);
                    thread::sleep(Duration::from_millis(ACCEPT_POLL_MS));
                }
            }
        }
    });
}

#[cfg(unix)]
fn handle_connection(
    stream: std::os::unix::net::UnixStream,
    ui: Arc<dyn AskpassUi>,
    pending: Arc<AtomicUsize>,
    secrets: Arc<std::sync::Mutex<StoredSecrets>>,
    allow_ui: bool,
    token: &str,
) {
    // macOS accepted sockets inherit O_NONBLOCK from the listener. The client
    // writes AUTH and the request separately, so a nonblocking read between
    // those writes returns WouldBlock and the connection is rejected.
    if let Err(e) = stream.set_nonblocking(false) {
        eprintln!("[Askpass] Failed to make connection blocking: {}", e);
        return;
    }
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[Askpass] Failed to clone stream: {}", e);
            return;
        }
    });
    let mut auth = String::new();
    if reader.read_line(&mut auth).is_err()
        || auth.trim_end_matches(['\n', '\r']) != format!("AUTH {}", token)
    {
        eprintln!("[Askpass] Rejected connection with bad token");
        return;
    }
    handle_authenticated(reader, stream, ui, pending, secrets, allow_ui);
}

/// Serve a single askpass exchange on an already-authenticated connection.
fn handle_authenticated<R, W>(
    mut reader: BufReader<R>,
    mut writer: W,
    ui: Arc<dyn AskpassUi>,
    pending: Arc<AtomicUsize>,
    secrets: Arc<std::sync::Mutex<StoredSecrets>>,
    allow_ui: bool,
) where
    R: std::io::Read,
    W: Write,
{
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() {
        return;
    }
    let Some((kind, prompt)) = decode_request(line.trim_end_matches(['\n', '\r'])) else {
        eprintln!("[Askpass] Ignoring malformed request");
        return;
    };

    if kind == PromptKind::Secret {
        let stored = secrets
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take_for_prompt(&prompt);
        if let Some(secret) = stored {
            let reply = format!("{}\n", encode_response(Some(&secret)));
            if let Err(e) = writer
                .write_all(reply.as_bytes())
                .and_then(|_| writer.flush())
            {
                eprintln!("[Askpass] Failed to send stored secret: {}", e);
            }
            return;
        }
    }

    if !allow_ui {
        if kind != PromptKind::Notify {
            let reply = format!("{}\n", encode_response(None));
            let _ = writer
                .write_all(reply.as_bytes())
                .and_then(|_| writer.flush());
        }
        return;
    }

    pending.fetch_add(1, Ordering::Relaxed);
    // Make sure the counter is decremented on every exit path.
    let _guard = PendingGuard(pending);

    match kind {
        PromptKind::Secret | PromptKind::Confirm => {
            let response = ui.request(kind, &prompt);
            let reply = format!("{}\n", encode_response(response.as_deref()));
            if let Err(e) = writer
                .write_all(reply.as_bytes())
                .and_then(|_| writer.flush())
            {
                eprintln!("[Askpass] Failed to send response: {}", e);
            }
        }
        PromptKind::Notify => {
            // No answer expected: keep the notification up until the client
            // process dies (ssh kills it once the key was touched), which we
            // observe as EOF on the connection.
            let id = ui.show_notification(&prompt);
            let mut rest = String::new();
            let _ = reader.read_line(&mut rest);
            ui.dismiss_notification(id);
        }
    }
}

struct PendingGuard(Arc<AtomicUsize>);

impl Drop for PendingGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}
