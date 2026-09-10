//! Local TCP port-forward through an HTTP CONNECT or SOCKS5 proxy.
//!
//! Mirrors the SSH-tunnel lifecycle: bind `127.0.0.1:0`, accept connections,
//! dial `target_host:target_port` via the proxy, then bidirectional-copy.

use super::types::{ProxyEndpoint, ProxyProtocol};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const IO_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Clone)]
pub struct ProxyTcpForward {
    pub local_port: u16,
    stop: Arc<AtomicBool>,
}

static FORWARDS: OnceLock<Mutex<HashMap<String, ProxyTcpForward>>> = OnceLock::new();

fn forwards() -> &'static Mutex<HashMap<String, ProxyTcpForward>> {
    FORWARDS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn build_forward_key(
    proxy_host: &str,
    proxy_port: u16,
    target_host: &str,
    target_port: u16,
) -> String {
    format!(
        "{}:{}->{}:{}",
        proxy_host, proxy_port, target_host, target_port
    )
}

/// Return an existing forward's local port, or start a new one.
pub fn ensure_forward(
    proxy: &ProxyEndpoint,
    target_host: &str,
    target_port: u16,
) -> Result<u16, String> {
    let key = build_forward_key(&proxy.host, proxy.port, target_host, target_port);
    {
        let map = forwards().lock().map_err(|e| e.to_string())?;
        if let Some(existing) = map.get(&key) {
            if !existing.stop.load(Ordering::SeqCst) {
                return Ok(existing.local_port);
            }
        }
    }

    let forward = ProxyTcpForward::start(proxy, target_host, target_port)?;
    let port = forward.local_port;
    let mut map = forwards().lock().map_err(|e| e.to_string())?;
    map.insert(key, forward);
    Ok(port)
}

pub fn stop_all_forwards() {
    if let Ok(mut map) = forwards().lock() {
        for (_, fwd) in map.drain() {
            fwd.stop.store(true, Ordering::SeqCst);
        }
    }
}

impl ProxyTcpForward {
    pub fn start(
        proxy: &ProxyEndpoint,
        target_host: &str,
        target_port: u16,
    ) -> Result<Self, String> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("Failed to bind local proxy forward: {e}"))?;
        let local_port = listener
            .local_addr()
            .map_err(|e| format!("Failed to read local forward port: {e}"))?
            .port();
        listener
            .set_nonblocking(true)
            .map_err(|e| format!("Failed to set nonblocking: {e}"))?;

        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = stop.clone();
        let proxy = proxy.clone();
        let target_host = target_host.to_string();

        thread::spawn(move || {
            while !stop_flag.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((incoming, _)) => {
                        let proxy = proxy.clone();
                        let target_host = target_host.clone();
                        let stop_conn = stop_flag.clone();
                        thread::spawn(move || {
                            if let Err(e) =
                                handle_connection(incoming, &proxy, &target_host, target_port)
                            {
                                log::debug!("[ProxyForward] connection error: {e}");
                            }
                            let _ = stop_conn; // keep alive semantics explicit
                        });
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(50));
                    }
                    Err(e) => {
                        log::warn!("[ProxyForward] accept error: {e}");
                        thread::sleep(Duration::from_millis(100));
                    }
                }
            }
        });

        // Brief readiness: ensure the listener is up.
        thread::sleep(Duration::from_millis(20));
        Ok(Self { local_port, stop })
    }
}

fn handle_connection(
    mut incoming: TcpStream,
    proxy: &ProxyEndpoint,
    target_host: &str,
    target_port: u16,
) -> Result<(), String> {
    let _ = incoming.set_read_timeout(Some(IO_TIMEOUT));
    let _ = incoming.set_write_timeout(Some(IO_TIMEOUT));

    let mut upstream = dial_via_proxy(proxy, target_host, target_port)?;
    let _ = upstream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = upstream.set_write_timeout(Some(IO_TIMEOUT));

    let mut incoming_clone = incoming
        .try_clone()
        .map_err(|e| format!("clone incoming: {e}"))?;
    let mut upstream_clone = upstream
        .try_clone()
        .map_err(|e| format!("clone upstream: {e}"))?;

    let t1 = thread::spawn(move || {
        let _ = std::io::copy(&mut incoming, &mut upstream);
        let _ = upstream.shutdown(Shutdown::Both);
        let _ = incoming.shutdown(Shutdown::Both);
    });
    let t2 = thread::spawn(move || {
        let _ = std::io::copy(&mut upstream_clone, &mut incoming_clone);
        let _ = incoming_clone.shutdown(Shutdown::Both);
        let _ = upstream_clone.shutdown(Shutdown::Both);
    });
    let _ = t1.join();
    let _ = t2.join();
    Ok(())
}

