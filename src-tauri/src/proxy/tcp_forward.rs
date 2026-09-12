//! Local TCP port-forward through an HTTP CONNECT or SOCKS5 proxy.
//!
//! Mirrors the SSH-tunnel lifecycle: bind `127.0.0.1:0`, accept connections,
//! dial `target_host:target_port` via the proxy, then bidirectional-copy.

use super::types::{ProxyEndpoint, ProxyProtocol};
use base64::Engine;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv6Addr, Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone)]
pub struct ProxyTcpForward {
    pub local_port: u16,
    stop: Arc<AtomicBool>,
}

static FORWARDS: OnceLock<Mutex<HashMap<String, ProxyTcpForward>>> = OnceLock::new();

fn forwards() -> &'static Mutex<HashMap<String, ProxyTcpForward>> {
    FORWARDS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Cache key for a forward. Includes protocol and username so rotating
/// credentials / switching HTTP↔SOCKS5 does not reuse a stale listener.
/// Password changes are handled by [`stop_all_forwards`] on proxy config save.
pub fn build_forward_key(
    proxy: &ProxyEndpoint,
    target_host: &str,
    target_port: u16,
) -> String {
    let proto = match proxy.protocol {
        ProxyProtocol::Http => "http",
        ProxyProtocol::Socks5 => "socks5",
    };
    let user = proxy.username.as_deref().unwrap_or("");
    format!(
        "{proto}:{}:{}:{}->{}:{}",
        proxy.host.trim(),
        proxy.port,
        user,
        target_host,
        target_port
    )
}

/// Return an existing forward's local port, or start a new one.
pub fn ensure_forward(
    proxy: &ProxyEndpoint,
    target_host: &str,
    target_port: u16,
) -> Result<u16, String> {
    let key = build_forward_key(proxy, target_host, target_port);
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
                            let _ = stop_conn;
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
    let (mut upstream, leftover) = dial_via_proxy(proxy, target_host, target_port)?;

    // Idle DB/SSH sessions must not be killed by a read timeout; only the
    // CONNECT/SOCKS handshake above uses CONNECT_TIMEOUT.
    let _ = incoming.set_read_timeout(None);
    let _ = incoming.set_write_timeout(None);
    let _ = upstream.set_read_timeout(None);
    let _ = upstream.set_write_timeout(None);

    // HTTP CONNECT may have already consumed early tunnel bytes (SSH banner /
    // MySQL greeting) in the same read as the 200 response — replay them.
    if !leftover.is_empty() {
        incoming
            .write_all(&leftover)
            .map_err(|e| format!("Failed to write CONNECT leftover: {e}"))?;
    }

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
) -> Result<(TcpStream, Vec<u8>), String> {
    let host = proxy.host.trim();
    let proxy_addr = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{}", proxy.port)
    } else {
        format!("{host}:{}", proxy.port)
    };
    let stream = TcpStream::connect_timeout(&resolve_addr(&proxy_addr)?, CONNECT_TIMEOUT)
        .map_err(|e| format!("Failed to connect to proxy {proxy_addr}: {e}"))?;

    match proxy.protocol {
        ProxyProtocol::Http => http_connect(stream, proxy, target_host, target_port),
        ProxyProtocol::Socks5 => {
            let stream = socks5_connect(stream, proxy, target_host, target_port)?;
            Ok((stream, Vec::new()))
        }
    }
}

fn resolve_addr(addr: &str) -> Result<SocketAddr, String> {
    use std::net::ToSocketAddrs;
    addr.to_socket_addrs()
        .map_err(|e| format!("Failed to resolve {addr}: {e}"))?
        .next()
        .ok_or_else(|| format!("No address for {addr}"))
}

