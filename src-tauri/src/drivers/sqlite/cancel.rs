//! Stops a running SQLite statement, for the connection's query timeout and
//! for Stop. SQLite runs in-process, so there is no server to ask: a progress
//! handler, called every [`PROGRESS_OPS`] virtual machine steps, interrupts
//! the statement once its run's stop flag is set. The statement then fails
//! with `SQLITE_INTERRUPT` and any open write in it is rolled back.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use sqlx::pool::PoolConnection;
use sqlx::{Sqlite, SqliteConnection};

use crate::models::{ConnectionParams, QueryResult};

use super::exec_on_sqlite_conn;

/// How many virtual machine steps run between two checks of the stop flag.
/// A check is one atomic load; at this rate a stop lands within microseconds.
const PROGRESS_OPS: i32 = 1_000;

/// How long a stopped statement gets to end. The handler does not run while
/// SQLite waits on another connection's lock (the busy timeout), so a stop
/// can land late there.
const CANCEL_GRACE: Duration = Duration::from_secs(5);

/// Starts the error of a statement the timeout stopped.
const STOPPED_PREFIX: &str = "Query stopped after ";

/// Whether `error` is the timeout stopping a statement.
pub(super) fn is_stopped(error: &str) -> bool {
    error.starts_with(STOPPED_PREFIX)
}

/// A pooled connection a run is using, with a progress handler that stops the
/// running statement once asked.
///
/// Call [`Self::release`] once the run is done: it removes the handler and
/// returns the connection to the pool. If the run is dropped first (Stop, or
/// an error path), the running statement is interrupted and the connection is
/// closed rather than returned, so the next borrower never waits on it.
pub(super) struct InFlight {
    conn: Option<PoolConnection<Sqlite>>,
    stop: Arc<AtomicBool>,
}

impl InFlight {
    pub(super) async fn new(mut conn: PoolConnection<Sqlite>) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        conn.lock_handle()
            .await
            .map_err(|e| e.to_string())?
            .set_progress_handler(PROGRESS_OPS, move || !flag.load(Ordering::Relaxed));
        Ok(Self {
            conn: Some(conn),
            stop,
        })
    }

    pub(super) fn conn(&mut self) -> &mut SqliteConnection {
        self.conn
            .as_mut()
            .expect("connection taken only by release or drop")
    }

    /// Removes the progress handler and returns the connection to the pool.
    /// If the handler can't be removed, the connection is closed instead.
    pub(super) async fn release(mut self) {
        let Some(mut conn) = self.conn.take() else {
            return;
        };
        let removed = match conn.lock_handle().await {
            Ok(mut handle) => {
                handle.remove_progress_handler();
                Ok(())
            }
            Err(e) => Err(e),
        };
        if let Err(e) = removed {
            log::warn!("SQLite: removing the progress handler failed: {e}");
            drop(conn.detach());
        }
    }

    /// Runs one statement under the connection's query timeout. When it runs
    /// over, it is interrupted and fails with a "stopped after N s" error.
    ///
    /// The outer `Err` means the statement was still running after
    /// [`CANCEL_GRACE`]: drop this run without releasing it, so the
    /// connection is closed.
    pub(super) async fn exec_within_query_timeout(
        &mut self,
        params: &ConnectionParams,
        query: &str,
        limit: Option<u32>,
        page: u32,
    ) -> Result<Result<QueryResult, String>, String> {
        let stop = Arc::clone(&self.stop);
        let Some(timeout) = crate::pool_manager::query_timeout(params) else {
            return Ok(exec_on_sqlite_conn(self.conn(), query, limit, page).await);
        };
        let run = exec_on_sqlite_conn(self.conn(), query, limit, page);
        tokio::pin!(run);
        if let Ok(outcome) = tokio::time::timeout(timeout, &mut run).await {
            return Ok(outcome);
        }
        stop.store(true, Ordering::Relaxed);
        let stopped = format!(
            "{STOPPED_PREFIX}{} s by the connection's query timeout",
            timeout.as_secs()
        );
        match tokio::time::timeout(CANCEL_GRACE, run).await {
            Ok(outcome) => {
                // The statement has ended; the next one on this connection
                // must run.
                stop.store(false, Ordering::Relaxed);
                Ok(match outcome {
                    Err(e) if is_interrupted(&e) => Err(stopped),
                    // Finished, or failed for its own reason, before the
                    // interrupt landed.
                    other => other,
                })
            }
            Err(_) => Err(format!(
                "{stopped}. SQLite did not end it, so the connection was closed."
            )),
        }
    }
}

impl Drop for InFlight {
    fn drop(&mut self) {
        let Some(conn) = self.conn.take() else {
            return;
        };
        // Dropping the query future does not stop the statement: SQLite's
        // worker thread keeps stepping it until the handler says stop.
        self.stop.store(true, Ordering::Relaxed);
        drop(conn.detach());
    }
}

/// Whether a statement error is SQLite's `SQLITE_INTERRUPT` (code 9), which
/// the progress handler produces. sqlx renders it as
/// `error returned from database: (code: 9) interrupted`.
fn is_interrupted(error: &str) -> bool {
    error.contains("(code: 9)")
}

#[cfg(test)]
mod tests {
    use super::is_interrupted;

    #[test]
    fn recognises_only_the_interrupt_code() {
        assert!(is_interrupted(
            "error returned from database: (code: 9) interrupted"
        ));
        assert!(!is_interrupted(
            "error returned from database: (code: 1) no such table: t"
        ));
        assert!(!is_interrupted(
            "error returned from database: (code: 19) UNIQUE constraint failed"
        ));
    }
}
