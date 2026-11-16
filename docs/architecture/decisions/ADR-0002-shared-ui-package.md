# ADR-0002: Use one shared React UI package

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

Tabularis already has a substantial React application. A separate browser frontend would duplicate components, state, translations, styles, accessibility work, tests, and business rules. The platform differences are primarily transport and host capabilities, not product design.

## Decision

Move the existing React application into one workspace package, `packages/web-ui`, after transport and platform boundaries are established. Tauri and browsers both build and run this package.

Components consume a typed `TabularisClient` and semantic platform capabilities supplied by providers. Components must not select a transport or import native APIs directly. Tauri-specific and browser-specific behavior lives in transport and capability adapters. The root package remains an orchestrator for workspace and Tauri scripts.

The move is mechanical: preserve source history, tests, translations, themes, public assets, and desktop behavior. It must not be used as an opportunity for a visual rewrite.

## Consequences

- Product fixes and features are implemented once.
- Platform behavior is visible at explicit adapter boundaries.
- Shared components must handle negotiated unsupported capabilities intentionally.
- Build and release tooling must resolve the workspace package for both targets.
- Direct native imports must be prevented outside the Tauri adapters.

## Rejected alternatives

### Create a second browser application

Rejected because it would immediately create two implementations and make long-term parity dependent on duplicated work.

### Share only a component library

Rejected because separate application shells would still duplicate contexts, hooks, routing, state transitions, command use, translations, and tests.

### Use micro-frontends per platform

Rejected because deployment independence is not a goal and the added runtime and integration complexity would weaken the single-UI constraint.

### Keep platform checks scattered through components

Rejected because checks for Tauri globals or browser globals hide unsupported behavior, are difficult to test, and couple presentation code to hosts.
