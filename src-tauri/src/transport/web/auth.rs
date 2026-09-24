use crate::application::AuthorizationLevel;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use url::{Host, Url};
use uuid::Uuid;

pub const SESSION_COOKIE_NAME: &str = "tabularis_session";
pub const CSRF_HEADER_NAME: &str = "x-tabularis-csrf";
pub const PROXY_SECRET_HEADER_NAME: &str = "x-tabularis-proxy-secret";
pub const PROXY_USER_HEADER_NAME: &str = "x-tabularis-user";

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

#[derive(Clone, Debug)]
pub struct LoginRateLimitConfig {
    pub max_failures: usize,
    pub window: Duration,
    pub lockout: Duration,
}

impl Default for LoginRateLimitConfig {
    fn default() -> Self {
        Self {
            max_failures: 5,
            window: Duration::from_secs(60),
            lockout: Duration::from_secs(5 * 60),
        }
    }
}

#[derive(Clone, Debug)]
pub struct RemoteSessionSecurityConfig {
    pub public_origin: String,
    pub allowed_origins: Vec<String>,
    pub session_ttl: Duration,
    pub max_body_bytes: usize,
    pub authorization: AuthorizationLevel,
    pub rate_limit: LoginRateLimitConfig,
}

pub enum RemoteAuthentication {
    Password { hash: TokenHash, length: usize },
    Proxy { hash: TokenHash, length: usize },
}

impl RemoteAuthentication {
    pub fn password(secret: &str) -> Self {
        Self::Password {
            hash: hash_token(secret),
            length: secret.len(),
        }
    }

