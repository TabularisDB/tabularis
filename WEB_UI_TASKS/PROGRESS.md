# Web UI task progress

This file is the authoritative completion ledger for `scripts/run-web-ui-tasks.sh`.
Allowed statuses are `PENDING`, `IN_PROGRESS`, `BLOCKED`, and `COMPLETED`.
A completed row must include a concise summary, verification evidence, and an
ISO date. Do not use `|` inside table fields.

| Task | Status | Summary | Verification | Updated |
|---|---|---|---|---|
| WEB-000 | COMPLETED | Created feat/web-ui from current main and enabled CI for feature-branch pushes and pull requests | pnpm typecheck; pnpm lint; pnpm test --run with 230 files and 3838 tests; pnpm test:rust with 1157 tests; pnpm build; CI trigger assertion | 2026-08-21 |
| WEB-001 | COMPLETED | Added a classified frontend IPC inventory with dynamic-call and Tauri registration drift checks in CI | pnpm typecheck; pnpm lint; pnpm web:inventory with 227 commands and 366 call sites; focused Vitest with 3 tests; pnpm test:rust with 1157 tests; pnpm build; GitNexus low risk; git diff --check | 2026-08-21 |
| WEB-002 | COMPLETED | Added six accepted Web UI ADRs covering RPC, shared UI, transports, local security, file tokens, and browser adaptations | ADR structure and link checks; pnpm typecheck; pnpm lint; pnpm test --run with 232 files and 3845 tests; pnpm test:rust with 1157 tests; pnpm build; GitNexus low risk; git diff --check | 2026-08-21 |
| WEB-010 | COMPLETED | Added typed startup connection metadata and query contracts with event envelopes shared errors request IDs authorization and a tracked escape hatch | compile-time contract assertions; pnpm typecheck; pnpm lint; pnpm web:inventory; pnpm test --run with 232 files and 3845 tests; pnpm test:rust with 1157 tests; pnpm build; GitNexus low risk; git diff --check | 2026-08-21 |
| WEB-011 | COMPLETED | Added one application-root typed client provider with a Tauri invoke listen and emit transport | pnpm typecheck; pnpm lint; pnpm web:inventory; focused Vitest with 3 files and 7 tests; full Vitest with 235 files and 3852 tests; pnpm test:rust with 1157 tests; pnpm build; GitNexus low risk; git diff --check | 2026-08-21 |
| WEB-012 | COMPLETED | Added negotiated semantic platform capabilities with a root provider centralized runtime detection and a Tauri adapter | pnpm typecheck; pnpm lint; pnpm web:inventory with 227 commands and 367 call sites; focused Vitest with 4 files and 12 tests; full Vitest with 239 files and 3864 tests; pnpm test:rust with 1157 tests; pnpm build; GitNexus low risk; git diff --check | 2026-08-21 |
| WEB-013 | COMPLETED | Migrated debug connections testing tables queries cancellation and progress events through TabularisClient with no direct Tauri calls for the slice | pnpm typecheck; pnpm lint; pnpm web:inventory with 221 commands and 334 call sites; focused Vitest with 8 files and 100 tests; full Vitest with 240 files and 3866 tests; pnpm test:rust with 1157 tests; pnpm build; GitNexus expected critical slice breadth; git diff --check | 2026-08-21 |
| WEB-014 | COMPLETED | Added ESLint Tauri import restrictions and an exact temporary import and direct invoke allowlist enforced in CI | pnpm typecheck; pnpm lint; pnpm web:inventory with 221 commands and 334 call sites; pnpm web:boundaries with 154 imports and 337 invokes; focused Vitest with 2 files and 6 tests; full Vitest with 241 files and 3869 tests; pnpm test:rust with 1157 tests; pnpm build; ESLint rejection assertion; GitNexus low risk; git diff --check | 2026-08-21 |
| WEB-020 | COMPLETED | Scaffolded @tabularis/web-ui with relocated frontend configuration package scripts and root compatibility delegators | dev server smoke; pnpm typecheck; pnpm lint; pnpm web:inventory; pnpm web:boundaries; focused Vitest with 2 tests; full Vitest with 242 files and 3871 tests; package and root builds; pnpm test:rust with 1157 tests; GitNexus staged low risk; git diff --check | 2026-08-21 |
| WEB-021 | COMPLETED | Moved the single frontend source asset and test trees into packages/web-ui and wired desktop tooling to the package | dev server smoke; pnpm typecheck; pnpm lint; pnpm web:inventory; pnpm web:boundaries; focused Vitest with 3 files and 10 tests; full Vitest with 242 files and 3873 tests; package and root builds; Tauri debug build; pnpm test:rust with 1157 tests; plugin API sync; GitNexus staged low risk; git diff --check | 2026-08-21 |
| WEB-022 | COMPLETED | Centralized root-based browser routes and enabled explicit Vite SPA fallback with direct-navigation coverage | pnpm typecheck; pnpm lint; pnpm web:inventory; pnpm web:boundaries; focused Vitest with 12 tests; full Vitest with 243 files and 3885 tests; package and root builds; production preview fallback for 10 routes; pnpm test:rust with 1157 tests; Tauri debug build; GitNexus task low risk; git diff --check | 2026-08-21 |
| WEB-030 | COMPLETED | Added typed web CLI options with loopback defaults mode conflicts scoped web arguments and platform launch fallback | focused Cargo tests with 8 tests; CLI help and conflict smoke; pnpm typecheck; pnpm lint; pnpm web:inventory; pnpm web:boundaries; package and root builds; pnpm test:rust with 1165 tests; GitNexus medium task scope and expected critical branch scope; rustfmt check; git diff --check | 2026-08-21 |
| WEB-031 | COMPLETED | Extracted shared headless bootstrap with runtime path event secret state lifecycle driver and plugin boundaries | focused Cargo with 29 tests; pnpm typecheck; pnpm lint; pnpm web:inventory; pnpm web:boundaries; full Vitest with 243 files and 3885 tests; pnpm test:rust with 1168 tests; package root and Tauri debug builds; headless web smoke; GitNexus medium task scope and expected critical branch scope; git diff --check | 2026-08-21 |
| WEB-032 | COMPLETED | Added an Axum headless server with health and session endpoints packaged SPA assets browser launch and graceful runtime cleanup | Focused Cargo with 15 tests; full Vitest with 243 files and 3885 tests; pnpm test:rust with 1172 tests; typecheck; lint; inventory; boundaries; package root Tauri debug and deb builds; extracted deb health SPA and SIGTERM smoke | 2026-08-21 |
| WEB-033 | COMPLETED | Added one-time bootstrap exchange with expiring HttpOnly sessions strict origin and host checks CSRF logout body limits request IDs and redacted startup | Focused Cargo with 5 tests; full Vitest with 243 files and 3885 tests; pnpm test:rust with 1174 passed and 4 ignored; typecheck; lint; inventory; boundaries; package and root builds; Tauri debug build; headless auth and redaction smoke; GitNexus task low risk; git diff --check | 2026-08-21 |
| WEB-040 | COMPLETED | Added authenticated v1 RPC dispatch for debug connection listing and query cancellation with shared services typed payloads stable errors deadlines cancellation IDs and authorization metadata | Focused Cargo with 10 web and 3 cancellation tests; real authenticated HTTP parity fixture; pnpm typecheck; pnpm lint; full Vitest with 243 files and 3885 tests; pnpm test:rust with 1179 passed and 4 ignored; inventory; boundaries; package and root builds; Cargo debug build; GitNexus medium task scope; git diff --check | 2026-08-21 |
| WEB-041 | COMPLETED | Added authenticated session-scoped WebSocket events with authorization policies bounded queues and histories heartbeat cleanup and sequence replay | Focused web Cargo with 17 tests including real authenticated WebSocket; full Rust with 1186 passed and 4 ignored; full Vitest with 243 files and 3885 tests; typecheck; lint; inventory; boundaries; package and root builds; Cargo build; rustfmt; GitNexus medium branch scope; git diff --check | 2026-08-21 |
| WEB-042 | COMPLETED | Added authenticated browser session bootstrap typed HTTP RPC normalized transport errors WebSocket subscriptions with replay reconnection and one-time runtime selection | Focused Vitest with 4 files and 13 tests; full Vitest with 245 files and 3893 tests; pnpm test:rust with 1186 passed and 4 ignored; typecheck; lint; inventory; boundaries; package root and Cargo builds; real Chromium session UI and typed RPC smoke; GitNexus staged low risk; git diff --check | 2026-08-21 |
| WEB-043 | COMPLETED | Added reusable RPC behavior suites for a Tauri mock and live loopback web server with shared complex serialization fixtures and an explicit CI gate | pnpm test:web-contract with 6 frontend and 1 Rust test; typecheck; lint; inventory; boundaries; full Vitest with 246 files and 3899 tests; pnpm test:rust with 1187 passed and 4 ignored; package and root builds; Cargo build; focused Rust web with 18 tests; GitNexus task low risk; git diff --check | 2026-08-21 |
| WEB-050 | COMPLETED | Added typed web parity for connection CRUD groups tags drivers active state progress and session-bound icon uploads with write-only secrets | pnpm typecheck; pnpm lint; inventory with 194 commands and 302 call sites; boundaries; focused Vitest with 92 tests; full Vitest with 246 files and 3902 tests; web contract with 8 frontend tests and Rust fixture; pnpm test:rust with 1191 passed and 4 ignored; package and root builds; Cargo build; authenticated HTTP CRUD and icon test; headless smoke; rustfmt; GitNexus high task scope and expected critical branch scope; git diff --check | 2026-08-21 |
| WEB-051 | COMPLETED | Added shared SSH and K8s profile tunnel validation progress and session-scoped askpass parity with write-only secrets and local-admin authorization | pnpm typecheck; pnpm lint; inventory with 178 commands and 285 call sites; boundaries; focused Vitest with 140 tests; full Vitest with 246 files and 3903 tests; web contract with 8 frontend tests and Rust fixture; pnpm test:rust with 1197 passed and 4 ignored; package root and Cargo builds; authenticated HTTP profile CRUD test; headless health and auth smoke; targeted rustfmt; GitNexus critical expected tunnel flow scope; git diff --check | 2026-08-21 |
| WEB-052 | COMPLETED | Added shared metadata services and database-authorized RPC parity for explorer discovery snapshots and selected-schema preferences across desktop and web | pnpm typecheck; pnpm lint; inventory with 163 commands and 231 call sites; boundaries; focused Vitest with 114 tests; full Vitest with 246 files and 3905 tests; web contract with 10 frontend tests and Rust fixture; pnpm test:rust with 1200 passed and 4 ignored; package and root builds; Cargo build; authenticated SQLite HTTP metadata and preference test; targeted rustfmt; GitNexus expected critical branch scope; git diff --check | 2026-08-22 |
| WEB-053 | PENDING | — | — | — |
| WEB-054 | PENDING | — | — | — |
| WEB-055 | PENDING | — | — | — |
| WEB-060 | PENDING | — | — | — |
| WEB-061 | PENDING | — | — | — |
| WEB-062 | PENDING | — | — | — |
| WEB-063 | PENDING | — | — | — |
| WEB-070 | PENDING | — | — | — |
| WEB-071 | PENDING | — | — | — |
| WEB-072 | PENDING | — | — | — |
| WEB-073 | PENDING | — | — | — |
| WEB-080 | PENDING | — | — | — |
| WEB-081 | PENDING | — | — | — |
| WEB-082 | PENDING | — | — | — |
| WEB-083 | PENDING | — | — | — |
| WEB-084 | PENDING | — | — | — |
| WEB-090 | PENDING | — | — | — |
| WEB-091 | PENDING | — | — | — |
| WEB-092 | PENDING | — | — | — |
| WEB-093 | PENDING | — | — | — |
| WEB-094 | PENDING | — | — | — |
| WEB-095 | PENDING | — | — | — |
| WEB-100 | PENDING | — | — | — |
| WEB-101 | PENDING | — | — | — |
| WEB-102 | PENDING | — | — | — |
| WEB-103 | PENDING | — | — | — |
