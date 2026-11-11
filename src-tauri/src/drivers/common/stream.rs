use crate::drivers::driver_trait::{QueryChunk, QueryChunkSink};
use crate::models::QueryResult;
use serde_json::Value;

const FIRST_BATCH_ROWS: usize = 500;
const BATCH_ROWS: usize = 10_000;

/// Groups fetched rows into the batches a driver hands to its sink.
pub struct RowBatcher<'a> {
    sink: &'a mut QueryChunkSink<'a>,
    batch: Vec<Vec<Value>>,
    pub rows: usize,
}

impl<'a> RowBatcher<'a> {
    pub fn new(sink: &'a mut QueryChunkSink<'a>) -> Self {
        Self {
            sink,
            batch: Vec::new(),
            rows: 0,
        }
    }

    pub fn columns(&mut self, columns: Vec<String>) {
        (self.sink)(QueryChunk::Columns(columns));
    }

    pub fn push(&mut self, row: Vec<Value>) {
        self.batch.push(row);
        self.rows += 1;
        let size = if self.rows <= FIRST_BATCH_ROWS {
            FIRST_BATCH_ROWS
        } else {
            BATCH_ROWS
        };
        if self.batch.len() >= size {
            self.flush();
        }
    }

    pub fn flush(&mut self) {
        if !self.batch.is_empty() {
            (self.sink)(QueryChunk::Rows(std::mem::take(&mut self.batch)));
        }
    }

    /// Flushes the current result set; the next row starts a new one.
    pub fn end_set(&mut self) {
        self.flush();
        self.rows = 0;
    }
}

/// Gathers a driver's chunks back into one [`QueryResult`]. Each `Columns`
/// starts a result set; sets after the first go to `additional_results`.
#[derive(Default)]
pub struct CollectedRows {
    sets: Vec<(Vec<String>, Vec<Vec<Value>>)>,
}

impl CollectedRows {
    pub fn sink(&mut self) -> impl FnMut(QueryChunk) + Send + '_ {
        move |chunk| match chunk {
            QueryChunk::Columns(columns) => self.sets.push((columns, Vec::new())),
            QueryChunk::Rows(rows) => match self.sets.last_mut() {
                Some((_, set)) => set.extend(rows),
                None => self.sets.push((Vec::new(), rows)),
            },
        }
    }

    /// Puts the rows into `meta`. A paginated query fetches one row past the
    /// page, which only tells whether there is a next page.
    pub fn into_result(self, mut meta: QueryResult) -> QueryResult {
        let mut sets = self.sets.into_iter();
        let (columns, mut rows) = sets.next().unwrap_or_default();
        if let Some(pagination) = meta.pagination.as_mut() {
            let page_size = pagination.page_size as usize;
            pagination.has_more = rows.len() > page_size;
            if pagination.has_more {
                rows.truncate(page_size);
            }
            meta.truncated = pagination.has_more;
        }
        meta.columns = columns;
        meta.rows = rows;
        let additional: Vec<_> = sets
            .map(|(columns, rows)| QueryResult {
                columns,
                rows,
                affected_rows: 0,
                truncated: false,
                pagination: None,
                additional_results: None,
                server_time_ms: None,
                fetch_time_ms: None,
            })
            .collect();
        if !additional.is_empty() {
            meta.additional_results = Some(additional);
        }
        meta
    }
}
