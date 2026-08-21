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
| WEB-033 | PENDING | — | — | — |
| WEB-040 | PENDING | — | — | — |
| WEB-041 | PENDING | — | — | — |
| WEB-042 | PENDING | — | — | — |
| WEB-043 | PENDING | — | — | — |
| WEB-050 | PENDING | — | — | — |
| WEB-051 | PENDING | — | — | — |
| WEB-052 | PENDING | — | — | — |
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
