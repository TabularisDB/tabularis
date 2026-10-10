use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

#[derive(Clone)]
pub struct ResponseState {
    pub bytes: Vec<u8>,
    pub version: String,
    pub tags: Vec<String>,
    pub assets: Option<Value>,
    pub screenshots: Vec<Value>,
    pub hash: Option<String>,
    pub invalid_signature: bool,
    pub oversize: bool,
    pub delay_download: bool,
}

pub struct RegistryServer {
    pub base: String,
    pub requests: Arc<Mutex<Vec<String>>>,
    pub state: Arc<Mutex<ResponseState>>,
    stopped: Arc<AtomicBool>,
    accepted_connections: Arc<AtomicUsize>,
    thread: Option<thread::JoinHandle<()>>,
}

impl RegistryServer {
    pub fn new(bytes: Vec<u8>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let stopped = Arc::new(AtomicBool::new(false));
        let accepted_connections = Arc::new(AtomicUsize::new(0));
        let state = Arc::new(Mutex::new(ResponseState {
            bytes,
            version: "1.0.0".into(),
            tags: vec!["blue".into(), "theme".into()],
            assets: None,
            screenshots: vec![],
            hash: None,
            invalid_signature: false,
            oversize: false,
            delay_download: false,
        }));
        let (log, stop, source, url, accepted) = (
            requests.clone(),
            stopped.clone(),
            state.clone(),
            base.clone(),
            accepted_connections.clone(),
        );
        // Binding to port 0 already delegates uniqueness to the OS. The
        // failure under parallel tests is not a fixed-port collision: this
        // fixture also needs to serve a new request when a previous client's
        // TCP connection is slow or incomplete.
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
        let thread = thread::spawn(move || {
            let mut workers = Vec::new();
            let _ = ready_tx.send(());
            while !stop.load(Ordering::SeqCst) {
                let (stream, _) = match listener.accept() {
                    Ok(value) => value,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                        continue;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(error) => panic!("Loopback fixture: {error}"),
                };
                accepted.fetch_add(1, Ordering::Release);
                let log = log.clone();
                let source = source.clone();
                let url = url.clone();
                workers.push(thread::spawn(move || {
                    serve_connection(stream, &url, &log, &source);
                }));
            }
            // Requests accepted before shutdown must finish before the
            // fixture state is dropped. Each socket has bounded IO timeouts.
            for worker in workers {
                worker.join().expect("loopback fixture worker panicked");
            }
        });
        ready_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("loopback registry fixture failed to start");
        Self {
            base,
            requests,
            state,
            stopped,
            accepted_connections,
            thread: Some(thread),
        }
    }
    pub fn tracked(&self) -> Vec<String> {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .filter(|path| {
                let route = path.split('?').next().unwrap_or(path).trim_end_matches('/');
                // These routes increment counters even without redirect=1. Integrity
                // endpoints and asset delivery are separate read-only requests.
                route == "/api/plugins/fixture-theme/latest"
                    || route
                        .strip_prefix("/api/plugins/fixture-theme/releases/")
                        .is_some_and(|version| !version.is_empty() && !version.contains('/'))
            })
            .cloned()
            .collect()
    }
}

impl Drop for RegistryServer {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            thread.join().unwrap();
        }
    }
}

/// Serve each TCP connection independently. A stalled request must not
/// monopolize the only listener thread and starve a concurrent SDK request.
fn serve_connection(
    mut stream: TcpStream,
    base: &str,
    requests: &Arc<Mutex<Vec<String>>>,
    state: &Arc<Mutex<ResponseState>>,
) {
    // Some platforms inherit the listener's nonblocking mode. Use bounded
    // blocking IO consistently for the small synchronous test HTTP server.
    if stream.set_nonblocking(false).is_err()
        || stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .is_err()
        || stream
            .set_write_timeout(Some(Duration::from_secs(2)))
            .is_err()
    {
        return;
    }
    let mut first = String::new();
    {
        let mut reader = BufReader::new(&mut stream);
        if reader.read_line(&mut first).is_err() || first.is_empty() {
            return;
        }
        let mut complete_headers = false;
        for _ in 0..64 {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => return,
                Ok(_) if line == "\r\n" || line == "\n" => {
                    complete_headers = true;
                    break;
                },
                Ok(_) => {}
            }
        }
        if !complete_headers {
            return;
        }
    }
    let path = first.split_whitespace().nth(1).unwrap_or("").to_string();
    requests.lock().unwrap().push(path.clone());
    let snapshot = state.lock().unwrap().clone();
    let (status, headers, body) = response(base, &path, &snapshot);
    if snapshot.delay_download && path.starts_with("/asset/") {
        thread::sleep(Duration::from_millis(250));
    }
    let length = if snapshot.oversize && path.starts_with("/asset/") {
        8 * 1024 * 1024 + 1
    } else {
        body.len()
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Length: {length}\r\nConnection: close\r\nContent-Type: application/json\r\n{headers}\r\n"
    );
    let _ = stream.write_all(&body);
}

