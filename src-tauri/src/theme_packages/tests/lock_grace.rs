use super::super::files;
use super::archive::temp_dir;
use std::time::{Duration, Instant};

const IN_PROGRESS: &str = "Another theme operation is in progress";

#[test]
fn contention_is_retried_until_the_lock_is_free() {
    let mut contended_for = 3;
    let mut calls = 0;
    let result = files::lock_within_grace(|| {
        calls += 1;
        if contended_for == 0 {
            return Ok(());
        }
        contended_for -= 1;
        Err(fs2::lock_contended_error())
    });
    assert!(result.is_ok());
    assert_eq!(calls, 4);
}

#[test]
fn other_errors_are_returned_without_a_retry() {
    let mut calls = 0;
    let result = files::lock_within_grace(|| {
        calls += 1;
        Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied))
    });
    assert_eq!(
        result.unwrap_err().kind(),
        std::io::ErrorKind::PermissionDenied
    );
    assert_eq!(calls, 1);
}

#[test]
fn a_lock_released_during_the_grace_period_is_acquired() {
    let root = temp_dir();
    let held = files::write_lock(root.path()).unwrap();
    let releaser = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(50));
        drop(held);
    });
    files::write_lock(root.path()).expect("the holder lets go well within the grace period");
    releaser.join().unwrap();
}

#[test]
fn a_lock_that_stays_held_is_still_reported_in_progress() {
    let root = temp_dir();
    let _held = files::write_lock(root.path()).unwrap();
    let started = Instant::now();
    assert_eq!(files::write_lock(root.path()).unwrap_err(), IN_PROGRESS);
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "the wait is bounded"
    );
}

/// A flock belongs to an open file description, and a child process inherits
/// a copy of every descriptor that is open when it forks, until it execs. A
/// lock released just before another thread starts a process therefore stays
/// held for a moment, and the next operation used to be told another one was
/// in progress. Nothing else in this test touches the lock.
#[cfg(unix)]
#[test]
fn consecutive_locks_survive_processes_started_by_other_threads() {
    use std::process::{Command, Stdio};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let root = temp_dir();
    let stop = Arc::new(AtomicBool::new(false));
    let spawner = {
        let stop = stop.clone();
        std::thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                Command::new("true")
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status()
                    .unwrap();
            }
        })
    };

    let deadline = Instant::now() + Duration::from_millis(500);
    let mut failure = None;
    'rounds: while Instant::now() < deadline {
        for _ in 0..2 {
            match files::write_lock(root.path()) {
                Ok(lock) => drop(lock),
                Err(error) => {
                    failure = Some(error);
                    break 'rounds;
                }
            }
        }
    }

    stop.store(true, Ordering::Relaxed);
    spawner.join().unwrap();
    assert_eq!(failure, None);
}
