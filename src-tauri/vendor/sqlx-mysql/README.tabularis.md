# SQLx MySQL 0.8.6: local patches

This is the `sqlx-mysql` 0.8.6 crates.io source, retaining its MIT/Apache-2.0
licenses. The normalized published `Cargo.toml` is used without dependency changes.
The application's Cargo patch replaces only this crate; the SQLx API and other
database drivers remain on 0.8.6.

Local changes relative to the published crate:

- `connection/stream.rs`: retain whether the selected transport is a Unix socket,
  including when boxing the stream.
- `connection/tls.rs`: preserve that flag when wrapping a stream in TLS.
- `connection/auth.rs`: send the NUL-terminated password during full SHA-2
  authentication on a Unix socket, just as on TLS. TCP without TLS continues
  to use RSA. The flag comes from the socket selected by `establish`, never from
  a hostname or a server claim. TLS verification and `is_tls` remain unchanged.
- `connection/auth.rs`: hash the stored digest before the nonce in the
  `caching_sha2_password` scramble, and read the OK packet that follows a fast
  authentication. See [Fast authentication](#fast-authentication).
- `connection/establish.rs`, `connection/mod.rs`,
  `protocol/connect/handshake.rs`: keep the connection id from the handshake and
  expose it as `MySqlConnection::handshake_connection_id`. See
  [Round trips](#round-trips).
- `connection/mod.rs`: add `MySqlConnection::server_hung_up`. See
  [Round trips](#round-trips).

## Local socket authentication

MySQL regards a Unix socket as secure and expects the password during full
`caching_sha2_password`/`sha256_password` authentication. Upstream 0.8.6 only
recognizes TLS here and sends an RSA key request instead, causing access denied.
See [MySQL's authentication protocol documentation](https://dev.mysql.com/doc/refman/8.4/en/caching-sha2-pluggable-authentication.html).

Regression coverage is in `tests/socket_integration.rs`: cold auth cache, wrong
password, repeated authentication, pooled query with a startup script,
disconnect/reconnect, and TCP TLS validation. Run only against disposable test
databases: the MySQL case executes `FLUSH PRIVILEGES`.

Remove this patch when the chosen upstream SQLx release recognizes Unix sockets
as secure for full SHA-2 authentication and passes that same regression suite.
Do not replace it merely with the upstream fast-auth scramble fix: cold-cache
authentication must also succeed.

## Fast authentication

Upstream 0.8.6 computes the `caching_sha2_password` scramble as
`SHA256(nonce, SHA256(SHA256(password)))`. MySQL expects
`SHA256(SHA256(SHA256(password)), nonce)`, so the server never recognizes the
scramble and asks for full authentication on every connection: two more round
trips each time (the public key request, then the encrypted password). With the
order fixed, the server answers a cached account with fast authentication.

Fast authentication is answered in two packets: `0x01 0x03`, then OK. Upstream
treats the first as the end of the handshake and leaves the OK unread, which
never showed while the scramble was wrong. Left unread, the OK is taken for the
answer to the first statement and every later answer is read one packet late.
The patch reads the OK as the next packet of the handshake.

The server falls back to full authentication when its cache is cold
(`FLUSH PRIVILEGES`, a restart), which the socket patch above still covers.

Remove this patch when the chosen upstream SQLx release carries both halves.

## Round trips

Two additions let the driver skip a round trip in front of every statement.
Neither changes what upstream code does.

- `handshake_connection_id` returns what `CONNECTION_ID()` answers, read from
  the handshake instead of asked for. The handshake has 32 bits for it: MariaDB,
  and MySQL before 5.7, count in 64, so `drivers/mysql/cancel.rs` resolves the
  full id from the process list before it sends `KILL QUERY`.
- `server_hung_up` reads the socket once without waiting. It reports a
  connection the server closed, or one it wrote to while no statement was
  running. The pool asks it in place of a ping (`pool_manager.rs`,
  `mysql_connection_usable`). It cannot see a connection the network dropped
  silently, which is why an idle connection is still pinged.

Drop these when upstream exposes the connection id and a liveness check that
costs no round trip, or keep them: they are additive.

