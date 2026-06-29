//! Askpass client mode.
//!
//! When the SSH tunnel code launches `ssh` with `SSH_ASKPASS` pointing at the
//! Tabularis executable, ssh re-runs this binary with the prompt as its only
//! argument. This module detects that situation (via the endpoint env var the
//! server injected), forwards the prompt to the main Tabularis process over a
//! local socket, prints the user's answer to stdout for ssh, and exits without
//! ever booting the full application.

use std::io::{BufRead, BufReader, Read, Write};

use super::protocol::{decode_response, encode_request, PromptKind};

/// Env var carrying the server endpoint: a unix socket path on unix, a
/// `127.0.0.1:<port>` address on Windows.
pub const SOCKET_ENV: &str = "TABULARIS_ASKPASS_SOCKET";
/// Windows only: shared secret proving the client was spawned by Tabularis.
#[cfg(windows)]
pub const TOKEN_ENV: &str = "TABULARIS_ASKPASS_TOKEN";

/// If we were invoked as ssh's askpass helper, run the client and exit the
/// process with the appropriate status. Returns without side effects when the
/// endpoint env var is absent (normal application startup).
pub fn maybe_run_askpass_client() {
    let Ok(endpoint) = std::env::var(SOCKET_ENV) else {
        return;
    };
    let prompt = std::env::args().nth(1).unwrap_or_default();
    let kind = PromptKind::from_ssh_env(std::env::var("SSH_ASKPASS_PROMPT").ok().as_deref());
    std::process::exit(run(&endpoint, kind, &prompt));
}

/// Exit code contract with ssh: 0 with the secret on stdout means success;
/// any non-zero status means the user cancelled (for `confirm` prompts ssh
/// only looks at the status).
fn run(endpoint: &str, kind: PromptKind, prompt: &str) -> i32 {
    let stream = match connect(endpoint) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[Askpass] Failed to reach Tabularis: {}", e);
            return 1;
        }
    };
    match exchange(stream, kind, prompt) {
        Ok(Some(secret)) => {
            println!("{}", secret);
            0
        }
        Ok(None) => 1,
        Err(e) => {
            eprintln!("[Askpass] {}", e);
            1
        }
    }
}

/// Send the request line and wait for the response.
///
/// For [`PromptKind::Notify`] the server never answers: the notification stays
/// on screen until ssh kills this process (user touched the key), at which
/// point the dropped connection tells the server to dismiss it. Blocking on a
/// read that only ever yields EOF gives exactly that behaviour.
fn exchange<S: Read + Write>(
    mut stream: S,
    kind: PromptKind,
    prompt: &str,
) -> Result<Option<String>, String> {
    let request = format!("{}\n", encode_request(kind, prompt));
    stream
        .write_all(request.as_bytes())
        .and_then(|_| stream.flush())
        .map_err(|e| format!("Failed to send prompt: {}", e))?;

    let mut line = String::new();
    BufReader::new(stream)
        .read_line(&mut line)
        .map_err(|e| format!("Failed to read response: {}", e))?;
    if line.is_empty() {
        // EOF without a response: server gone or notification dismissed.
        return Ok(None);
    }
    decode_response(line.trim_end_matches(['\n', '\r']))
        .ok_or_else(|| "Malformed response from Tabularis".to_string())
}

#[cfg(unix)]
fn connect(endpoint: &str) -> Result<std::os::unix::net::UnixStream, String> {
    std::os::unix::net::UnixStream::connect(endpoint)
        .map_err(|e| format!("connect({}): {}", endpoint, e))
}

#[cfg(windows)]
fn connect(endpoint: &str) -> Result<std::net::TcpStream, String> {
    let mut stream = std::net::TcpStream::connect(endpoint)
        .map_err(|e| format!("connect({}): {}", endpoint, e))?;
    // Authenticate first: anyone on the machine can reach a loopback port.
    let token = std::env::var(TOKEN_ENV).map_err(|_| "Missing askpass token".to_string())?;
    stream
        .write_all(format!("AUTH {}\n", token).as_bytes())
        .map_err(|e| format!("Failed to send auth token: {}", e))?;
    Ok(stream)
}
