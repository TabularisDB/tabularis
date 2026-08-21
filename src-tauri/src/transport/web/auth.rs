use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use url::{Host, Url};
use uuid::Uuid;

pub const SESSION_COOKIE_NAME: &str = "tabularis_session";
pub const CSRF_HEADER_NAME: &str = "x-tabularis-csrf";

#[derive(Clone, Debug)]
pub struct LocalSessionSecurityConfig {
    pub bootstrap_ttl: Duration,
    pub session_ttl: Duration,
    pub max_body_bytes: usize,
}

impl Default for LocalSessionSecurityConfig {
    fn default() -> Self {
        Self {
            bootstrap_ttl: Duration::from_secs(60),
            session_ttl: Duration::from_secs(8 * 60 * 60),
            max_body_bytes: 1024 * 1024,
        }
    }
}

#[derive(Clone)]
pub struct LocalSessionSecurity {
    inner: Arc<SecurityInner>,
}

struct SecurityInner {
    expected_origin: String,
    expected_host: String,
    config: LocalSessionSecurityConfig,
    state: Mutex<SecurityState>,
}

struct SecurityState {
    bootstrap: Option<ExpiringToken>,
    sessions: HashMap<TokenHash, SessionRecord>,
}

struct ExpiringToken {
    hash: TokenHash,
    expires_at: Instant,
}

struct SessionRecord {
    csrf_token: String,
    expires_at: Instant,
}

type TokenHash = [u8; 32];

pub struct BootstrapToken(String);

#[derive(Clone)]
pub struct IssuedSession {
    pub cookie_value: String,
    pub max_age_seconds: u64,
}

#[derive(Clone)]
pub struct AuthenticatedSession {
    token_hash: TokenHash,
    pub csrf_token: String,
}

impl LocalSessionSecurity {
    pub fn new(
        expected_origin: String,
        config: LocalSessionSecurityConfig,
    ) -> Result<(Self, BootstrapToken), String> {
        let expected_host = expected_host(&expected_origin)?;
        let bootstrap_token = generate_token();
        let bootstrap = ExpiringToken {
            hash: hash_token(&bootstrap_token),
            expires_at: Instant::now() + config.bootstrap_ttl,
        };
        let security = Self {
            inner: Arc::new(SecurityInner {
                expected_origin,
                expected_host,
                config,
                state: Mutex::new(SecurityState {
                    bootstrap: Some(bootstrap),
                    sessions: HashMap::new(),
                }),
            }),
        };

        Ok((security, BootstrapToken(bootstrap_token)))
    }

    pub fn expected_origin(&self) -> &str {
        &self.inner.expected_origin
    }

    pub fn expected_host(&self) -> &str {
        &self.inner.expected_host
    }

    pub fn max_body_bytes(&self) -> usize {
        self.inner.config.max_body_bytes
    }

    pub fn consume_bootstrap(&self, candidate: &str) -> Option<IssuedSession> {
        let now = Instant::now();
        let candidate_hash = hash_token(candidate);
        let mut state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let bootstrap = state.bootstrap.as_ref()?;
        if bootstrap.expires_at <= now || bootstrap.hash != candidate_hash {
            if bootstrap.expires_at <= now {
                state.bootstrap = None;
            }
            return None;
        }
        state.bootstrap = None;

        let cookie_value = generate_token();
        let csrf_token = generate_token();
        state.sessions.insert(
            hash_token(&cookie_value),
            SessionRecord {
                csrf_token: csrf_token.clone(),
                expires_at: now + self.inner.config.session_ttl,
            },
        );

        Some(IssuedSession {
            cookie_value,
            max_age_seconds: self.inner.config.session_ttl.as_secs(),
        })
    }

    pub fn authenticate(&self, cookie_value: &str) -> Option<AuthenticatedSession> {
        let now = Instant::now();
        let token_hash = hash_token(cookie_value);
        let mut state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        state.sessions.retain(|_, session| session.expires_at > now);
        let session = state.sessions.get(&token_hash)?;

        Some(AuthenticatedSession {
            token_hash,
            csrf_token: session.csrf_token.clone(),
        })
    }

    pub fn logout(&self, session: &AuthenticatedSession) {
        self.inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .sessions
            .remove(&session.token_hash);
    }
}

impl AuthenticatedSession {
    pub(crate) fn event_scope(&self) -> Uuid {
        let mut bytes = [0_u8; 16];
        bytes.copy_from_slice(&self.token_hash[..16]);
        Uuid::from_bytes(bytes)
    }
}

impl BootstrapToken {
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for BootstrapToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("BootstrapToken([REDACTED])")
    }
}

impl fmt::Debug for LocalSessionSecurity {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LocalSessionSecurity")
            .field("expected_origin", &self.inner.expected_origin)
            .field("expected_host", &self.inner.expected_host)
            .field("config", &self.inner.config)
            .field("credentials", &"[REDACTED]")
            .finish()
    }
}

fn expected_host(origin: &str) -> Result<String, String> {
    let parsed = Url::parse(origin).map_err(|_| "Invalid Web UI origin".to_string())?;
    if parsed.scheme() != "http"
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.path() != "/"
    {
        return Err("Invalid local Web UI origin".to_string());
    }

    let host = match parsed
        .host()
        .ok_or_else(|| "Web UI origin is missing a host".to_string())?
    {
        Host::Domain(host) => host.to_string(),
        Host::Ipv4(host) => host.to_string(),
        Host::Ipv6(host) => format!("[{host}]"),
    };
    let port = parsed
        .port()
        .ok_or_else(|| "Web UI origin is missing a port".to_string())?;
    Ok(format!("{host}:{port}"))
}

fn generate_token() -> String {
    let mut bytes = [0_u8; 32];
    bytes[..16].copy_from_slice(Uuid::new_v4().as_bytes());
    bytes[16..].copy_from_slice(Uuid::new_v4().as_bytes());
    URL_SAFE_NO_PAD.encode(bytes)
}

fn hash_token(token: &str) -> TokenHash {
    Sha256::digest(token.as_bytes()).into()
}
