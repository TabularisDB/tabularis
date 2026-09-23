# Connection metadata discovery

Generic database plugins can opt in to `get_connection_metadata` to report the
capabilities and data types of each connection. Plugins that do not opt in keep
the static manifest behavior and receive no discovery requests.

The motivating example is [tabularis-jdbc](https://github.com/tabularis-jdbc/tabularis-jdbc),
discussed in [#728](https://github.com/orgs/TabularisDB/discussions/728).
Its launcher selects JDBC dependencies from a URL. The database behind that URL
can report its own schemas, identifier quoting and types through JDBC metadata.
Those values should not have to be copied into a separate manifest for every
engine, or shared between unrelated connections.

## Opting in

Add `connection_metadata: true` at the manifest root. Keep the connection form
and conservative fallback values in the manifest. An empty static `data_types`
list is valid.

For a generic JDBC plugin, the relevant fields could be:

```json
{
  "name": "jdbc",
  "version": "0.1.0",
  "description": "Generic JDBC driver",
  "executable": "tabularis-jdbc",
  "connection_metadata": true,
  "capabilities": {
    "connection_string": true,
    "connection_uri": true,
    "connection_uri_schemes": ["jdbc"],
    "connection_string_example": "jdbc:postgresql://localhost:5432/example",
    "file_based": false,
    "schemas": false,
    "views": false,
    "routines": false,
    "identifier_quote": "\"",
    "sql_dialect": "generic",
    "alter_primary_key": false,
    "alter_column": false,
    "create_foreign_keys": false,
    "manage_tables": false
  },
  "data_types": []
}
```

Older hosts ignore the opt-in and use the static values. A plugin that cannot
work with those values must set `min_runtime_version` to the first released
Tabularis version containing this feature before publishing.

Tabularium maintains its own registry schema. Its driver-kind extensions must
also allow the optional boolean `connection_metadata` field before a manifest
using it can pass strict registry validation. This host change does not modify
the deployed registry configuration.

## Request and response

Discovery is connection-scoped. It is not part of `initialize`, which happens
before connection parameters are known. The UI runs discovery after a successful
connection test and before loading database objects. Backend operations also
resolve the same metadata, including operations issued through MCP.

```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "method": "get_connection_metadata",
  "params": {
    "params": {
      "driver": "jdbc",
      "connection_id": "example-connection",
      "connection_uri": "jdbc:postgresql://localhost:5432/example",
      "database": "example",
      "username": "demo"
    }
  }
}
```

The inner object follows the existing `ConnectionParams` contract. Credentials,
tunnel parameters and plugin-specific fields are resolved through the normal
host path. Do not log this object: it can contain passwords or credential-bearing
URIs.

An abbreviated response:

```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "result": {
    "capabilities": {
      "schemas": true,
      "views": true,
      "routines": false,
      "identifier_quote": "\"",
      "sql_dialect": "postgres",
      "manage_tables": false
    },
    "data_types": [
      {
        "name": "jsonb",
        "category": "json",
        "requires_length": false,
        "requires_precision": false,
        "supports_auto_increment": false
      }
    ],
    "type_mappings": { "JSON": "jsonb" }
  }
}
```

`capabilities`, `data_types` and `type_mappings` may be omitted. Omitted fields
retain their manifest values. An explicit `false` replaces `true`, and an empty
type list or mapping replaces the static collection. Type mappings use uppercase
keys, just like the manifest. `readonly: false` cannot lift a manifest-level
read-only restriction.

The allowed capability overrides are:

- `schemas`, `views`, `materialized_views`, `routines`, `triggers`
- `user_management`, `routine_management`, `explain`
- `identifier_quote`, `sql_dialect`
- `alter_primary_key`, `alter_column`, `create_foreign_keys`, `manage_tables`
- `readonly`, `auto_increment_keyword`, `serial_type`, `inline_pk`

Connection-form fields, plugin identity and executable settings cannot be
overridden. Unknown fields, invalid field types and unknown SQL dialects are
rejected. Identifier quoting currently accepts a double quote or backtick, as
in the manifest schema. Do not forward JDBC's single-space value for unsupported
quoting as a delimiter; omit the override and disable operations that cannot be
implemented correctly with the fallback.

Report capabilities that the plugin implements. A database supporting stored
procedures does not justify `routines: true` when the plugin has no routine
handlers. Type discovery likewise does not implement DDL or CRUD operations.

## Implementing it in the JDBC bridge

The existing dispatcher can reuse `withConnection`:

```java
case "get_connection_metadata" ->
    withConnection(params, c -> ok(id, getConnectionMetadata(c)));
```

`getConnectionMetadata` can translate `c.getMetaData()` into the response:

| JDBC metadata | Tabularis value |
| --- | --- |
| `getTypeInfo().TYPE_NAME` | Native type name |
| `getTypeInfo().DATA_TYPE` | Category derived from `java.sql.Types` |
| `getTypeInfo().CREATE_PARAMS` | Input for length/precision normalization |
| `getTypeInfo().AUTO_INCREMENT` | Type-level auto-increment support |
| `getIdentifierQuoteString()` | Supported identifier delimiter |
| `supportsSchemasInDataManipulation()` and related methods | Schema behavior supported by the bridge |
| `getTableTypes()` | Available table/view categories |

See the [JDBC DatabaseMetaData contract](https://docs.oracle.com/en/java/javase/17/docs/api/java.sql/java/sql/DatabaseMetaData.html).
`PRECISION` is a maximum, not a default length. `CREATE_PARAMS` does not always
say whether a parameter is mandatory. Keep database-specific normalization where
the JDBC information is insufficient, and use `generic` for an unknown SQL
dialect.

The bridge must route each request to a worker with the correct JDBC driver.
The current prototype selects dependencies when it starts its first worker.
Discovery does not fix that lifecycle issue; the bridge needs worker routing or
driver loading that handles more than the first URL.

For opted-in connections, SQL-building requests that previously lacked
connection parameters also include the inner `params` object. This applies to
`get_create_table_sql`, `get_add_column_sql`, `get_alter_column_sql`,
`get_create_index_sql`, `routine_create_template` and `get_db_privilege_catalog`.
The bridge can therefore select the same database when generating SQL. Static
plugins receive the original request shapes.

## Lifetime and errors

The registered manifest stays immutable. Each operation receives a driver
snapshot containing that connection's effective capabilities, types and type
mappings. PostgreSQL and MySQL connections can use the same plugin process
without overwriting each other's metadata.

Successful discovery is cached per plugin process using the connection ID and
a hash of the resolved parameters. The cache retains no raw credentials or
URIs, is bounded to 128 entries, and shares concurrent discovery requests for
the same parameters. A connection test or disconnect invalidates entries for
that connection. Changed parameters produce a different key. Restarting the
plugin creates a fresh cache.

Editing a dynamic connection or explicitly reloading its plugin closes affected
connection contexts in the UI. Reconnect to load fresh metadata. Late discovery
responses cannot reopen a disconnected or invalidated context.

Only a remote JSON-RPC `-32601` response falls back to the manifest. The host logs
that the plugin declared a method it does not implement. Authentication errors,
transport failures and invalid responses surface as discovery errors and are
not cached as successful fallback results. Failed discovery can be retried.

## Validation

The automated stdio fixture exercises two engines, parameter forwarding,
concurrent discovery, static-plugin compatibility, cache invalidation and error
codes. It is a protocol fixture, not a replacement for testing the Java bridge
against real databases.

For an adapted JDBC bridge, check the following manually:

1. Open PostgreSQL and another supported engine through the same plugin.
2. Verify each connection's schema navigation, type list and SQL dialect.
3. Switch between connections and confirm the metadata follows the connection.
4. Edit a connection URL, reconnect and verify the previous metadata is gone.
5. Restart the plugin, reconnect and verify discovery runs again.
6. Confirm unsupported routine and DDL actions remain disabled.
7. Repeat the normal workflow with a plugin that has no discovery opt-in.
