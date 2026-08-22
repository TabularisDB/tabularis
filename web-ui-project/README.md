# Web UI project process

This directory is the single tracked home for the Web UI parity project.

## Layout

- `docs/WEB_UI_PLAN.md`: architecture, milestones, parity matrix, and task loop.
- `docs/WEB_MODE_OPERATIONS.md`: Web CLI, local and remote operation, storage, limitations, plugins, troubleshooting, and upgrades.
- `docs/architecture/decisions/`: accepted Web UI ADRs.
- `docs/WEB_REMOTE_SECURITY.md`: remote threat model and reverse-proxy deployment guide.
- `docs/WEB_MANUAL_PARITY_AUDIT.md`: signed desktop and browser evidence for every feature-matrix row.
- `docs/web-ui-parity.json`: generated command and transport parity inventory.
- `tasks/`: task specifications and the authoritative `PROGRESS.md` ledger.
- `scripts/`: task runner, inventory generator, boundary checker, and allowlist.
- `tests/`: tests for the project tooling.
- `.runtime/`: ignored runner locks, state, and logs created on first execution.

All durable project files are version-controlled. Runtime logs are intentionally
excluded because they may be large or contain local diagnostic data.

## Run tasks

```bash
pnpm web:tasks
```

On startup, the runner creates any missing runtime subdirectories. With no task
IDs, it reads the tracked ledger and starts at the first `PENDING` task, then
continues in lexical order. Explicit task IDs remain supported:

```bash
pnpm web:tasks WEB-091 WEB-092
```

The runner watches the CI run for each pushed task. A failed run starts a
focused Pi repair session, amends the same task commit, pushes with
`--force-with-lease`, and watches the replacement run. The repair limit is
configured with `PI_WEB_UI_CI_REPAIR_ATTEMPTS` and defaults to three.

Telegram start and finish notifications include the global completed-task
percentage and the completed/total counts from `tasks/PROGRESS.md`.