    pub fn proxy(secret: &str) -> Self {
        Self::Proxy {
            hash: hash_token(secret),
            length: secret.len(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuthenticationError {
    InvalidCredentials,
    RateLimited,
    UnsupportedMode,
}

#[derive(Clone)]
pub struct LocalSessionSecurity {
    inner: Arc<SecurityInner>,
}

struct SecurityInner {
    public_origin: String,
    public_host: String,
    allowed_origins: HashSet<String>,
    allowed_hosts: HashSet<String>,
    secure_cookie: bool,
    remote: bool,
    authorization: AuthorizationLevel,
    authentication: Authentication,
    config: SessionSecurityConfig,
    state: Mutex<SecurityState>,
}

#[derive(Clone, Copy)]
enum Authentication {
    LocalBootstrap,
    Password(TokenHash),
    Proxy(TokenHash),
}

#[derive(Clone)]
struct SessionSecurityConfig {
    session_ttl: Duration,
    max_body_bytes: usize,
    rate_limit: LoginRateLimitConfig,
}

struct SecurityState {
    bootstrap: Option<ExpiringToken>,
    sessions: HashMap<TokenHash, SessionRecord>,
    failed_logins: VecDeque<Instant>,
    blocked_until: Option<Instant>,
}

struct ExpiringToken {
    hash: TokenHash,
    expires_at: Instant,
}

struct SessionRecord {
    csrf_token: String,
    expires_at: Instant,
    authorization: AuthorizationLevel,
    remote: bool,
}

type TokenHash = [u8; 32];

pub struct BootstrapToken(String);

#[derive(Clone)]
pub struct IssuedSession {
    pub cookie_value: String,
    pub max_age_seconds: u64,
    session_id: Uuid,
}

#[derive(Clone)]
pub struct AuthenticatedSession {
    token_hash: TokenHash,
    pub csrf_token: String,
    authorization: AuthorizationLevel,
    remote: bool,
}

impl LocalSessionSecurity {
    pub fn new(
        expected_origin: String,
        config: LocalSessionSecurityConfig,
    ) -> Result<(Self, BootstrapToken), String> {
        let (origin, host) = parse_origin(&expected_origin, false)?;
        let bootstrap_token = generate_token();
        let bootstrap = ExpiringToken {
            hash: hash_token(&bootstrap_token),
            expires_at: Instant::now() + config.bootstrap_ttl,
        };
        let security = Self {
            inner: Arc::new(SecurityInner {
                public_origin: origin.clone(),
                public_host: host.clone(),
                allowed_origins: HashSet::from([origin]),
                allowed_hosts: HashSet::from([host]),
                secure_cookie: false,
                remote: false,
                authorization: AuthorizationLevel::LocalAdmin,
                authentication: Authentication::LocalBootstrap,
                config: SessionSecurityConfig {
                    session_ttl: config.session_ttl,
                    max_body_bytes: config.max_body_bytes,
                    rate_limit: LoginRateLimitConfig::default(),
                },
                state: Mutex::new(SecurityState {
                    bootstrap: Some(bootstrap),
                    sessions: HashMap::new(),
                    failed_logins: VecDeque::new(),
                    blocked_until: None,
                }),
            }),
        };

        Ok((security, BootstrapToken(bootstrap_token)))
    }

    pub fn new_remote(
        config: RemoteSessionSecurityConfig,
        authentication: RemoteAuthentication,
    ) -> Result<Self, String> {
        if config.rate_limit.max_failures == 0 {
            return Err("Remote login rate limit must allow at least one attempt".to_string());
        }
        let (public_origin, public_host) = parse_origin(&config.public_origin, true)?;
        let mut allowed_origins = HashSet::new();
        let mut allowed_hosts = HashSet::new();
        for origin in &config.allowed_origins {
            let (origin, host) = parse_origin(origin, true)?;
            allowed_origins.insert(origin);
            allowed_hosts.insert(host);
        }
        if !allowed_origins.contains(&public_origin) {
            return Err("The public Web UI URL must be included in --allowed-origin".to_string());
        }
        allowed_hosts.insert(public_host.clone());

        let authentication = match authentication {
            RemoteAuthentication::Password { hash, length } if length >= 12 => {
                Authentication::Password(hash)
            }
            RemoteAuthentication::Proxy { hash, length } if length >= 32 => {
                Authentication::Proxy(hash)
            }
            RemoteAuthentication::Password { .. } => {
                return Err("TABULARIS_WEB_PASSWORD must contain at least 12 characters".to_string())
            }
            RemoteAuthentication::Proxy { .. } => {
                return Err(
                    "TABULARIS_WEB_PROXY_SECRET must contain at least 32 characters".to_string(),
                )
            }
        };

        Ok(Self {
            inner: Arc::new(SecurityInner {
                public_origin,
                public_host,
                allowed_origins,
                allowed_hosts,
                secure_cookie: true,
                remote: true,
                authorization: config.authorization,
                authentication,
                config: SessionSecurityConfig {
                    session_ttl: config.session_ttl,
                    max_body_bytes: config.max_body_bytes,
                    rate_limit: config.rate_limit,
                },
                state: Mutex::new(SecurityState {
                    bootstrap: None,
                    sessions: HashMap::new(),
                    failed_logins: VecDeque::new(),
                    blocked_until: None,
                }),
            }),
        })
    }

    pub fn expected_origin(&self) -> &str {
        &self.inner.public_origin
    }

    pub fn expected_host(&self) -> &str {
        &self.inner.public_host
    }

    pub fn origin_allowed(&self, origin: &str) -> bool {
        parse_origin(origin, self.inner.remote)
            .ok()
            .is_some_and(|(origin, _)| self.inner.allowed_origins.contains(&origin))
    }

    pub fn host_allowed(&self, host: &str) -> bool {
        self.inner
            .allowed_hosts
            .contains(&host.to_ascii_lowercase())
    }

    pub fn max_body_bytes(&self) -> usize {
        self.inner.config.max_body_bytes
    }

    pub fn secure_cookie(&self) -> bool {
        self.inner.secure_cookie
    }

    pub fn is_remote(&self) -> bool {
        self.inner.remote
    }

    pub fn password_authentication(&self) -> bool {
        matches!(self.inner.authentication, Authentication::Password(_))
    }

    pub fn proxy_authentication(&self) -> bool {
        matches!(self.inner.authentication, Authentication::Proxy(_))
    }

    pub fn consume_bootstrap(&self, candidate: &str) -> Option<IssuedSession> {
        if !matches!(self.inner.authentication, Authentication::LocalBootstrap) {
            return None;
        }
        let now = Instant::now();
        let candidate_hash = hash_token(candidate);
        let mut state = self.lock_state();
        let bootstrap = state.bootstrap.as_ref()?;
        if bootstrap.expires_at <= now || bootstrap.hash != candidate_hash {
            if bootstrap.expires_at <= now {
                state.bootstrap = None;
            }
            return None;
        }
        state.bootstrap = None;
        Some(self.issue_session(&mut state, now))
    }

    pub fn authenticate_password(
        &self,
        candidate: &str,
    ) -> Result<IssuedSession, AuthenticationError> {
        let Authentication::Password(expected) = self.inner.authentication else {
            return Err(AuthenticationError::UnsupportedMode);
        };
        self.authenticate_remote(expected, candidate, true)
    }

    pub fn authenticate_proxy(
        &self,
        candidate: &str,
        user: &str,
    ) -> Result<IssuedSession, AuthenticationError> {
        let Authentication::Proxy(expected) = self.inner.authentication else {
            return Err(AuthenticationError::UnsupportedMode);
        };
        let valid_user =
            !user.is_empty() && user.len() <= 256 && !user.chars().any(char::is_control);
        self.authenticate_remote(expected, candidate, valid_user)
    }

    pub fn authenticate(&self, cookie_value: &str) -> Option<AuthenticatedSession> {
        let now = Instant::now();
        let token_hash = hash_token(cookie_value);
        let mut state = self.lock_state();
        state.sessions.retain(|_, session| session.expires_at > now);
        let session = state.sessions.get(&token_hash)?;

        Some(AuthenticatedSession {
            token_hash,
            csrf_token: session.csrf_token.clone(),
            authorization: session.authorization,
            remote: session.remote,
        })
    }

    pub fn logout(&self, session: &AuthenticatedSession) {
        self.lock_state().sessions.remove(&session.token_hash);
    }

    fn authenticate_remote(
        &self,
        expected: TokenHash,
        candidate: &str,
        additional_validation: bool,
    ) -> Result<IssuedSession, AuthenticationError> {
        let now = Instant::now();
        let mut state = self.lock_state();
        if state
            .blocked_until
            .is_some_and(|blocked_until| blocked_until > now)
        {
            return Err(AuthenticationError::RateLimited);
        }
        state.blocked_until = None;
        while state.failed_logins.front().is_some_and(|attempt| {
            now.duration_since(*attempt) >= self.inner.config.rate_limit.window
        }) {
            state.failed_logins.pop_front();
        }

        if hash_token(candidate) != expected || !additional_validation {
            state.failed_logins.push_back(now);
            if state.failed_logins.len() >= self.inner.config.rate_limit.max_failures {
                state.blocked_until = Some(now + self.inner.config.rate_limit.lockout);
            }
            return Err(AuthenticationError::InvalidCredentials);
        }

        state.failed_logins.clear();
        state.blocked_until = None;
        Ok(self.issue_session(&mut state, now))
    }

    fn issue_session(&self, state: &mut SecurityState, now: Instant) -> IssuedSession {
        let cookie_value = generate_token();
        let token_hash = hash_token(&cookie_value);
        let csrf_token = generate_token();
        state.sessions.insert(
            token_hash,
            SessionRecord {
                csrf_token,
                expires_at: now + self.inner.config.session_ttl,
                authorization: self.inner.authorization,
                remote: self.inner.remote,
            },
        );

        IssuedSession {
            cookie_value,
            max_age_seconds: self.inner.config.session_ttl.as_secs(),
            session_id: session_id(token_hash),
        }
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, SecurityState> {
        self.inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }
}

impl AuthenticatedSession {
    pub(crate) fn event_scope(&self) -> Uuid {
        session_id(self.token_hash)
    }

    pub fn authorization(&self) -> AuthorizationLevel {
        self.authorization
    }

    pub fn is_remote(&self) -> bool {
        self.remote
    }
}

impl IssuedSession {
    pub(crate) fn session_id(&self) -> Uuid {
        self.session_id
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
            .field("public_origin", &self.inner.public_origin)
            .field("allowed_origins", &self.inner.allowed_origins)
            .field("secure_cookie", &self.inner.secure_cookie)
            .field("remote", &self.inner.remote)
            .field("authorization", &self.inner.authorization)
            .field("credentials", &"[REDACTED]")
            .finish()
    }
}

fn parse_origin(origin: &str, require_https: bool) -> Result<(String, String), String> {
    let parsed = Url::parse(origin).map_err(|_| "Invalid Web UI origin".to_string())?;
    let valid_scheme = if require_https {
        parsed.scheme() == "https"
    } else {
        parsed.scheme() == "http"
    };
    if !valid_scheme
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.path() != "/"
    {
        return Err(if require_https {
            "Remote Web UI origins must be HTTPS origins without paths, queries, or credentials"
                .to_string()
        } else {
            "Invalid local Web UI origin".to_string()
        });
    }

    let host = parsed
        .host()
        .ok_or_else(|| "Web UI origin is missing a host".to_string())?;
    let host = match host {
        Host::Domain(host) => host.to_ascii_lowercase(),
        Host::Ipv4(host) => host.to_string(),
        Host::Ipv6(host) => format!("[{host}]"),
    };
    let host = match parsed.port() {
        Some(port) => format!("{host}:{port}"),
        None => host,
    };
    Ok((parsed.origin().ascii_serialization(), host))
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

fn session_id(token_hash: TokenHash) -> Uuid {
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&token_hash[..16]);
    Uuid::from_bytes(bytes)
}
