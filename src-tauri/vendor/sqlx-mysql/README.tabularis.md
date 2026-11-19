# SQLx MySQL 0.8.6: local patches (socket authentication, column origins)

This is the `sqlx-mysql` 0.8.6 crates.io source, retaining its MIT/Apache-2.0
licenses. The normalized published `Cargo.toml` is used without dependency changes.
The application's Cargo patch replaces only this crate; the SQLx API and other
database drivers remain on 0.8.6.

Local changes relative to the published crate:

- `protocol/text/column.rs`, `column.rs`, `connection/executor.rs`, `lib.rs`: keep
  the schema, original table, table alias and original column name that the
  server already sends in each column definition, and expose them as
  `MySqlColumn::source()` (`MySqlColumnSource`). It is `None` for expressions.
  Tabularis uses it to report where each result column comes from.
- `connection/stream.rs`: retain whether the selected transport is a Unix socket,
  including when boxing the stream.
- `connection/tls.rs`: preserve that flag when wrapping a stream in TLS.
- `connection/auth.rs`: send the NUL-terminated password during full SHA-2
  authentication on a Unix socket, just as on TLS. TCP without TLS continues
  to use RSA. The flag comes from the socket selected by `establish`, never from
  a hostname or a server claim. TLS verification and `is_tls` remain unchanged.

MySQL regards a Unix socket as secure and expects the password during full
`caching_sha2_password`/`sha256_password` authentication. Upstream 0.8.6 only
recognizes TLS here and sends an RSA key request instead, causing access denied.
See [MySQL's authentication protocol documentation](https://dev.mysql.com/doc/refman/8.4/en/caching-sha2-pluggable-authentication.html).

Regression coverage is in `tests/socket_integration.rs`: cold auth cache, wrong
password, repeated authentication, pooled query with a startup script,
disconnect/reconnect, and TCP TLS validation. Run only against disposable test
databases: the MySQL case executes `FLUSH PRIVILEGES`.

The column-origin patch only adds fields and an accessor and changes no behaviour;
it can be dropped when upstream exposes the same information.

Remove the authentication patch when the chosen upstream SQLx release recognizes Unix sockets
as secure for full SHA-2 authentication and passes that same regression suite.
Do not replace it merely with the upstream fast-auth scramble fix: cold-cache
authentication must also succeed.