fn detail(base: &str, state: &ResponseState) -> Value {
    let sha = state
        .hash
        .clone()
        .unwrap_or_else(|| format!("{:x}", Sha256::digest(&state.bytes)));
    let assets = state.assets.clone().unwrap_or_else(|| json!({"universal":{"url":format!("{base}/asset/theme.zip"),"sha256":sha,"size":state.bytes.len()}}));
    json!({"id":"fixture-theme","ownerId":"fixture-owner","name":"Fixture theme","description":"Loopback only","author":"Test","repoUrl":format!("{base}/repo"),"homepage":base,"latestVersion":state.version,"status":"approved","tags":state.tags,"screenshots":state.screenshots,"featured":false,"verified":false,"downloads":0,"readmeAvailableLocales":[],"createdAt":0,"updatedAt":0,
        "releases":[{"id":"fixture-release","pluginId":"fixture-theme","version":state.version,"minRuntimeVersion":"0.24.0","assets":assets,"createdAt":0,"integrity":null}]})
}

fn response(base: &str, path: &str, state: &ResponseState) -> (&'static str, String, Vec<u8>) {
    let route = path.split('?').next().unwrap_or(path).trim_end_matches('/');
    let value = if route == "/api/kinds" {
        json!({"kinds":[{"key":"driver","label":"Driver"},{"key":"theme","label":"Theme"},{"key":"extension","label":"Extension"}]})
    } else if route == "/api/plugins" {
        json!({"total":1,"page":1,"limit":100,"plugins":[detail(base,state)],"facets":{"categories":[],"kinds":[]}})
    } else if route == "/api/plugins/fixture-theme" {
        detail(base, state)
    } else if route.ends_with("/integrity") {
        if state.invalid_signature {
            json!({"slug":"fixture-theme","version":state.version,"jws":"invalid.fixture.signature","assets":[]})
        } else {
            json!({"slug":"fixture-theme","version":state.version,"assets":{}})
        }
    } else if path.contains("jwks") {
        json!({"keys":[]})
    } else if path.contains("redirect=1") {
        return (
            "302 Found",
            format!("Location: {base}/asset/theme.zip\r\n"),
            vec![],
        );
    } else if path.starts_with("/asset/") {
        return ("200 OK", String::new(), state.bytes.clone());
    } else {
        return ("404 Not Found", String::new(), b"{}".to_vec());
    };
    ("200 OK", String::new(), serde_json::to_vec(&value).unwrap())
}

#[cfg(test)]
mod concurrency_tests {
    use super::*;
    use std::io::{Read, Write};

    fn get_kinds(base: &str) -> String {
        let address = base.strip_prefix("http://").unwrap();
        let mut connection = TcpStream::connect(address).expect("connect to loopback fixture");
        connection
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        connection
            .write_all(b"GET /api/kinds HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut received = String::new();
        connection
            .read_to_string(&mut received)
            .expect("concurrent request should not stall");
        assert!(received.contains("200 OK"), "{received}");
        assert!(received.contains("\"kinds\""), "{received}");
        received
    }

    #[test]
    fn slow_client_does_not_block_an_unrelated_registry_request() {
        let server = RegistryServer::new(vec![]);
        let address = server.base.strip_prefix("http://").unwrap();
        // Keep an incomplete request on an open TCP connection. The old
        // single-threaded server would wait for its 2s read timeout before
        // accepting the actual SDK request, exceeding the 1s deadline.
        let mut stalled = TcpStream::connect(address).unwrap();
        stalled
            .write_all(b"GET /partial HTTP/1.1\r\nHost: localhost\r\n")
            .unwrap();
        // Wait until the first connection has been accepted by the server,
        // so the test cannot falsely pass due to accept ordering.
        let start = std::time::Instant::now();
        while server.accepted_connections.load(Ordering::Acquire) == 0 {
            assert!(
                start.elapsed() < Duration::from_secs(2),
                "fixture did not accept the stalled connection"
            );
            std::thread::sleep(Duration::from_millis(2));
        }
        get_kinds(&server.base);
        drop(stalled);
    }

    #[test]
    fn parallel_registry_fixtures_serve_their_own_requests() {
        let servers: Vec<_> = (0..12).map(|_| RegistryServer::new(vec![])).collect();
        std::thread::scope(|scope| {
            let workers: Vec<_> = servers
                .iter()
                .map(|server| scope.spawn(move || get_kinds(&server.base)))
                .collect();
            for worker in workers {
                worker.join().expect("fixture worker thread");
            }
        });
        for server in servers {
            assert_eq!(
                *server.requests.lock().unwrap(),
                vec!["/api/kinds".to_string()]
            );
        }
    }
}
