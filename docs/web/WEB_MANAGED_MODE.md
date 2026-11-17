# Managed mode: administrator-controlled connections

> [!WARNING]
> **Every authenticated user of an instance shares all of its managed connections.** There are no per-user or per-connection grants, and managed mode is not multi-tenant isolation. Run a separate instance for each group of users that needs different access. Network restrictions and database account privileges remain deployment responsibilities.

Managed mode lets an operator supply the connections of a Tabularis Web instance. Browser users can open them and query within the database account's privileges. They cannot create, change, delete, duplicate, import, export or test connections, cannot point a connection at another destination, and cannot read stored credentials.

```sh
tabularis web --auth password --public-url https://db.example.com \
  --allowed-origin https://db.example.com \
  --connection-mode managed-only [--managed-allow-branding] [--managed-allow-organization]
```

## Startup requirements

`--connection-mode managed-only` refuses to start unless:

- `--auth` is set. A loopback session without authentication belongs to the machine owner, who is not a managed user.
- `--allow-high-risk` is **not** set. Local-administrator authority lets a session read files, run host commands and edit settings, which defeats an administrator-supplied connection set.
- Every stored credential is at least four characters long. A shorter one would blank every string that happens to contain it, so the instance refuses to start and asks for a longer credential. If a short credential appears after startup (for example, an administrator rotates one), the same whole-string redaction applies, so nothing leaks while the instance is running.

## Instance modes

| Mode | Behaviour |
| --- | --- |
| `standalone` (default) | Unchanged behaviour. Every check passes. |
| `managed-only` | The instance protects every connection. |

Mixed mode, with protected connections next to user-created ones, is not implemented and will be reviewed separately.

## What browser sessions can and cannot do

| Allowed | Denied with `managed_connection_denied` |
| --- | --- |
| List connections, groups, tags and drivers | `save_connection`, `update_connection`, `delete_connection`, `duplicate_connection` |
| Open a connection, browse metadata, run queries within the account's privileges | `test_connection` and `list_databases` (they take caller-supplied parameters) |
| Choose selected databases and schemas for the session | Connection import (`preview_*`, `apply_*`, including the connection-import upload) |
| | `export_connections_file` and the connection and database backup commands |
| | SSH, Kubernetes and SSM profile changes and tests |
| | Appearance, icons, groups and tags, unless the matching switch below is set |

The backend rejects these before the payload is read, so a direct RPC call cannot bypass the interface. A destination override (driver, host, port, database, tunnel, proxy or plugin settings) can only arrive through `update_connection`, `test_connection` or `list_databases`, all of which are denied.

## Where connections come from

The operator prepares the connections file before starting the instance, for example by running the instance in `standalone` mode first or by editing the connections file directly. A provisioning API that lets an administrator maintain connections while the instance runs is tracked in issue #1274. Until it exists, restart the instance to apply connection changes.

## The `managed` marker

Each saved connection carries a persisted `managed` flag. A missing value reads as `false`. In `managed-only` mode the instance policy protects every connection **whether its marker is missing, false or true**; the marker exists so a later mixed mode needs no new storage.

The marker comes from the instance, never from a request or a file:

- Browser save and update payloads reject an unknown `managed` field.
- Importing a connections file (native or from another app) cannot set the marker on a new connection, and cannot change the marker of a connection it replaces.
- Updating a connection keeps its marker; duplicating one does not copy it.

Team Share is desktop-only and is not reachable from the Web server.

## Shared settings

Appearance and organization have separate switches. Both default to denied in `managed-only` mode.

| Flag | Allows users to change |
| --- | --- |
| `--managed-allow-branding` | Connection appearance: accent colour and icon (including icon uploads) |
| `--managed-allow-organization` | Connection groups and tags |

Where these are stored: groups, tags, each connection's `group_id`, `tag_ids` and `appearance` all live in the instance's single connections file, and uploaded icon images live in the instance data directory. They are therefore shared by every user of the instance. Personal, per-user organization is out of scope until there is a user identity and storage for it.

## Credentials

- Connection responses never include passwords, connection URIs, SSH passwords or passphrases, proxy credentials or plugin secrets.
- Error messages are scrubbed of every stored credential before they reach the browser.
- Pushed events are scrubbed the same way. The instance reloads its credentials every 30 seconds, so a credential an administrator rotates can appear in an event for up to that long.
- Scrubbing replaces exact values. A credential of four or more characters is replaced where it appears. A shorter one cannot be replaced in place without corrupting unrelated text, so any error message or event string that contains it is replaced whole with `[redacted]`.
- Query results are data from the database and are not scrubbed.

## Denial code and frontend

Policy denials return HTTP 403 with the stable code `managed_connection_denied` and `details.action` naming the denied action. The icon and connection-import upload endpoints answer with the same JSON error envelope.

The session endpoint reports what the session may do under `connections`: `managed`, `canCreate`, `canUpdate`, `canDelete`, `canDuplicate`, `canImport`, `canExport`, `canTest`, `canEditBranding` and `canEditOrganization`. The Web UI hides unavailable actions and explains that the connections are managed by an administrator. The backend enforces every one of them regardless.

## Not covered

Per-user grants, multi-tenant isolation, personal groups and tags, mixed mode, the provisioning API (issue #1274), network restrictions and database privileges.
