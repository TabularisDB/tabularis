# ADR-0006: Adapt desktop lifecycle semantics for browsers

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

Some desktop capabilities have no identical browser primitive. Secondary native windows, window titles, attention requests, deep links, application restart, and the Tauri updater are host lifecycle concerns rather than database business logic. Pretending these APIs exist in a browser would produce brittle checks and incomplete workflows.

## Decision

Represent host operations as semantic platform capabilities and negotiate their availability at session startup. Shared components request outcomes such as opening a route, downloading a file, notifying the user, opening an external URL, requesting attention, or restarting the application. Platform adapters decide how to provide or reject each capability.

Browser adaptations are:

- secondary windows become routes or browser tabs keyed by a session or result identifier;
- native window title and chrome use browser title, routing, and browser-native controls;
- attention and notifications use permitted browser APIs with in-app fallback;
- deep links become browser URLs or an explicit installation route;
- restart means reconnecting or reloading only when the server reports that action as supported;
- desktop keeps the Tauri updater, while web reports server version and administrator upgrade guidance.

Unsupported capabilities are explicit typed results and capability flags. Components must not infer the host from globals or fail because a native plugin is absent. Adapted workflows preserve the user outcome and shared business state, not native window mechanics.

## Consequences

- Desktop-only lifecycle behavior is documented rather than counted as missing parity.
- Shared components remain host-independent and testable with capability fakes.
- Browser permission denial and popup blocking need intentional fallbacks.
- Routes and event ownership must prevent stale secondary views from observing another session.
- Updating a web deployment remains an administrator operation, not a browser-side replacement for the desktop updater.

## Rejected alternatives

### Reproduce native windows exactly in the browser

Rejected because browser tabs and routes have different ownership and security semantics; visual imitation does not provide native lifecycle control.

### Remove desktop-only features from the shared UI

Rejected because desktop behavior must remain compatible and capability adapters allow both hosts to share presentation code.

### Scatter host detection through components

Rejected because checks for Tauri or browser globals are untyped, difficult to test, and make unsupported states implicit.

### Let the browser update server binaries

Rejected because a browser session must not gain package-management authority. Web mode provides version information and deployment-specific guidance instead.
