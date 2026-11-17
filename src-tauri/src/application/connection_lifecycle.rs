//! Transport-independent health and recovery state for open connections.
//!
//! A transport runs the ping loop and owns pools, tunnels and event delivery.
//! This module decides what a ping result means: keep the connection, try one
//! reconnect, or give it up.

use crate::application::tunnels::TunnelLease;
use serde::Serialize;
use std::collections::HashMap;
use std::time::{Duration, SystemTime};

/// Consecutive failed pings before a connection is recovered or dropped.
pub const FAILURE_THRESHOLD: u32 = 2;

/// Upper bound for one recovery: closing the old pools, opening a fresh one
/// and pinging through it.
pub const RECONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// How long teardown waits for a failed connection's pools to close. A
/// connection still checked out by a query on a dead link would otherwise keep
/// `sqlx::Pool::close` waiting forever.
pub const POOL_CLOSE_TIMEOUT: Duration = Duration::from_secs(5);

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

/// Failure counts for every pinged connection, plus the wall-clock time the
/// previous tick finished so a resume from sleep can be told apart from a dead
/// link.
#[derive(Debug)]
pub struct HealthTracker {
    interval: Duration,
    last_tick_end: Option<SystemTime>,
    failures: HashMap<String, u32>,
}

impl HealthTracker {
    pub fn new(interval: Duration) -> Self {
        Self {
            interval,
            last_tick_end: None,
            failures: HashMap::new(),
        }
    }

    /// Start a tick at wall-clock time `now`. Returns true when the gap since
    /// the previous tick finished shows the machine was asleep. Failures
    /// counted before the gap are forgotten, so a sleeping link gets a fresh
    /// ping before it can be torn down.
    ///
    /// The gap is measured from the end of the previous tick, so a tick slowed
    /// by ping or reconnect timeouts is not mistaken for a sleep. The wall
    /// clock is used because the monotonic clock stops during suspend on Linux
    /// and macOS.
    pub fn begin_tick(&mut self, now: SystemTime) -> bool {
        let resumed = self.last_tick_end.is_some_and(|last| {
            now.duration_since(last)
                .is_ok_and(|gap| gap > self.interval * 2)
        });
        if resumed {
            self.failures.clear();
        }
        resumed
    }

