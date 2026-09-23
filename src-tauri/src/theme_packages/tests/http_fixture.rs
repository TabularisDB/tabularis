use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
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
    thread: Option<thread::JoinHandle<()>>,
}

impl RegistryServer {
    pub fn new(bytes: Vec<u8>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let stopped = Arc::new(AtomicBool::new(false));
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
        let (log, stop, source, url) = (
            requests.clone(),
            stopped.clone(),
            state.clone(),
            base.clone(),
        );
        let thread = thread::spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                let (mut stream, _) = match listener.accept() {
                    Ok(value) => value,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                        continue;
                    }
                    Err(error) => panic!("Loopback fixture: {error}"),
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut first = String::new();
                {
                    let mut reader = BufReader::new(&mut stream);
                    if reader.read_line(&mut first).is_err() {
                        continue;
                    }
                    loop {
                        let mut line = String::new();
                        if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                            break;
                        }
                    }
                }
                let path = first.split_whitespace().nth(1).unwrap_or("").to_string();
                log.lock().unwrap().push(path.clone());
                let snapshot = source.lock().unwrap().clone();
                let (status, headers, body) = response(&url, &path, &snapshot);
                if snapshot.delay_download && path.starts_with("/asset/") {
                    thread::sleep(Duration::from_millis(250));
                }
                let length = if snapshot.oversize && path.starts_with("/asset/") {
                    8 * 1024 * 1024 + 1
                } else {
                    body.len()
                };
                let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Length: {length}\r\nConnection: close\r\nContent-Type: application/json\r\n{headers}\r\n");
                let _ = stream.write_all(&body);
            }
        });
        Self {
            base,
            requests,
            state,
            stopped,
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
