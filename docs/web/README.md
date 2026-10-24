# Web mode documentation

Guides for running Tabularis in a browser with `tabularis web`.

- [WEB_MODE_OPERATIONS.md](WEB_MODE_OPERATIONS.md): Web CLI, local and remote operation, storage, limitations, plugins, troubleshooting, and upgrades.
- [WEB_REMOTE_SECURITY.md](WEB_REMOTE_SECURITY.md): remote threat model and reverse-proxy deployment guide.
- [WEB_MODE_CONTAINERS.md](WEB_MODE_CONTAINERS.md): Docker images, Docker Compose, Helm chart, and the encrypted container secret store.
- [WEB_MODE_UPGRADES.md](WEB_MODE_UPGRADES.md): upgrading a Web mode deployment.
- [WEB_PERFORMANCE_RESILIENCE.md](WEB_PERFORMANCE_RESILIENCE.md): limits, admission control, and resilience checks.
- [WEB_E2E_MATRIX.md](WEB_E2E_MATRIX.md): the real-database browser test matrix under `e2e/web/`.
- [WEB_MANUAL_PARITY_AUDIT.md](WEB_MANUAL_PARITY_AUDIT.md): signed desktop and browser evidence for every feature-matrix row.
- [WEB_UI_PLAN.md](WEB_UI_PLAN.md): architecture, parity matrix, and delivery history of the Web UI project.
- [web-ui-parity.json](web-ui-parity.json): generated command and transport parity inventory (`pnpm web:inventory:write`).

Architecture decisions for the Web UI are recorded in [../architecture/decisions](../architecture/decisions/README.md).

Tooling lives in `scripts/web/` (inventory generator, boundary checker, packaging verification, resilience runner) and its tests in `tests/web/`.