    /// Finish a tick at wall-clock time `now`, after its pings and reconnects.
    pub fn end_tick(&mut self, now: SystemTime) {
        self.last_tick_end = Some(now);
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

    /// Drop the failure count of a connection that is being recovered early.
    pub fn forget(&mut self, connection_id: &str) {
        self.failures.remove(connection_id);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PingOutcome {
    Ok,
    /// No answer within the ping timeout: the link, or the tunnel under it,
    /// may be half-open.
    TimedOut,
    Error(String),
}

impl PingOutcome {
    pub fn error(&self) -> Option<&str> {
        match self {
            PingOutcome::Ok => None,
            PingOutcome::TimedOut => Some("Ping timed out"),
            PingOutcome::Error(err) => Some(err),
        }
    }
}

/// One connection's ping in a tick, with the SSH tunnel it went through.
#[derive(Debug, Clone)]
pub struct TickPing {
    pub connection_id: String,
    pub lease: Option<TunnelLease>,
    pub outcome: PingOutcome,
    pub verdict: PingVerdict,
}

/// A shared SSH tunnel to stop, and every connection that was using it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TunnelDiscard {
    pub lease: TunnelLease,
    pub recover: Vec<String>,
}

/// Tunnels that look half-open: no connection through them pinged Ok, at
/// least one timed out, and one has failed for good. A refused or rejected
/// ping means the tunnel still carried it, so errors alone never discard.
///
/// With auto-reconnect off, a tunnel is discarded only when every connection
/// using it is being dropped, so none is left on a stopped tunnel.
pub fn tunnel_discards(tick: &[TickPing], auto_reconnect: bool) -> Vec<TunnelDiscard> {
    let mut holders: Vec<(&TunnelLease, Vec<&TickPing>)> = Vec::new();
    for ping in tick {
        let Some(lease) = &ping.lease else { continue };
        match holders.iter_mut().find(|(held, _)| *held == lease) {
            Some((_, pings)) => pings.push(ping),
            None => holders.push((lease, vec![ping])),
        }
    }
    holders
        .into_iter()
        .filter(|(_, pings)| {
            let failed = |p: &&TickPing| p.verdict == PingVerdict::Failed;
            pings.iter().all(|p| p.outcome != PingOutcome::Ok)
                && pings.iter().any(|p| p.outcome == PingOutcome::TimedOut)
                && pings.iter().any(failed)
                && (auto_reconnect || pings.iter().all(failed))
        })
        .map(|(lease, pings)| TunnelDiscard {
            lease: lease.clone(),
            recover: pings.iter().map(|p| p.connection_id.clone()).collect(),
        })
        .collect()
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

    fn tick(tracker: &mut HealthTracker, start: u64, end: u64) -> bool {
        let resumed = tracker.begin_tick(at(start));
        tracker.end_tick(at(end));
        resumed
    }

    #[test]
    fn regular_ticks_are_not_a_resume() {
        let mut tracker = HealthTracker::new(INTERVAL);
        assert!(!tick(&mut tracker, 0, 0));
        assert!(!tick(&mut tracker, 30, 30));
        assert!(!tick(&mut tracker, 90, 90));
    }

    #[test]
    fn a_slow_tick_is_not_a_resume() {
        let mut tracker = HealthTracker::new(Duration::from_secs(2));
        tracker.begin_tick(at(0));
        assert_eq!(tracker.record("a", false), PingVerdict::Suspect);
        tracker.end_tick(at(5));
        assert!(!tracker.begin_tick(at(7)));
        assert_eq!(tracker.record("a", false), PingVerdict::Failed);
    }

    #[test]
    fn a_long_gap_forgets_failures_from_before_sleep() {
        let mut tracker = HealthTracker::new(INTERVAL);
        tick(&mut tracker, 0, 0);
        tracker.record("a", false);
        assert!(tracker.begin_tick(at(3_600)));
        assert_eq!(tracker.record("a", false), PingVerdict::Suspect);
        assert_eq!(tracker.record("a", false), PingVerdict::Failed);
    }

    #[test]
    fn a_clock_moved_backwards_is_not_a_resume() {
        let mut tracker = HealthTracker::new(INTERVAL);
        tick(&mut tracker, 1_000, 1_000);
        tracker.record("a", false);
        assert!(!tracker.begin_tick(at(10)));
        assert_eq!(tracker.failures("a"), 1);
    }

    fn lease(generation: u64) -> Option<TunnelLease> {
        Some(TunnelLease {
            key: "user@bastion:22:db->5432".into(),
            generation,
        })
    }

    fn ping(
        id: &str,
        lease: Option<TunnelLease>,
        outcome: PingOutcome,
        verdict: PingVerdict,
    ) -> TickPing {
        TickPing {
            connection_id: id.into(),
            lease,
            outcome,
            verdict,
        }
    }

    fn recovered(discards: &[TunnelDiscard]) -> Vec<Vec<&str>> {
        discards
            .iter()
            .map(|d| d.recover.iter().map(String::as_str).collect())
            .collect()
    }

    #[test]
    fn a_timed_out_tunnel_is_discarded_with_every_holder() {
        let tick = [
            ping("a", lease(1), PingOutcome::TimedOut, PingVerdict::Failed),
            ping("b", lease(1), PingOutcome::TimedOut, PingVerdict::Suspect),
        ];
        let discards = tunnel_discards(&tick, true);
        assert_eq!(recovered(&discards), vec![vec!["a", "b"]]);
        assert_eq!(discards[0].lease, lease(1).unwrap());
    }

    #[test]
    fn a_holder_that_pings_ok_keeps_the_tunnel() {
        let tick = [
            ping("a", lease(1), PingOutcome::TimedOut, PingVerdict::Failed),
            ping("b", lease(1), PingOutcome::Ok, PingVerdict::Healthy),
        ];
        assert!(tunnel_discards(&tick, true).is_empty());
    }

    #[test]
    fn errors_without_a_timeout_keep_the_tunnel() {
        let refused = PingOutcome::Error("connection refused".into());
        let tick = [ping("a", lease(1), refused, PingVerdict::Failed)];
        assert!(tunnel_discards(&tick, true).is_empty());
    }

    #[test]
    fn a_tunnel_is_kept_until_a_holder_has_failed() {
        let tick = [ping(
            "a",
            lease(1),
            PingOutcome::TimedOut,
            PingVerdict::Suspect,
        )];
        assert!(tunnel_discards(&tick, true).is_empty());
    }

    #[test]
    fn generations_of_one_key_are_separate_tunnels() {
        let tick = [
            ping("a", lease(1), PingOutcome::TimedOut, PingVerdict::Failed),
            ping("b", lease(2), PingOutcome::Ok, PingVerdict::Healthy),
        ];
        let discards = tunnel_discards(&tick, true);
        assert_eq!(recovered(&discards), vec![vec!["a"]]);
        assert_eq!(discards[0].lease.generation, 1);
    }

    #[test]
    fn connections_without_a_tunnel_are_never_grouped() {
        let tick = [
            ping("a", None, PingOutcome::TimedOut, PingVerdict::Failed),
            ping("b", None, PingOutcome::TimedOut, PingVerdict::Failed),
        ];
        assert!(tunnel_discards(&tick, true).is_empty());
    }

    #[test]
    fn without_auto_reconnect_every_holder_must_have_failed() {
        let one_left = [
            ping("a", lease(1), PingOutcome::TimedOut, PingVerdict::Failed),
            ping("b", lease(1), PingOutcome::TimedOut, PingVerdict::Suspect),
        ];
        assert!(tunnel_discards(&one_left, false).is_empty());

        let all_failed = [
            ping("a", lease(1), PingOutcome::TimedOut, PingVerdict::Failed),
            ping(
                "b",
                lease(1),
                PingOutcome::Error("eof".into()),
                PingVerdict::Failed,
            ),
        ];
        assert_eq!(
            recovered(&tunnel_discards(&all_failed, false)),
            vec![vec!["a", "b"]]
        );
    }

    #[test]
    fn forget_clears_a_suspect_count() {
        let mut tracker = HealthTracker::new(INTERVAL);
        tracker.record("a", false);
        tracker.forget("a");
        assert_eq!(tracker.record("a", false), PingVerdict::Suspect);
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
