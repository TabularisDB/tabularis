//! Minimal SOCKS5 server side (RFC 1928) for the SSH dynamic forward.
//!
//! Only what a database driver needs: username/password authentication
//! (RFC 1929) and `CONNECT`. The requested destination is returned as given
//! — a domain name stays a name — so the SSH server resolves it, not this
//! machine.

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

const VERSION: u8 = 0x05;
const METHOD_USERNAME_PASSWORD: u8 = 0x02;
const METHOD_NONE_ACCEPTABLE: u8 = 0xFF;
const AUTH_VERSION: u8 = 0x01;
const AUTH_SUCCESS: u8 = 0x00;
const AUTH_FAILURE: u8 = 0x01;
const CMD_CONNECT: u8 = 0x01;
const ATYP_IPV4: u8 = 0x01;
const ATYP_DOMAIN: u8 = 0x03;
const ATYP_IPV6: u8 = 0x04;

/// Reply codes sent back to the client (RFC 1928 section 6).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reply {
    Succeeded = 0x00,
    GeneralFailure = 0x01,
    HostUnreachable = 0x04,
    CommandNotSupported = 0x07,
    AddressTypeNotSupported = 0x08,
}

/// Username and password a client must present (RFC 1929). Generated per
/// tunnel and handed only to the driver, so another local process cannot
/// use the listener to reach what the SSH server can reach.
#[derive(Clone, PartialEq, Eq)]
pub struct Credentials {
    pub username: String,
    pub password: String,
}

impl Credentials {
    /// Random credentials from the OS random source (UUID v4).
    pub fn generate() -> Self {
        Self {
            username: format!("tabularis-{}", uuid::Uuid::new_v4().simple()),
            password: uuid::Uuid::new_v4().simple().to_string(),
        }
    }

    fn matches(&self, username: &[u8], password: &[u8]) -> bool {
        // Evaluate both, so the reply time does not tell which one was wrong.
        let username_ok = constant_time_eq(self.username.as_bytes(), username);
        let password_ok = constant_time_eq(self.password.as_bytes(), password);
        username_ok & password_ok
    }
}

impl std::fmt::Debug for Credentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Credentials")
            .field("username", &self.username)
            .field("password", &"<redacted>")
            .finish()
    }
}

fn constant_time_eq(expected: &[u8], given: &[u8]) -> bool {
    if expected.len() != given.len() {
        return false;
    }
    expected
        .iter()
        .zip(given)
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

#[derive(Debug)]
pub enum HandshakeError {
    Io(std::io::Error),
    /// Protocol violation; the reply (if any) was already sent.
    Protocol(String),
}

impl std::fmt::Display for HandshakeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "SOCKS5 I/O error: {e}"),
            Self::Protocol(m) => write!(f, "SOCKS5 protocol error: {m}"),
        }
    }
}

impl From<std::io::Error> for HandshakeError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

/// Reads the method negotiation, checks `credentials`, reads the `CONNECT`
/// request and returns the requested `(host, port)`. The caller must answer
/// with [`send_reply`].
pub async fn read_connect_request<S>(
    stream: &mut S,
    credentials: &Credentials,
) -> Result<(String, u16), HandshakeError>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut header = [0u8; 2];
    stream.read_exact(&mut header).await?;
    if header[0] != VERSION {
        return Err(HandshakeError::Protocol(format!(
            "unsupported version {}",
            header[0]
        )));
    }
    let mut methods = vec![0u8; usize::from(header[1])];
    stream.read_exact(&mut methods).await?;
    if !methods.contains(&METHOD_USERNAME_PASSWORD) {
        stream.write_all(&[VERSION, METHOD_NONE_ACCEPTABLE]).await?;
        return Err(HandshakeError::Protocol(
            "client does not offer username/password authentication".into(),
        ));
    }
    stream
        .write_all(&[VERSION, METHOD_USERNAME_PASSWORD])
        .await?;
    authenticate(stream, credentials).await?;

    let mut request = [0u8; 4];
    stream.read_exact(&mut request).await?;
    if request[0] != VERSION {
        return Err(HandshakeError::Protocol(format!(
            "unsupported request version {}",
            request[0]
        )));
    }
    if request[1] != CMD_CONNECT {
        send_reply(stream, Reply::CommandNotSupported).await?;
        return Err(HandshakeError::Protocol(format!(
            "unsupported command {}",
            request[1]
        )));
    }

    let host = match request[3] {
        ATYP_IPV4 => {
            let mut octets = [0u8; 4];
            stream.read_exact(&mut octets).await?;
            std::net::Ipv4Addr::from(octets).to_string()
        }
        ATYP_IPV6 => {
            let mut octets = [0u8; 16];
            stream.read_exact(&mut octets).await?;
            std::net::Ipv6Addr::from(octets).to_string()
        }
        ATYP_DOMAIN => {
            let name = read_length_prefixed(stream).await?;
            String::from_utf8(name)
                .map_err(|_| HandshakeError::Protocol("domain name is not UTF-8".into()))?
        }
        other => {
            send_reply(stream, Reply::AddressTypeNotSupported).await?;
            return Err(HandshakeError::Protocol(format!(
                "unsupported address type {other}"
            )));
        }
    };
    if host.is_empty() {
        send_reply(stream, Reply::GeneralFailure).await?;
        return Err(HandshakeError::Protocol("empty destination host".into()));
    }

    let mut port = [0u8; 2];
    stream.read_exact(&mut port).await?;
    Ok((host, u16::from_be_bytes(port)))
}

/// RFC 1929 sub-negotiation.
async fn authenticate<S>(stream: &mut S, credentials: &Credentials) -> Result<(), HandshakeError>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut version = [0u8; 1];
    stream.read_exact(&mut version).await?;
    if version[0] != AUTH_VERSION {
        return Err(HandshakeError::Protocol(format!(
            "unsupported authentication version {}",
            version[0]
        )));
    }
    let username = read_length_prefixed(stream).await?;
    let password = read_length_prefixed(stream).await?;
    if !credentials.matches(&username, &password) {
        stream.write_all(&[AUTH_VERSION, AUTH_FAILURE]).await?;
        return Err(HandshakeError::Protocol("invalid credentials".into()));
    }
    stream.write_all(&[AUTH_VERSION, AUTH_SUCCESS]).await?;
    Ok(())
}

async fn read_length_prefixed<S>(stream: &mut S) -> std::io::Result<Vec<u8>>
where
    S: AsyncRead + Unpin,
{
    let mut len = [0u8; 1];
    stream.read_exact(&mut len).await?;
    let mut value = vec![0u8; usize::from(len[0])];
    stream.read_exact(&mut value).await?;
    Ok(value)
}

/// Answers a `CONNECT` request. The bound address is reported as
/// `0.0.0.0:0`; clients do not use it for `CONNECT`.
pub async fn send_reply<S>(stream: &mut S, reply: Reply) -> std::io::Result<()>
where
    S: AsyncWrite + Unpin,
{
    stream
        .write_all(&[VERSION, reply as u8, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0])
        .await
}

#[cfg(test)]
mod tests;
