# Rust Rules

1. **Keep `mod.rs` focused:** In `src-tauri/src/**/mod.rs`, keep public orchestration, exports, and trait implementations. Extract pure helpers, parsers, and driver-specific utilities into dedicated sibling modules.
2. **Preserve public APIs during refactors:** When moving public functions out of `mod.rs`, re-export them from the parent module with `pub use` so existing call sites keep the same paths.
3. **Prefer pure helper modules:** Move parsing, identifier escaping, SQL string helpers, and value-conversion logic into focused modules with small, testable functions.
4. **Separate Rust tests from implementation:** When a module has non-trivial tests, place them in a sibling `tests.rs` file (or `tests/*.rs` when the module grows further) and load them with `#[cfg(test)] mod tests;`.
5. **Test extracted helpers directly:** Every extracted pure helper or parser should have unit tests covering nominal cases, edge cases, and unsupported inputs when relevant.
6. **Avoid behavioural refactors mixed with structural refactors:** When reorganizing Rust files, keep function signatures and runtime behaviour stable unless the task explicitly asks for behaviour changes.
