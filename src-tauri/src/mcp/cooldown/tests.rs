use super::*;

/// `cooldown_elapsed` gates `resolve_db_driver`'s plugin-directory rescan on
/// a registry miss (issue #783), so a connection whose driver id is
/// genuinely wrong can't force a filesystem scan on every call from a tight
/// retry loop. Exercised on synthetic `Instant`s, not real sleeps.
#[test]
fn cooldown_elapsed_is_true_with_no_prior_attempt() {
    let now = Instant::now();
    assert!(cooldown_elapsed(None, now, Duration::from_secs(2)));
}

#[test]
fn cooldown_elapsed_is_false_immediately_after_an_attempt() {
    let now = Instant::now();
    assert!(!cooldown_elapsed(Some(now), now, Duration::from_secs(2)));
}

#[test]
fn cooldown_elapsed_is_false_just_before_the_cooldown_ends() {
    let cooldown = Duration::from_secs(2);
    let last = Instant::now();
    let now = last + cooldown - Duration::from_millis(1);
    assert!(!cooldown_elapsed(Some(last), now, cooldown));
}

#[test]
fn cooldown_elapsed_is_true_once_the_cooldown_has_fully_passed() {
    let cooldown = Duration::from_secs(2);
    let last = Instant::now();
    let now = last + cooldown;
    assert!(cooldown_elapsed(Some(last), now, cooldown));
}

/// `Cooldown::elapsed` end-to-end, on real (short) sleeps rather than
/// synthetic `Instant`s: fires once per window, records the attempt, and
/// two instances never share state — confirming `RELOAD_COOLDOWN` and
/// `DISABLE_CHECK_COOLDOWN` genuinely can't starve each other.
#[test]
fn cooldown_gate_fires_once_per_window_and_instances_are_independent() {
    let a = Cooldown::new(Duration::from_millis(50));
    let b = Cooldown::new(Duration::from_millis(50));
    assert!(a.elapsed());
    assert!(!a.elapsed());
    assert!(b.elapsed(), "separate instance has its own state");
    std::thread::sleep(Duration::from_millis(60));
    assert!(a.elapsed());
}
