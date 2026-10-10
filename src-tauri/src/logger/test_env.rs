//! Shared control of `RUST_LOG` for tests that read it.
//!
//! `RUST_LOG` is process-wide, so every test that reads or writes it has to go
//! through here: `cargo test` runs tests in parallel threads against one
//! environment, which otherwise makes them order-dependent and flaky.
//!
//! Reachable from anywhere in the crate via `logger::test_env`, so modules other
//! than `logger::tests` can join the same lock.

use std::sync::Mutex;

/// Serialises every test that touches `RUST_LOG`.
pub(crate) static ENV_LOCK: Mutex<()> = Mutex::new(());

/// Run `body` with `RUST_LOG` set to `value` (removed when `None`), holding
/// [`ENV_LOCK`] for the duration and restoring the previous value even if
/// `body` panics, so a failure cannot leak the variable into other tests.
pub(crate) fn with_rust_log<T>(value: Option<&str>, body: impl FnOnce() -> T) -> T {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    // Restores on drop, so a failing assertion inside `body` cannot leave a
    // rewritten `RUST_LOG` behind for whatever runs next.
    struct Restore(Option<String>);
    impl Drop for Restore {
        fn drop(&mut self) {
            match &self.0 {
                Some(v) => std::env::set_var("RUST_LOG", v),
                None => std::env::remove_var("RUST_LOG"),
            }
        }
    }

    let _restore = Restore(std::env::var("RUST_LOG").ok());
    match value {
        Some(v) => std::env::set_var("RUST_LOG", v),
        None => std::env::remove_var("RUST_LOG"),
    }
    body()
}
