//! A cooldown-gate primitive used to rate-limit expensive recovery actions
//! (a filesystem rescan, a disk-config reconcile) triggered from a tight
//! retry loop. See [`RELOAD_COOLDOWN`] and [`DISABLE_CHECK_COOLDOWN`] for
//! this module's two independent, deliberately-separate instances.

use std::sync::Mutex;
use std::time::{Duration, Instant};

/// A cooldown gate: returns `true` at most once per `duration`, recording
/// the last successful check so a caller can rate-limit an expensive
/// recovery action triggered from a tight retry loop.
pub(super) struct Cooldown {
    duration: Duration,
    last: Mutex<Option<Instant>>,
}

impl Cooldown {
    pub(super) const fn new(duration: Duration) -> Self {
        Self {
            duration,
            last: Mutex::new(None),
        }
    }

    /// Returns `true` at most once per `duration`, recording `now` as the
    /// new last-attempt time whenever it does.
    pub(super) fn elapsed(&self) -> bool {
        let mut last = self.last.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        let elapsed = cooldown_elapsed(*last, now, self.duration);
        if elapsed {
            *last = Some(now);
        }
        elapsed
    }
}

/// Pure core of [`Cooldown::elapsed`]: whether `cooldown` has passed since
/// `last` (or `last` is `None`, meaning no attempt has been recorded yet),
/// as of `now`.
fn cooldown_elapsed(last: Option<Instant>, now: Instant, cooldown: Duration) -> bool {
    match last {
        Some(t) => now.duration_since(t) >= cooldown,
        None => true,
    }
}

/// Minimum time between plugin-directory rescans triggered by a registry
/// miss in `resolve_db_driver`.
pub(super) static RELOAD_COOLDOWN: Cooldown = Cooldown::new(Duration::from_secs(2));

/// Minimum time between disk-config reconcile checks (disable/uninstall
/// detection, issue #787) run at the top of `resolve_driver_for_params`.
/// Independent of [`RELOAD_COOLDOWN`]: sharing one instance would let a busy
/// reconcile check consume the cooldown budget a genuine registry-miss
/// rescan needs to stay responsive.
pub(super) static DISABLE_CHECK_COOLDOWN: Cooldown = Cooldown::new(Duration::from_secs(2));

#[cfg(test)]
mod tests;
