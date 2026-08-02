//! Host-side tests for the explain import glue.
//!
//! Parser coverage lives in `packages/explain/tests/parsers/`.

#[cfg(test)]
mod tests {
    use crate::explain_import::PendingExplainFile;

    #[test]
    fn pending_explain_file_take_clears_slot() {
        let state = PendingExplainFile::default();
        state.set("/tmp/foo.json".to_string());
        assert_eq!(state.take(), Some("/tmp/foo.json".to_string()));
        assert_eq!(state.take(), None);
    }
}
