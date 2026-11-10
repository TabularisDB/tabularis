# Managed mode: administrator-controlled connections

> [!WARNING]
> **Every authenticated user of an instance shares all of its managed connections.** There are no per-user or per-connection grants, and managed mode is not multi-tenant isolation. Run a separate instance for each group of users that needs different access. Network restrictions and database account privileges remain deployment responsibilities.

Managed mode lets an operator supply the connections of a Tabularis Web instance. Browser users can open them and query within the database account's privileges, but cannot change where a connection points or create, delete or replace connections.

## Status

This is being delivered in steps (issue #1273). The current step adds the policy type, the instance configuration, the persisted marker and their tests. **Enforcement is not active yet**: backend denials, credential redaction, session capabilities and the frontend land in later steps, and so does the provisioning API (issue #1274). Do not rely on `managed-only` as a security boundary until then.

## Instance modes

| Mode | Behaviour |
| --- | --- |
| `standalone` (default) | Unchanged behaviour. Every check passes. |
| `managed-only` | The instance protects every connection. |

```sh
tabularis web --connection-mode managed-only [--managed-allow-branding] [--managed-allow-organization]
```

Mixed mode, with protected connections next to user-created ones, is not implemented and will be reviewed separately.

## The `managed` marker

Each saved connection carries a persisted `managed` flag. A missing value reads as `false`. In `managed-only` mode the instance policy protects every connection **whether its marker is missing, false or true**; the marker exists so a later mixed mode needs no new storage.

## Shared settings

Appearance and organization have separate switches. Both default to denied in `managed-only` mode.

| Flag | Allows users to change |
| --- | --- |
| `--managed-allow-branding` | Connection appearance: accent colour and icon |
| `--managed-allow-organization` | Connection groups and tags |

Where these are stored today: groups, tags, each connection's `group_id`, `tag_ids` and `appearance` all live in the instance's single connections file, and uploaded icon images live in the instance data directory. They are therefore shared by every user of the instance. Personal, per-user organization is out of scope until there is a user identity and storage for it.

## Denial code

Policy denials carry the stable code `managed_connection_denied`.
