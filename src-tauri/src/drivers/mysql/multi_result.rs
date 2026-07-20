//! Accumulates the result sets streamed back by a single MySQL statement.
//!
//! A statement is usually one result set, but a `CALL` to a stored procedure
//! may return several (one per `SELECT` in its body). `sqlx`'s `fetch_many`
//! surfaces them as a flat stream of rows interleaved with per-result-set
//! terminators; this collector folds that stream back into discrete sets.

/// One materialized result set: column names plus JSON-encoded rows.
#[derive(Debug, Default)]
pub struct ResultSetData {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub truncated: bool,
}

/// Folds a `fetch_many`-style event stream (rows + result-set terminators)
/// into a list of [`ResultSetData`], applying an optional per-set row cap.
///
/// Result sets that produced no rows are dropped: without rows `sqlx` exposes
/// no column metadata, and the trailing `OK` packet of a `CALL` arrives as an
/// empty set too, so an empty set is indistinguishable from "no result set".
/// This mirrors the pre-existing single-set behaviour where a rowless query
/// yielded empty `columns` / `rows`.
pub struct ResultSetCollector {
    limit: Option<u32>,
    done: Vec<ResultSetData>,
    current: ResultSetData,
}

impl ResultSetCollector {
    pub fn new(limit: Option<u32>) -> Self {
        Self {
            limit,
            done: Vec::new(),
            current: ResultSetData::default(),
        }
    }

    /// True until the first row of the current result set has provided
    /// column metadata.
    pub fn needs_columns(&self) -> bool {
        self.current.columns.is_empty()
    }

    pub fn set_columns(&mut self, columns: Vec<String>) {
        self.current.columns = columns;
    }

    /// True when the current result set already holds `limit` rows. Callers
    /// should still consume (and discard) the remaining rows of the set so
    /// that any following result sets are reached.
    pub fn at_limit(&self) -> bool {
        matches!(self.limit, Some(l) if self.current.rows.len() >= l as usize)
    }

    /// Appends a row to the current result set, or marks the set as
    /// truncated when the row cap has been reached.
    pub fn push_row(&mut self, row: Vec<serde_json::Value>) {
        if self.at_limit() {
            self.current.truncated = true;
        } else {
            self.current.rows.push(row);
        }
    }

    /// Records that a row beyond the cap was consumed from the wire without
    /// being decoded, marking the current result set as truncated.
    pub fn note_overflow_row(&mut self) {
        self.current.truncated = true;
    }

    /// Closes the current result set (a `fetch_many` `Left` terminator).
    pub fn end_result_set(&mut self) {
        if !self.current.rows.is_empty() {
            self.done.push(std::mem::take(&mut self.current));
        } else {
            self.current = ResultSetData::default();
        }
    }

    /// Returns all collected result sets, closing any still-open one.
    pub fn finish(mut self) -> Vec<ResultSetData> {
        self.end_result_set();
        self.done
    }
}
