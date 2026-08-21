# ADR-0003: Use HTTP for commands and WebSocket for events

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

Browser clients need request-response operations as well as asynchronous notifications, progress, cancellation coordination, prompts, and job state. Tauri currently provides invocation and event primitives, but browsers need standard network transports with equivalent observable behavior.

## Decision

Use authenticated HTTP for request-response operations and one authenticated WebSocket event channel per browser session for server-originated events.

HTTP carries versioned RPC, session negotiation, health, upload, download, plugin asset, and static asset requests. The WebSocket carries typed event envelopes with event name, payload, request or correlation ID where applicable, and ordering information where a workflow requires it.

The application publishes events through a runtime event abstraction. Tauri and WebSocket adapters consume that abstraction; application services do not depend on either host. Implement bounded per-session queues, disconnect handling, subscription cleanup, and an explicit overflow policy before event-heavy features migrate.

The Rust HTTP framework is deliberately not selected by this ADR. It must support the security model, graceful shutdown, test servers, streaming, WebSockets, and shared runtime state without forcing business logic into handlers.

## Consequences

- Browsers use widely supported transports and ordinary JSON diagnostics.
- Commands and events remain independently testable through a shared typed contract.
- Reconnection, missed-event behavior, backpressure, and session ownership must be defined per workflow.
- Large result sets must use limits, pagination, or purpose-built streaming rather than unbounded event messages.

## Rejected alternatives

### HTTP polling for all events

Rejected because polling adds latency and repeated load for progress, prompts, cancellation, and task updates.

### WebSocket for both commands and events

Rejected because request-response calls gain unnecessary correlation, retry, timeout, and reconnect complexity. HTTP already provides the required semantics.

### Server-Sent Events

Rejected as the sole event transport because workflows such as askpass and approvals require session-aware bidirectional coordination. SSE may be reconsidered only through a superseding decision.

### Framework-specific application events

Rejected because coupling services to Tauri or a web framework would prevent one headless runtime and one set of business rules.
