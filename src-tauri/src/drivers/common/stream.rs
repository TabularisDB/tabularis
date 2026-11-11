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
}

/// Gathers a driver's chunks back into one [`QueryResult`].
#[derive(Default)]
pub struct CollectedRows {
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
}

impl CollectedRows {
    pub fn sink(&mut self) -> impl FnMut(QueryChunk) + Send + '_ {
        move |chunk| match chunk {
            QueryChunk::Columns(columns) => self.columns = columns,
            QueryChunk::Rows(rows) => self.rows.extend(rows),
        }
    }

    /// Puts the rows into `meta`. A paginated query fetches one row past the
    /// page, which only tells whether there is a next page.
    pub fn into_result(self, mut meta: QueryResult) -> QueryResult {
        let mut rows = self.rows;
        if let Some(pagination) = meta.pagination.as_mut() {
            let page_size = pagination.page_size as usize;
            pagination.has_more = rows.len() > page_size;
            if pagination.has_more {
                rows.truncate(page_size);
            }
            meta.truncated = pagination.has_more;
        }
        meta.columns = self.columns;
        meta.rows = rows;
        meta
    }
}
