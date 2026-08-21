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
| WEB-011 | PENDING | — | — | — |
| WEB-012 | PENDING | — | — | — |
| WEB-013 | PENDING | — | — | — |
| WEB-014 | PENDING | — | — | — |
| WEB-020 | PENDING | — | — | — |
| WEB-021 | PENDING | — | — | — |
| WEB-022 | PENDING | — | — | — |
| WEB-030 | PENDING | — | — | — |
| WEB-031 | PENDING | — | — | — |
| WEB-032 | PENDING | — | — | — |
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
