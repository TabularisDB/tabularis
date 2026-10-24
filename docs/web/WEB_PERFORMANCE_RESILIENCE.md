# Web UI performance and resilience contract

WEB-095 establishes deterministic resource limits and a focused CI gate for failure and recovery paths. Run it with:

```bash
pnpm test:web-resilience
```

## Resource bounds

- Web query pages are capped at 10,000 rows and serialized query responses at 16 MiB. Clients must paginate when either limit is reached.
- Web RPC execution is capped at 64 active requests process-wide and 16 active requests per authenticated session. Excess work fails immediately through the shared error envelope with `SERVER_BUSY` or `SESSION_BUSY`; requests are not queued without a bound.
- WebSocket sessions, connections, replay history, and per-connection queues remain bounded. Slow consumers are disconnected instead of accumulating events.
- Uploads, downloads, BLOBs, request bodies, event control messages, pending file tokens, deadlines, and cancellation identifiers retain their existing explicit limits.
- Query, export, dump, and import registrations abort their worker when the owning request is dropped. Explicit logout additionally clears all jobs and temporary state owned by that session.

## Resilience matrix

| Scenario | Expected behavior | Automated evidence |
|---|---|---|
| Large query result | Clamp row count and reject responses above 16 MiB with pagination guidance | `web_policy_caps_rows_and_rejects_oversized_payloads` |
| Slow client | Disconnect a full WebSocket consumer and retain only bounded replay history | `disconnects_slow_consumers_and_bounds_reconnect_history` |
| Multiple sessions | Isolate active connections, cancellation identifiers, queues, and per-session RPC admission | `browser_active_connections_are_isolated_by_session` and `bounds_slow_rpc_work_per_session_and_across_the_server` |
| Reconnect | Replay missed scoped events from the bounded session history | `replays_only_missed_events_for_the_same_session` and the HTTP transport reconnect test |
| Abandoned job | Abort and unregister query, export, dump, and import workers without affecting another session | query and transfer `session_cleanup` tests plus registration-drop tests |
| Plugin crash | Release pending callers promptly when the plugin process channel exits | `crashed_plugin_process_fails_pending_calls_without_hanging` |
| Tunnel failure | Return correlated progress errors and preserve configured executable diagnostics | `connection_test_failures_emit_correlated_progress` and `test_spawn_error_identifies_configured_program` |
| Graceful shutdown | Abort background jobs, close pools, stop tunnels, and shut down external drivers | `runtime::tests` and the headless server shutdown fixtures |
| Memory and CPU bounds | Reject excess concurrent RPC work and bound response, transfer, event, and session-owned state | RPC admission, query policy, event bus, and file transfer tests |
| Browser refresh during work | Re-establish event subscriptions; dropped request workers clean themselves up and session-scoped events continue after reconnect | HTTP transport refresh test and registration-drop tests |

The deterministic CI suite validates limits and lifecycle behavior rather than asserting host-specific timing or RSS values. Release profiling should still exercise representative databases and plugin binaries on target hardware.
