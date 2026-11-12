//! Stops a running MySQL statement on the server, for the connection's query
//! timeout and for Stop. MySQL has no cancel message on the wire: the stop is
//! `KILL QUERY <id>` sent over a second connection.

use std::time::Duration;

use sqlx::pool::PoolConnection;
use sqlx::{Connection as _, Executor as _, MySql, MySqlConnection, Pool, Row as _};

use crate::drivers::driver_trait::QueryChunkSink;
use crate::models::{ConnectionParams, QueryResult};

use super::{exec_on_mysql_conn, TextProto};

/// How long a stopped statement gets to end after `KILL QUERY`, and how long
/// the second connection that sends it may take.
const CANCEL_GRACE: Duration = Duration::from_secs(5);

/// A pooled connection a run is using, with the server's id for it.
///
/// Call [`Self::release`] once the run is done to return the connection to
/// the pool. If the run is dropped first (Stop, or an error path), the server
/// is asked to stop the running statement and the connection is closed
/// rather than returned, so the next borrower never waits on the old statement.
pub(super) struct InFlight {
    conn: Option<PoolConnection<MySql>>,
    killer: Killer,
}

impl InFlight {
    pub(super) async fn new(
        mut conn: PoolConnection<MySql>,
        pool: &Pool<MySql>,
    ) -> Result<Self, String> {
        let id: u64 = conn
            .fetch_one(sqlx::raw_sql("SELECT CONNECTION_ID()"))
            .await
            .and_then(|row| row.try_get(0))
            .map_err(|e| e.to_string())?;
        Ok(Self {
            conn: Some(conn),
            killer: Killer {
                pool: pool.clone(),
                id,
            },
        })
    }

    pub(super) fn conn(&mut self) -> &mut MySqlConnection {
        self.conn
            .as_mut()
            .expect("connection taken only by release or drop")
    }

    pub(super) fn release(mut self) {
        drop(self.conn.take());
    }

    /// Runs one statement under the connection's query timeout. When it runs
    /// over, the server is asked to stop it and it fails with a
    /// "stopped after N s" error.
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
        text: TextProto,
        stream: Option<&mut QueryChunkSink<'_>>,
    ) -> Result<Result<QueryResult, String>, String> {
        let killer = self.killer.clone();
        let run = exec_on_mysql_conn(self.conn(), query, limit, page, text, stream);
        let Some(timeout) = crate::pool_manager::query_timeout(params) else {
            return Ok(run.await);
        };
        tokio::pin!(run);
        if let Ok(outcome) = tokio::time::timeout(timeout, &mut run).await {
            return Ok(outcome);
        }
        killer.kill_query().await;
        let stopped = format!(
            "Query stopped after {} s by the connection's query timeout",
            timeout.as_secs()
        );
        match tokio::time::timeout(CANCEL_GRACE, run).await {
            // Finished between the timeout and the kill.
            Ok(Ok(result)) => Ok(Ok(result)),
            Ok(Err(e)) if is_query_interrupted(&e) => Ok(Err(stopped)),
            // Failed for its own reason before the kill landed.
            Ok(Err(e)) => Ok(Err(e)),
            Err(_) => Err(format!(
                "{stopped}. The server did not confirm the stop, so the connection was closed."
            )),
        }
    }
}

impl Drop for InFlight {
    fn drop(&mut self) {
        let Some(conn) = self.conn.take() else {
            return;
        };
        // Closing the connection alone does not stop the statement: the
        // server keeps running it until it next writes to the client.
        match tokio::runtime::Handle::try_current() {
            Ok(runtime) => {
                runtime.spawn(self.killer.clone().kill_query());
            }
            Err(_) => log::warn!("MySQL: no runtime to send KILL QUERY from"),
        }
        drop(conn.detach());
    }
}

#[derive(Clone)]
struct Killer {
    pool: Pool<MySql>,
    id: u64,
}

impl Killer {
    /// Sends `KILL QUERY` over a new connection built from the pool's options,
    /// so a full pool can't hold it up. Failures are logged: the caller closes
    /// the connection either way.
    async fn kill_query(self) {
        let options = self.pool.connect_options();
        let kill = async {
            let mut conn = MySqlConnection::connect_with(&options).await?;
            conn.execute(sqlx::raw_sql(&format!("KILL QUERY {}", self.id)))
                .await?;
            conn.close().await
        };
        let sent = match tokio::time::timeout(CANCEL_GRACE, kill).await {
            Ok(sent) => sent.map_err(|e| e.to_string()),
            Err(_) => Err(format!("no answer within {} s", CANCEL_GRACE.as_secs())),
        };
        if let Err(e) = sent {
            log::warn!("MySQL: KILL QUERY {} failed: {e}", self.id);
        }
    }
}

/// Whether a statement error is the server's "Query execution was
/// interrupted" (error 1317), which `KILL QUERY` produces. The error arrives
/// as sqlx's display text: `error returned from database: 1317 (70100): ...`.
fn is_query_interrupted(error: &str) -> bool {
    error.contains("1317 (70100)")
}
