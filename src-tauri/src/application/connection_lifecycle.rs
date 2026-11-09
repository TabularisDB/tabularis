//! Transport-independent health and recovery state for open connections.
//!
//! A transport runs the ping loop and owns pools, tunnels and event delivery.
//! This module decides what a ping result means: keep the connection, try one
//! reconnect, or give it up.

use serde::Serialize;
use std::collections::HashMap;
use std::time::{Duration, SystemTime};

/// Consecutive failed pings before a connection is recovered or dropped.
pub const FAILURE_THRESHOLD: u32 = 2;

/// Upper bound for the single reconnect attempt, including pool creation.
pub const RECONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// Event emitted while a connection is being recovered. A connection that
/// cannot be recovered is reported through `connection-health-failed`.
pub const CONNECTION_LIFECYCLE_EVENT: &str = "connection-lifecycle";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ConnectionLifecycle {
    Reconnecting,
    /// Recovered with a fresh pool. Released tab sessions lost their server
    /// state, including any open transaction, and are never replayed.
    Reconnected {
        #[serde(rename = "releasedSessions")]
        released_sessions: usize,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionLifecycleEvent {
    pub connection_id: String,
    #[serde(flatten)]
    pub lifecycle: ConnectionLifecycle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PingVerdict {
    Healthy,
    Suspect,
    Failed,
}

/// Failure counts for every pinged connection, plus the wall-clock time of the
/// previous tick so a resume from sleep can be told apart from a dead link.
#[derive(Debug)]
pub struct HealthTracker {
    interval: Duration,
    last_tick: Option<SystemTime>,
    failures: HashMap<String, u32>,
}

impl HealthTracker {
    pub fn new(interval: Duration) -> Self {
        Self {
            interval,
            last_tick: None,
            failures: HashMap::new(),
        }
    }

    /// Start a tick at wall-clock time `now`. Returns true when the gap since
    /// the previous tick shows the machine was asleep. Failures counted before
    /// the gap are forgotten, so a sleeping link gets a fresh ping before it
    /// can be torn down.
    ///
    /// The wall clock is used because the monotonic clock stops during suspend
    /// on Linux and macOS.
    pub fn begin_tick(&mut self, now: SystemTime) -> bool {
        let resumed = self.last_tick.is_some_and(|last| {
            now.duration_since(last)
                .is_ok_and(|gap| gap > self.interval * 2)
        });
        self.last_tick = Some(now);
        if resumed {
            self.failures.clear();
        }
        resumed
    }

    pub fn record(&mut self, connection_id: &str, ping_ok: bool) -> PingVerdict {
        if ping_ok {
            self.failures.remove(connection_id);
            return PingVerdict::Healthy;
        }
        let count = self.failures.entry(connection_id.to_string()).or_insert(0);
        *count += 1;
        if *count < FAILURE_THRESHOLD {
            return PingVerdict::Suspect;
        }
        self.failures.remove(connection_id);
        PingVerdict::Failed
    }

    pub fn failures(&self, connection_id: &str) -> u32 {
        self.failures.get(connection_id).copied().unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const INTERVAL: Duration = Duration::from_secs(30);

    fn at(secs: u64) -> SystemTime {
        SystemTime::UNIX_EPOCH + Duration::from_secs(secs)
    }

    #[test]
    fn fails_after_threshold_consecutive_failures() {
        let mut tracker = HealthTracker::new(INTERVAL);
        assert_eq!(tracker.record("a", false), PingVerdict::Suspect);
        assert_eq!(tracker.record("a", false), PingVerdict::Failed);
        assert_eq!(tracker.failures("a"), 0);
    }

    #[test]
    fn success_resets_the_count() {
        let mut tracker = HealthTracker::new(INTERVAL);
        tracker.record("a", false);
        assert_eq!(tracker.record("a", true), PingVerdict::Healthy);
        assert_eq!(tracker.record("a", false), PingVerdict::Suspect);
    }

    #[test]
    fn counts_are_per_connection() {
        let mut tracker = HealthTracker::new(INTERVAL);
        tracker.record("a", false);
        assert_eq!(tracker.record("b", false), PingVerdict::Suspect);
    }

    #[test]
    fn regular_ticks_are_not_a_resume() {
        let mut tracker = HealthTracker::new(INTERVAL);
        assert!(!tracker.begin_tick(at(0)));
        assert!(!tracker.begin_tick(at(30)));
        assert!(!tracker.begin_tick(at(90)));
    }

    #[test]
    fn a_long_gap_forgets_failures_from_before_sleep() {
        let mut tracker = HealthTracker::new(INTERVAL);
        tracker.begin_tick(at(0));
        tracker.record("a", false);
        assert!(tracker.begin_tick(at(3_600)));
        assert_eq!(tracker.record("a", false), PingVerdict::Suspect);
        assert_eq!(tracker.record("a", false), PingVerdict::Failed);
    }

    #[test]
    fn a_clock_moved_backwards_is_not_a_resume() {
        let mut tracker = HealthTracker::new(INTERVAL);
        tracker.begin_tick(at(1_000));
        tracker.record("a", false);
        assert!(!tracker.begin_tick(at(10)));
        assert_eq!(tracker.failures("a"), 1);
    }

    #[test]
    fn lifecycle_event_payload_shape() {
        let reconnecting = ConnectionLifecycleEvent {
            connection_id: "c1".into(),
            lifecycle: ConnectionLifecycle::Reconnecting,
        };
        assert_eq!(
            serde_json::to_value(&reconnecting).unwrap(),
            serde_json::json!({"connectionId": "c1", "state": "reconnecting"})
        );
        let reconnected = ConnectionLifecycleEvent {
            connection_id: "c1".into(),
            lifecycle: ConnectionLifecycle::Reconnected {
                released_sessions: 2,
            },
        };
        assert_eq!(
            serde_json::to_value(&reconnected).unwrap(),
            serde_json::json!({"connectionId": "c1", "state": "reconnected", "releasedSessions": 2})
        );
    }
}
