//! A pooled sqlx connection that is closed, not recycled, unless released.

use sqlx::pool::PoolConnection;
use sqlx::Database;

/// Holds a pooled connection while it carries session state that must not
/// reach the next borrower (an open read-only transaction, `query_only`).
///
/// Call [`Self::release`] once that state is reset to return the connection
/// to the pool. If the guard is dropped first, by an error path or a
/// cancelled query, the connection is detached from the pool and closed.
pub struct DetachOnDrop<DB: Database>(Option<PoolConnection<DB>>);

impl<DB: Database> DetachOnDrop<DB> {
    pub fn new(conn: PoolConnection<DB>) -> Self {
        Self(Some(conn))
    }

    pub fn conn(&mut self) -> &mut DB::Connection {
        self.0
            .as_mut()
            .expect("connection taken only by release or drop")
    }

    /// Return the connection to the pool.
    pub fn release(mut self) {
        drop(self.0.take());
    }
}

impl<DB: Database> Drop for DetachOnDrop<DB> {
    fn drop(&mut self) {
        if let Some(conn) = self.0.take() {
            drop(conn.detach());
        }
    }
}
