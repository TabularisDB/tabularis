use std::borrow::Cow;
use std::fmt::{self, Debug, Formatter};

use futures_core::future::BoxFuture;
use futures_util::FutureExt;
pub(crate) use sqlx_core::connection::*;
pub(crate) use stream::{MySqlStream, Waiting};

use crate::common::StatementCache;
use crate::error::Error;
use crate::protocol::response::Status;
use crate::protocol::statement::StmtClose;
use crate::protocol::text::{Ping, Quit};
use crate::statement::MySqlStatementMetadata;
use crate::transaction::Transaction;
use crate::{MySql, MySqlConnectOptions};

mod auth;
mod establish;
mod executor;
mod stream;
mod tls;

const MAX_PACKET_SIZE: u32 = 1024;

/// A connection to a MySQL database.
pub struct MySqlConnection {
    pub(crate) inner: Box<MySqlConnectionInner>,
}

pub(crate) struct MySqlConnectionInner {
    // underlying TCP stream,
    // wrapped in a potentially TLS stream,
    // wrapped in a buffered stream
    pub(crate) stream: MySqlStream,

    // the connection id the server announced in its handshake
    handshake_connection_id: u32,

    // transaction status
    pub(crate) transaction_depth: usize,
    status_flags: Status,

    // cache by query string to the statement id and metadata
    cache_statement: StatementCache<(u32, MySqlStatementMetadata)>,

    log_settings: LogSettings,
}

impl MySqlConnection {
    /// The connection id the server announced in its handshake: what
    /// `CONNECTION_ID()` answers, read without a round trip.
    ///
    /// The handshake carries 32 bits. A server whose ids are wider (MariaDB,
    /// MySQL before 5.7) sends the low 32 bits of a larger id.
    pub fn handshake_connection_id(&self) -> u32 {
        self.inner.handshake_connection_id
    }

    /// Whether the server has hung up on this idle connection, read off the
    /// socket without waiting and without a round trip.
    ///
    /// `true` when the socket has reached its end or failed, or when bytes
    /// arrived while no statement was running (the error some servers write
    /// before they close an idle connection). `false` means nothing has
    /// arrived: a connection the network dropped silently still reads as
    /// open, and only a ping finds that out.
    pub fn server_hung_up(&mut self) -> bool {
        let stream = &mut self.inner.stream;
        // A statement left half read is not an idle connection: its answer
        // is still due, and the next use drains it.
        if !stream.waiting.is_empty() || !stream.socket.write_buffer().is_empty() {
            return false;
        }
        stream
            .socket
            .try_read(|buf| {
                Ok(if buf.is_empty() {
                    std::ops::ControlFlow::Continue(1)
                } else {
                    std::ops::ControlFlow::Break(())
                })
            })
            .now_or_never()
            .is_some()
    }

    pub(crate) fn in_transaction(&self) -> bool {
        self.inner
            .status_flags
            .intersects(Status::SERVER_STATUS_IN_TRANS)
    }
}

impl Debug for MySqlConnection {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        f.debug_struct("MySqlConnection").finish()
    }
}

impl Connection for MySqlConnection {
    type Database = MySql;

    type Options = MySqlConnectOptions;

    fn close(mut self) -> BoxFuture<'static, Result<(), Error>> {
        Box::pin(async move {
            self.inner.stream.send_packet(Quit).await?;
            self.inner.stream.shutdown().await?;

            Ok(())
        })
    }

    fn close_hard(mut self) -> BoxFuture<'static, Result<(), Error>> {
        Box::pin(async move {
            self.inner.stream.shutdown().await?;
            Ok(())
        })
    }

    fn ping(&mut self) -> BoxFuture<'_, Result<(), Error>> {
        Box::pin(async move {
            self.inner.stream.wait_until_ready().await?;
            self.inner.stream.send_packet(Ping).await?;
            self.inner.stream.recv_ok().await?;

            Ok(())
        })
    }

    #[doc(hidden)]
    fn flush(&mut self) -> BoxFuture<'_, Result<(), Error>> {
        self.inner.stream.wait_until_ready().boxed()
    }

    fn cached_statements_size(&self) -> usize {
        self.inner.cache_statement.len()
    }

    fn clear_cached_statements(&mut self) -> BoxFuture<'_, Result<(), Error>> {
        Box::pin(async move {
            while let Some((statement_id, _)) = self.inner.cache_statement.remove_lru() {
                self.inner
                    .stream
                    .send_packet(StmtClose {
                        statement: statement_id,
                    })
                    .await?;
            }

            Ok(())
        })
    }

    #[doc(hidden)]
    fn should_flush(&self) -> bool {
        !self.inner.stream.write_buffer().is_empty()
    }

    fn begin(&mut self) -> BoxFuture<'_, Result<Transaction<'_, Self::Database>, Error>>
    where
        Self: Sized,
    {
        Transaction::begin(self, None)
    }

    fn begin_with(
        &mut self,
        statement: impl Into<Cow<'static, str>>,
    ) -> BoxFuture<'_, Result<Transaction<'_, Self::Database>, Error>>
    where
        Self: Sized,
    {
        Transaction::begin(self, Some(statement.into()))
    }

    fn shrink_buffers(&mut self) {
        self.inner.stream.shrink_buffers();
    }
}