fn dial_via_proxy(
    proxy: &ProxyEndpoint,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream, String> {
    let proxy_addr = format!("{}:{}", proxy.host.trim(), proxy.port);
    let stream = TcpStream::connect_timeout(
        &resolve_addr(&proxy_addr)?,
        CONNECT_TIMEOUT,
    )
    .map_err(|e| format!("Failed to connect to proxy {proxy_addr}: {e}"))?;

    match proxy.protocol {
        ProxyProtocol::Http => http_connect(stream, proxy, target_host, target_port),
        ProxyProtocol::Socks5 => socks5_connect(stream, proxy, target_host, target_port),
    }
}

fn resolve_addr(addr: &str) -> Result<SocketAddr, String> {
    use std::net::ToSocketAddrs;
    addr.to_socket_addrs()
        .map_err(|e| format!("Failed to resolve {addr}: {e}"))?
        .next()
        .ok_or_else(|| format!("No address for {addr}"))
}

fn http_connect(
    mut stream: TcpStream,
    proxy: &ProxyEndpoint,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream, String> {
    let _ = stream.set_read_timeout(Some(CONNECT_TIMEOUT));
    let _ = stream.set_write_timeout(Some(CONNECT_TIMEOUT));

    let mut request = format!(
        "CONNECT {target_host}:{target_port} HTTP/1.1\r\nHost: {target_host}:{target_port}\r\n"
    );
    if let Some(user) = proxy
        .username
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let pass = proxy.password.as_deref().unwrap_or("");
        let token = base64_encode(&format!("{user}:{pass}"));
        request.push_str(&format!("Proxy-Authorization: Basic {token}\r\n"));
    }
    request.push_str("Proxy-Connection: Keep-Alive\r\n\r\n");

    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("HTTP CONNECT write failed: {e}"))?;

    let mut buf = [0u8; 4096];
    let mut collected = Vec::new();
    loop {
        let n = stream
            .read(&mut buf)
            .map_err(|e| format!("HTTP CONNECT read failed: {e}"))?;
        if n == 0 {
            return Err("HTTP CONNECT: proxy closed connection".into());
        }
        collected.extend_from_slice(&buf[..n]);
        if collected.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
        if collected.len() > 64 * 1024 {
            return Err("HTTP CONNECT: response too large".into());
        }
    }

    let header_end = collected
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or("HTTP CONNECT: incomplete response")?;
    let header = String::from_utf8_lossy(&collected[..header_end]);
    let status_line = header.lines().next().unwrap_or("");
    if !status_line.contains(" 200") {
        return Err(format!("HTTP CONNECT failed: {status_line}"));
    }
    Ok(stream)
}