fn format_connect_authority(host: &str, port: u16) -> String {
    if host.parse::<Ipv6Addr>().is_ok() {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

fn http_connect(
    mut stream: TcpStream,
    proxy: &ProxyEndpoint,
    target_host: &str,
    target_port: u16,
) -> Result<(TcpStream, Vec<u8>), String> {
    let _ = stream.set_read_timeout(Some(CONNECT_TIMEOUT));
    let _ = stream.set_write_timeout(Some(CONNECT_TIMEOUT));

    let authority = format_connect_authority(target_host, target_port);
    let mut request = format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n");
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
        if let Some(header_end) = find_header_end(&collected) {
            let header = String::from_utf8_lossy(&collected[..header_end]);
            let status_line = header.lines().next().unwrap_or("");
            if !status_line.contains(" 200") {
                return Err(format!("HTTP CONNECT failed: {status_line}"));
            }
            let leftover = collected[header_end + 4..].to_vec();
            let _ = stream.set_read_timeout(None);
            let _ = stream.set_write_timeout(None);
            return Ok((stream, leftover));
        }
        if collected.len() > 64 * 1024 {
            return Err("HTTP CONNECT: response too large".into());
        }
    }
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
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
    Read::read_exact(&mut stream, &mut resp)
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
            Read::read_exact(&mut stream, &mut auth_resp)
                .map_err(|e| format!("SOCKS5 auth response: {e}"))?;
            if auth_resp[1] != 0x00 {
                return Err("SOCKS5: authentication failed".into());
            }
        }
        0xFF => return Err("SOCKS5: no acceptable authentication method".into()),
        other => return Err(format!("SOCKS5: unsupported auth method {other}")),
    }

    let mut req = Vec::with_capacity(7 + target_host.len());
    req.extend_from_slice(&[0x05, 0x01, 0x00]);
    append_socks5_address(&mut req, target_host)?;
    req.push((target_port >> 8) as u8);
    req.push((target_port & 0xff) as u8);
    stream
        .write_all(&req)
        .map_err(|e| format!("SOCKS5 connect write: {e}"))?;

    let mut hdr = [0u8; 4];
    Read::read_exact(&mut stream, &mut hdr)
        .map_err(|e| format!("SOCKS5 connect response: {e}"))?;
    if hdr[0] != 0x05 {
        return Err("SOCKS5: invalid version in connect response".into());
    }
    if hdr[1] != 0x00 {
        return Err(format!("SOCKS5 CONNECT failed with code {}", hdr[1]));
    }
    match hdr[3] {
        0x01 => {
            let mut skip = [0u8; 6];
            Read::read_exact(&mut stream, &mut skip)
                .map_err(|e| format!("SOCKS5 skip IPv4: {e}"))?;
        }
        0x03 => {
            let mut len = [0u8; 1];
            Read::read_exact(&mut stream, &mut len)
                .map_err(|e| format!("SOCKS5 skip domain len: {e}"))?;
            let mut skip = vec![0u8; len[0] as usize + 2];
            Read::read_exact(&mut stream, &mut skip)
                .map_err(|e| format!("SOCKS5 skip domain: {e}"))?;
        }
        0x04 => {
            let mut skip = [0u8; 18];
            Read::read_exact(&mut stream, &mut skip)
                .map_err(|e| format!("SOCKS5 skip IPv6: {e}"))?;
        }
        other => return Err(format!("SOCKS5: unknown ATYP {other}")),
    }

    let _ = stream.set_read_timeout(None);
    let _ = stream.set_write_timeout(None);
    Ok(stream)
}

fn append_socks5_address(req: &mut Vec<u8>, host: &str) -> Result<(), String> {
    if let Ok(IpAddr::V4(v4)) = host.parse::<IpAddr>() {
        req.push(0x01);
        req.extend_from_slice(&v4.octets());
        return Ok(());
    }
    if let Ok(IpAddr::V6(v6)) = host.parse::<IpAddr>() {
        req.push(0x04);
        req.extend_from_slice(&v6.octets());
        return Ok(());
    }
    // Strip brackets from IPv6 literals like [::1]
    let unbracketed = host
        .strip_prefix('[')
        .and_then(|h| h.strip_suffix(']'))
        .unwrap_or(host);
    if let Ok(IpAddr::V6(v6)) = unbracketed.parse::<IpAddr>() {
        req.push(0x04);
        req.extend_from_slice(&v6.octets());
        return Ok(());
    }
    if host.len() > 255 {
        return Err("SOCKS5: target host too long".into());
    }
    req.push(0x03);
    req.push(host.len() as u8);
    req.extend_from_slice(host.as_bytes());
    Ok(())
}

fn base64_encode(input: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(input.as_bytes())
}

#[cfg(test)]
mod tests;
