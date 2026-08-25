use crate::application::AuthorizationLevel;
use crate::runtime::events::RuntimeEvents;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use uuid::Uuid;

const DEFAULT_CONNECTION_QUEUE_CAPACITY: usize = 64;
const DEFAULT_SESSION_HISTORY_CAPACITY: usize = 128;
const DEFAULT_MAX_SESSIONS: usize = 64;
const DEFAULT_MAX_CONNECTIONS_PER_SESSION: usize = 8;
const DEFAULT_DISCONNECTED_SESSION_TTL: Duration = Duration::from_secs(5 * 60);
const DEFAULT_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);
const DEFAULT_HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Clone, Debug)]
pub struct EventBusConfig {
    pub connection_queue_capacity: usize,
    pub session_history_capacity: usize,
    pub max_sessions: usize,
    pub max_connections_per_session: usize,
    pub disconnected_session_ttl: Duration,
    pub heartbeat_interval: Duration,
    pub heartbeat_timeout: Duration,
}

impl Default for EventBusConfig {
    fn default() -> Self {
        Self {
            connection_queue_capacity: DEFAULT_CONNECTION_QUEUE_CAPACITY,
            session_history_capacity: DEFAULT_SESSION_HISTORY_CAPACITY,
            max_sessions: DEFAULT_MAX_SESSIONS,
            max_connections_per_session: DEFAULT_MAX_CONNECTIONS_PER_SESSION,
            disconnected_session_ttl: DEFAULT_DISCONNECTED_SESSION_TTL,
            heartbeat_interval: DEFAULT_HEARTBEAT_INTERVAL,
            heartbeat_timeout: DEFAULT_HEARTBEAT_TIMEOUT,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventEnvelope {
    pub event: String,
    pub payload: Value,
    pub sequence: u64,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum ClientEventMessage {
    Subscribe {
        events: Vec<String>,
        #[serde(default)]
        since: Option<u64>,
    },
    Unsubscribe {
        events: Vec<String>,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServerEventMessage<'a> {
    Event {
        #[serde(flatten)]
        envelope: &'a EventEnvelope,
    },
    Subscribed {
        events: &'a [String],
        replayed: usize,
    },
    Unsubscribed {
        events: &'a [String],
    },
    Error {
        code: &'static str,
        message: &'a str,
    },
}

#[derive(Clone)]
pub struct WebEventBus {
    inner: Arc<EventBusInner>,
}

struct EventBusInner {
    config: EventBusConfig,
    state: Mutex<EventBusState>,
}

#[derive(Default)]
struct EventBusState {
    next_sequence: u64,
    sessions: HashMap<Uuid, SessionState>,
}

struct SessionState {
    authorization: AuthorizationLevel,
    history: VecDeque<EventEnvelope>,
    connections: HashMap<Uuid, ConnectionState>,
    last_seen: Instant,
}

struct ConnectionState {
    subscriptions: HashSet<String>,
    sender: mpsc::Sender<EventEnvelope>,
}

pub struct EventConnection {
    bus: WebEventBus,
    session_id: Uuid,
    connection_id: Uuid,
    receiver: mpsc::Receiver<EventEnvelope>,
}

impl Default for WebEventBus {
    fn default() -> Self {
        Self::new(EventBusConfig::default())
    }
}

impl WebEventBus {
    pub fn new(config: EventBusConfig) -> Self {
        assert!(config.connection_queue_capacity > 0);
        assert!(config.session_history_capacity > 0);
        assert!(config.max_sessions > 0);
        assert!(config.max_connections_per_session > 0);
        assert!(config.heartbeat_timeout > config.heartbeat_interval);
        Self {
            inner: Arc::new(EventBusInner {
                config,
                state: Mutex::new(EventBusState::default()),
            }),
        }
    }

    pub fn connect(
        &self,
        session_id: Uuid,
        authorization: AuthorizationLevel,
    ) -> Result<EventConnection, String> {
        let now = Instant::now();
        let mut state = self.lock_state();
        self.cleanup_sessions(&mut state, now);
        if !state.sessions.contains_key(&session_id)
            && state.sessions.len() >= self.inner.config.max_sessions
        {
            let removable = state
                .sessions
                .iter()
                .filter(|(_, session)| session.connections.is_empty())
                .min_by_key(|(_, session)| session.last_seen)
                .map(|(id, _)| *id);
            if let Some(id) = removable {
                state.sessions.remove(&id);
            } else {
                return Err("The WebSocket session limit has been reached".to_string());
            }
        }

        let session = state
            .sessions
            .entry(session_id)
            .or_insert_with(|| SessionState {
                authorization,
                history: VecDeque::new(),
                connections: HashMap::new(),
                last_seen: now,
            });
        if session.authorization != authorization {
            return Err("The WebSocket session authorization changed".to_string());
        }
        if session.connections.len() >= self.inner.config.max_connections_per_session {
            return Err("The WebSocket connection limit has been reached".to_string());
        }

        let connection_id = Uuid::new_v4();
        let (sender, receiver) = mpsc::channel(self.inner.config.connection_queue_capacity);
        session.last_seen = now;
        session.connections.insert(
            connection_id,
            ConnectionState {
                subscriptions: HashSet::new(),
                sender,
            },
        );
        drop(state);

        Ok(EventConnection {
            bus: self.clone(),
            session_id,
            connection_id,
            receiver,
        })
    }

    pub fn emit_to(&self, session_id: Uuid, event: &str, payload: Value) -> Result<(), String> {
        self.publish(Some(session_id), event, payload)
    }

    pub fn remove_session(&self, session_id: Uuid) {
        self.lock_state().sessions.remove(&session_id);
    }

    pub fn heartbeat_interval(&self) -> Duration {
        self.inner.config.heartbeat_interval
    }

    pub fn heartbeat_timeout(&self) -> Duration {
        self.inner.config.heartbeat_timeout
    }

    pub fn authorization_for(event: &str) -> Option<AuthorizationLevel> {
        match event {
            "connection-test-progress"
            | "connection-health-failed"
            | "connections:active-changed"
            | "database-dropped"
            | "batch-statement-complete"
            | "query-status"
            | "query-cancelled"
            | "dump_progress"
            | "import_progress"
            | "export_progress" => Some(AuthorizationLevel::Database),
            "plugin-install-progress" | "tabularis://plugin-install" => {
                Some(AuthorizationLevel::Sensitive)
            }
            "ai://pending_approval"
            | "ai://activity"
            | "ssh-askpass://request"
            | "ssh-askpass://dismiss" => Some(AuthorizationLevel::Sensitive),
            "update-progress" | "update-installing" | "server://lifecycle" => {
                Some(AuthorizationLevel::LocalAdmin)
            }
            _ => None,
        }
    }

    fn publish(
        &self,
        target_session: Option<Uuid>,
        event: &str,
        payload: Value,
    ) -> Result<(), String> {
        let required = Self::authorization_for(event)
            .ok_or_else(|| format!("Web event is not registered: {event}"))?;
        let now = Instant::now();
        let mut state = self.lock_state();
        self.cleanup_sessions(&mut state, now);
        state.next_sequence = state.next_sequence.wrapping_add(1).max(1);
        let envelope = EventEnvelope {
            event: event.to_string(),
            payload,
            sequence: state.next_sequence,
        };

        let mut found_scope = target_session.is_none();
        let mut authorized_scope = target_session.is_none();
        for (session_id, session) in &mut state.sessions {
            if target_session.is_some_and(|target| target != *session_id) {
                continue;
            }
            found_scope = true;
            if !session.authorization.permits(required) {
                continue;
            }
            authorized_scope = true;
            session.last_seen = now;
            session.history.push_back(envelope.clone());
            while session.history.len() > self.inner.config.session_history_capacity {
                session.history.pop_front();
            }
            session.connections.retain(|_, connection| {
                if !connection.subscriptions.contains(event) {
                    return true;
                }
                connection.sender.try_send(envelope.clone()).is_ok()
            });
        }

        if !found_scope {
            Err("The target WebSocket session is not available".to_string())
        } else if !authorized_scope {
            Err("The target WebSocket session is not authorized for this event".to_string())
        } else {
            Ok(())
        }
    }

    fn subscribe(
        &self,
        session_id: Uuid,
        connection_id: Uuid,
        events: &[String],
        since: Option<u64>,
    ) -> Result<Vec<EventEnvelope>, String> {
        let mut state = self.lock_state();
        let session = state
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| "The WebSocket session is no longer available".to_string())?;
        for event in events {
            let required = Self::authorization_for(event)
                .ok_or_else(|| format!("Web event is not registered: {event}"))?;
            if !session.authorization.permits(required) {
                return Err(format!("The session is not authorized for event: {event}"));
            }
        }
        let connection = session
            .connections
            .get_mut(&connection_id)
            .ok_or_else(|| "The WebSocket connection is no longer available".to_string())?;
        connection.subscriptions.extend(events.iter().cloned());
        session.last_seen = Instant::now();

        let Some(sequence) = since else {
            return Ok(Vec::new());
        };
        let selected: HashSet<&str> = events.iter().map(String::as_str).collect();
        Ok(session
            .history
            .iter()
            .filter(|envelope| {
                envelope.sequence > sequence && selected.contains(envelope.event.as_str())
            })
            .cloned()
            .collect())
    }

    fn unsubscribe(
        &self,
        session_id: Uuid,
        connection_id: Uuid,
        events: &[String],
    ) -> Result<(), String> {
        let mut state = self.lock_state();
        let session = state
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| "The WebSocket session is no longer available".to_string())?;
        let connection = session
            .connections
            .get_mut(&connection_id)
            .ok_or_else(|| "The WebSocket connection is no longer available".to_string())?;
        for event in events {
            connection.subscriptions.remove(event);
        }
        session.last_seen = Instant::now();
        Ok(())
    }

    fn disconnect(&self, session_id: Uuid, connection_id: Uuid) {
        let mut state = self.lock_state();
        if let Some(session) = state.sessions.get_mut(&session_id) {
            session.connections.remove(&connection_id);
            session.last_seen = Instant::now();
        }
    }

    fn is_connected(&self, session_id: Uuid, connection_id: Uuid) -> bool {
        self.lock_state()
            .sessions
            .get(&session_id)
            .is_some_and(|session| session.connections.contains_key(&connection_id))
    }

    fn cleanup_sessions(&self, state: &mut EventBusState, now: Instant) {
        let ttl = self.inner.config.disconnected_session_ttl;
        state.sessions.retain(|_, session| {
            !session.connections.is_empty() || now.duration_since(session.last_seen) < ttl
        });
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, EventBusState> {
        self.inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }

    #[cfg(test)]
    pub fn connection_count(&self, session_id: Uuid) -> usize {
        self.lock_state()
            .sessions
            .get(&session_id)
            .map_or(0, |session| session.connections.len())
    }

    #[cfg(test)]
    pub fn history_len(&self, session_id: Uuid) -> usize {
        self.lock_state()
            .sessions
            .get(&session_id)
            .map_or(0, |session| session.history.len())
    }
}

impl RuntimeEvents for WebEventBus {
    fn emit(&self, event: &str, payload: Value) -> Result<(), String> {
        self.publish(None, event, payload)
    }

    fn emit_to(&self, session_id: Uuid, event: &str, payload: Value) -> Result<(), String> {
        self.publish(Some(session_id), event, payload)
    }
}

impl EventConnection {
    pub fn subscribe(
        &mut self,
        events: &[String],
        since: Option<u64>,
    ) -> Result<Vec<EventEnvelope>, String> {
        self.bus
            .subscribe(self.session_id, self.connection_id, events, since)
    }

    pub fn unsubscribe(&mut self, events: &[String]) -> Result<(), String> {
        self.bus
            .unsubscribe(self.session_id, self.connection_id, events)
    }

    pub async fn recv(&mut self) -> Option<EventEnvelope> {
        let event = self.receiver.recv().await?;
        self.bus
            .is_connected(self.session_id, self.connection_id)
            .then_some(event)
    }

    pub fn try_recv(&mut self) -> Result<EventEnvelope, mpsc::error::TryRecvError> {
        self.receiver.try_recv()
    }
}

impl Drop for EventConnection {
    fn drop(&mut self) {
        self.bus.disconnect(self.session_id, self.connection_id);
    }
}
