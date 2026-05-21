/// Default number of rows between two interval progress emissions.
pub const DEFAULT_INTERVAL: u64 = 100;

/// Tracks the number of rows processed and emits progress updates at a fixed
/// interval (every `every` rows) plus one final update on `finish`.
pub struct ProgressEmitter<F: FnMut(u64)> {
    count: u64,
    every: u64,
    emit: F,
}

impl<F: FnMut(u64)> ProgressEmitter<F> {
    /// `every` is clamped to a minimum of 1 so that callers cannot accidentally
    /// disable interval emission.
    pub fn new(every: u64, emit: F) -> Self {
        Self {
            count: 0,
            every: every.max(1),
            emit,
        }
    }

    pub fn tick(&mut self) {
        self.count += 1;
        if self.count % self.every == 0 {
            (self.emit)(self.count);
        }
    }

    pub fn finish(&mut self) {
        (self.emit)(self.count);
    }

    pub fn count(&self) -> u64 {
        self.count
    }
}
