# Architecture decision records

This directory records the architectural constraints for browser-based Tabularis. These decisions apply before transport and runtime implementation begins. A later decision may supersede an accepted record, but implementation should not silently diverge from it.

| ADR | Decision | Status |
|---|---|---|
| [ADR-0001](ADR-0001-command-rpc.md) | Preserve command semantics through versioned RPC | Accepted |
| [ADR-0002](ADR-0002-shared-ui-package.md) | Use one shared React UI package | Accepted |
| [ADR-0003](ADR-0003-http-and-websocket-transport.md) | Use HTTP for commands and WebSocket for events | Accepted |
| [ADR-0004](ADR-0004-local-secure-default.md) | Make local authenticated access the secure default | Accepted |
| [ADR-0005](ADR-0005-opaque-file-transfer-tokens.md) | Transfer browser files through opaque tokens | Accepted |
| [ADR-0006](ADR-0006-browser-semantic-adaptations.md) | Adapt desktop lifecycle semantics for browsers | Accepted |

## Status meanings

- **Proposed:** ready for review but not yet binding.
- **Accepted:** binding for implementation until superseded.
- **Superseded:** replaced by a newer ADR linked from the record.
- **Rejected:** considered but not selected.

## Cross-cutting constraints

All accepted decisions preserve these invariants:

- Tauri and web transports call the same Rust application services.
- Browser clients never receive raw database credentials or authority to select arbitrary server paths.
- Desktop behavior remains backward compatible while capabilities are migrated incrementally.
- Remote access is not enabled as an accidental consequence of local web mode.