fn socks5_connect(
    mut stream: TcpStream,
    proxy: &ProxyEndpoint,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream, String> {
    let _ = stream.set_read_timeout(Some(CONNECT_TIMEOUT));
    let _ = stream.set_write_timeout(Some(CONNECT_TIMEOUT));

    let user = proxy
        .username
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let pass = proxy.password.as_deref().unwrap_or("");

    // Greeting
    if user.is_some() {
        stream
            .write_all(&[0x05, 0x02, 0x00, 0x02])
            .map_err(|e| format!("SOCKS5 greeting: {e}"))?;
    } else {
        stream
            .write_all(&[0x05, 0x01, 0x00])
            .map_err(|e| format!("SOCKS5 greeting: {e}"))?;
    }

    let mut resp = [0u8; 2];
    stream
        .read_exact(&mut resp)
        .map_err(|e| format!("SOCKS5 greeting response: {e}"))?;
    if resp[0] != 0x05 {
        return Err("SOCKS5: invalid version in greeting response".into());
    }

    match resp[1] {
        0x00 => {}
        0x02 => {
            let user = user.ok_or("SOCKS5: proxy requested auth but no username")?;
            if user.len() > 255 || pass.len() > 255 {
                return Err("SOCKS5: username/password too long".into());
            }
            let mut auth = Vec::with_capacity(3 + user.len() + pass.len());
            auth.push(0x01);
            auth.push(user.len() as u8);
            auth.extend_from_slice(user.as_bytes());
            auth.push(pass.len() as u8);
            auth.extend_from_slice(pass.as_bytes());
            stream
                .write_all(&auth)
                .map_err(|e| format!("SOCKS5 auth write: {e}"))?;
            let mut auth_resp = [0u8; 2];
            stream
                .read_exact(&mut auth_resp)
                .map_err(|e| format!("SOCKS5 auth response: {e}"))?;
            if auth_resp[1] != 0x00 {
                return Err("SOCKS5: authentication failed".into());
            }
        }
        0xFF => return Err("SOCKS5: no acceptable authentication method".into()),
        other => return Err(format!("SOCKS5: unsupported auth method {other}")),
    }

    // CONNECT request — use domain name form (ATYP=0x03)
    if target_host.len() > 255 {
        return Err("SOCKS5: target host too long".into());
    }
    let mut req = Vec::with_capacity(7 + target_host.len());
    req.extend_from_slice(&[0x05, 0x01, 0x00, 0x03]);
    req.push(target_host.len() as u8);
    req.extend_from_slice(target_host.as_bytes());
    req.push((target_port >> 8) as u8);
    req.push((target_port & 0xff) as u8);
    stream
        .write_all(&req)
        .map_err(|e| format!("SOCKS5 connect write: {e}"))?;

    let mut hdr = [0u8; 4];
    stream
        .read_exact(&mut hdr)
        .map_err(|e| format!("SOCKS5 connect response: {e}"))?;
    if hdr[0] != 0x05 {
        return Err("SOCKS5: invalid version in connect response".into());
    }
    if hdr[1] != 0x00 {
        return Err(format!("SOCKS5 CONNECT failed with code {}", hdr[1]));
    }
    // Consume bound address
    match hdr[3] {
        0x01 => {
            let mut skip = [0u8; 6];
            stream
                .read_exact(&mut skip)
                .map_err(|e| format!("SOCKS5 skip IPv4: {e}"))?;
        }
        0x03 => {
            let mut len = [0u8; 1];
            stream
                .read_exact(&mut len)
                .map_err(|e| format!("SOCKS5 skip domain len: {e}"))?;
            let mut skip = vec![0u8; len[0] as usize + 2];
            stream
                .read_exact(&mut skip)
                .map_err(|e| format!("SOCKS5 skip domain: {e}"))?;
        }
        0x04 => {
            let mut skip = [0u8; 18];
            stream
                .read_exact(&mut skip)
                .map_err(|e| format!("SOCKS5 skip IPv6: {e}"))?;
        }
        other => return Err(format!("SOCKS5: unknown ATYP {other}")),
    }

    Ok(stream)
}

fn base64_encode(input: &str) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes = input.as_bytes();
    let mut out = String::new();
    let mut i = 0;
    while i < bytes.len() {
        let b0 = bytes[i] as u32;
        let b1 = if i + 1 < bytes.len() {
            bytes[i + 1] as u32
        } else {
            0
        };
        let b2 = if i + 2 < bytes.len() {
            bytes[i + 2] as u32
        } else {
            0
        };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 0x3f) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3f) as usize] as char);
        if i + 1 < bytes.len() {
            out.push(TABLE[((triple >> 6) & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
        if i + 2 < bytes.len() {
            out.push(TABLE[(triple & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
        i += 3;
    }
    out
}

trait ReadExact {
    fn read_exact(&mut self, buf: &mut [u8]) -> Result<(), String>;
}

impl ReadExact for TcpStream {
    fn read_exact(&mut self, buf: &mut [u8]) -> Result<(), String> {
        let mut read = 0;
        while read < buf.len() {
            match self.read(&mut buf[read..]) {
                Ok(0) => return Err("unexpected EOF".into()),
                Ok(n) => read += n,
                Err(e) => return Err(e.to_string()),
            }
        }
        Ok(())
    }
}
