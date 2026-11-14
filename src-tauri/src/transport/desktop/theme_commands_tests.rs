use super::theme_commands::run_blocking;
use crate::application::persistence;
use crate::runtime::events::NoopRuntimeEvents;
use crate::runtime::paths::FixedRuntimePaths;
use crate::runtime::secrets::KeyringRuntimeSecrets;
use crate::runtime::RuntimeContext;
use fs2::FileExt;
use std::fs::OpenOptions;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

const NOT_FOUND: &str = "Personal theme not found";

fn runtime(root: &Path) -> RuntimeContext {
    // Theme storage refuses any path that passes through a symlink, and macOS
    // keeps temporary files under /var, a symlink to /private/var.
    let root = root.to_path_buf();
    #[cfg(unix)]
    let root = root.canonicalize().unwrap();
    RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(root.clone(), root)),
        Arc::new(NoopRuntimeEvents),
        Arc::new(KeyringRuntimeSecrets),
    )
}

#[tokio::test(flavor = "current_thread")]
async fn the_work_runs_on_another_thread_while_the_caller_keeps_running() {
    let temp = tempfile::tempdir().unwrap();
    let caller = std::thread::current().id();
    let (release, released) = std::sync::mpsc::channel::<()>();
    // Only a task on the calling thread can send this, so the work can finish
    // in time only if that thread is free while the work runs. The send result
    // is ignored: when the work held the thread, the receiver is already gone by
    // the time this runs, and the assertions below say so.
    let sender = tokio::spawn(async move {
        let _ = release.send(());
    });

    let (worker, caller_was_free) = run_blocking(runtime(temp.path()), move |_| {
        (
            std::thread::current().id(),
            released.recv_timeout(Duration::from_secs(5)).is_ok(),
        )
    })
    .await
    .unwrap();

    sender.await.unwrap();
    assert_ne!(worker, caller, "the work ran on the calling thread");
    assert!(
        caller_was_free,
        "the calling thread was held while the work ran"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn a_contended_theme_lock_is_waited_for_off_the_calling_thread() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = runtime(temp.path());
    let lock_path = runtime.paths.config_dir().join(".theme-write.lock");

    // An uncontended call creates the lock file where theme storage expects it.
    assert_eq!(
        persistence::delete_custom_theme(&runtime, "custom-missing").unwrap_err(),
        NOT_FOUND
    );
    assert!(
        lock_path.exists(),
        "theme storage moved its write lock; update this test"
    );

    let held = OpenOptions::new().write(true).open(&lock_path).unwrap();
    FileExt::try_lock_exclusive(&held).unwrap();
    // Only a task on the calling thread can let go of the lock, so the delete
    // can get it only if that thread is free while the delete waits.
    let holder = tokio::spawn(async move { drop(held) });

    let outcome = run_blocking(runtime, |runtime| {
        persistence::delete_custom_theme(runtime, "custom-missing")
    })
    .await
    .unwrap();

    holder.await.unwrap();
    // Reaching the missing-theme check means the lock was acquired after the
    // holder let go, instead of the wait running out first.
    assert_eq!(outcome.unwrap_err(), NOT_FOUND);
}

#[tokio::test(flavor = "current_thread")]
async fn a_panicking_task_is_reported_as_an_error() {
    let temp = tempfile::tempdir().unwrap();

    let outcome = run_blocking(runtime(temp.path()), |_| -> u8 {
        panic!("theme storage failed")
    })
    .await;

    assert!(outcome.is_err());
}
