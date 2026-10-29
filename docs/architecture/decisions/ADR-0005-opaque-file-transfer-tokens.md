# ADR-0005: Transfer browser files through opaque tokens

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

Desktop dialogs return local paths that the native process can read or write. A browser path is not a trustworthy or meaningful server path, especially when the browser and Tabularis server are on different machines. Passing user-supplied paths to backend commands would permit path confusion and unauthorized filesystem access.

## Decision

Browser import workflows upload bytes to a server-managed temporary area and receive an opaque file token. Commands accept that token, not a browser-provided server path. Browser export workflows generate a server-side artifact and return an opaque download token consumed through an authenticated endpoint.

Tokens are unguessable, bound to the authenticated session and intended operation, short-lived, and revocable. Upload limits, content validation, cleanup, and atomic file handling are mandatory. Download tokens are single-use where the workflow permits it. Token metadata may contain a display filename, media type, size, and expiry, but never grants arbitrary path selection.

Desktop capability adapters may continue to use native file dialogs and paths. Both adapters call the same import, export, parsing, and job services after resolving their transport-specific file handle.

Any future server-side path feature is a separate local-admin capability. It requires an explicit contract, canonicalization, allow-list or user-approved roots, and authorization checks.

## Consequences

- Browser clients cannot reinterpret a displayed filename as a backend path.
- Import and export business logic remains shared after file handles are resolved.
- Temporary storage quotas, expiry, interrupted transfer cleanup, and race conditions require tests.
- Large transfers need bounded or streaming I/O rather than buffering entire files in memory.

## Rejected alternatives

### Send browser path strings to commands

Rejected because browser paths may be fake, partial, client-local, or malicious and must never select server files.

### Expose a general server filesystem browser

Rejected because broad filesystem access is not required for parity and substantially increases privilege and traversal risk.

### Embed all files in RPC JSON

Rejected because base64 increases memory and payload size, obscures upload limits, and is unsuitable for dumps, backups, blobs, and other large artifacts.

### Duplicate import and export logic in web handlers

Rejected because transport handlers should only resolve tokens and invoke the same application services used by desktop workflows.
