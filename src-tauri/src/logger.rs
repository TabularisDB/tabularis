use log::{Log, Metadata, Record};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

#[cfg(test)]
pub(crate) mod test_env;

#[cfg(test)]
mod tests;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
    pub target: Option<String>,
}

#[derive(Debug, Clone)]
pub struct LogBuffer {
    entries: VecDeque<LogEntry>,
    max_size: usize,
    enabled: bool,
}

impl LogBuffer {
    pub fn new(max_size: usize) -> Self {
        Self {
            entries: VecDeque::with_capacity(max_size),
            max_size,
            enabled: true,
        }
    }

    pub fn push(&mut self, entry: LogEntry) {
        if !self.enabled {
            return;
        }

        if self.entries.len() >= self.max_size {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
    }

    pub fn get_entries(&self, limit: Option<usize>, level_filter: Option<String>) -> Vec<LogEntry> {
        let entries: Vec<LogEntry> = self.entries.iter().cloned().collect();

        let filtered = if let Some(filter) = level_filter {
            entries
                .into_iter()
                .filter(|e| e.level.to_lowercase() == filter.to_lowercase())
                .collect()
        } else {
            entries
        };

        if let Some(limit) = limit {
            filtered.into_iter().rev().take(limit).rev().collect()
        } else {
            filtered
        }
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    pub fn set_max_size(&mut self, size: usize) {
        self.max_size = size;
        // Trim if needed
        while self.entries.len() > self.max_size {
            self.entries.pop_front();
        }
    }

    pub fn get_max_size(&self) -> usize {
        self.max_size
    }
}

pub type SharedLogBuffer = Arc<Mutex<LogBuffer>>;

pub fn create_log_buffer(max_size: usize) -> SharedLogBuffer {
    Arc::new(Mutex::new(LogBuffer::new(max_size)))
}

/// Resolve the log level from the `RUST_LOG` environment variable.
///
/// `Args::log_level` already turns `--debug` into `Debug`; this covers the case
/// where neither `--debug` nor an explicit level was given, letting a user
/// raise or lower verbosity without the flag. An unset or unparseable
/// `RUST_LOG` falls back to `Info` rather than failing to boot.
///
/// The `log` crate has no per-target filter machinery of its own, so only the
/// level part of a directive can be honoured, and a comma-separated list
/// collapses onto the most verbose level it names. `sqlx=debug` therefore
/// yields `Debug`, and `warn,sqlx=debug` also yields `Debug` — the closest safe
/// approximation of `env_logger`'s behaviour for a single-stream logger.
///
/// Note that `Debug` and `Trace` are only safe to reach here because
/// `log_commands` releases the buffer lock before logging (see the comment in
/// `read_logs`); the capturing logger locks the same mutex.
pub fn resolve_log_level_from_env() -> log::LevelFilter {
    match std::env::var("RUST_LOG") {
        Ok(value) => parse_rust_log_level(&value).unwrap_or(log::LevelFilter::Info),
        Err(_) => log::LevelFilter::Info,
    }
}

/// Map a `RUST_LOG` value onto a single [`log::LevelFilter`], if any directive
/// in it names a level.
fn parse_rust_log_level(value: &str) -> Option<log::LevelFilter> {
    value
        .split(',')
        .filter_map(|directive| {
            directive
                .rsplit('=')
                .next()
                .map(str::trim)
                .and_then(level_from_str)
        })
        .max_by_key(verbosity)
}

fn level_from_str(value: &str) -> Option<log::LevelFilter> {
    match value.to_ascii_lowercase().as_str() {
        "off" => Some(log::LevelFilter::Off),
        "error" => Some(log::LevelFilter::Error),
        "warn" => Some(log::LevelFilter::Warn),
        "info" => Some(log::LevelFilter::Info),
        "debug" => Some(log::LevelFilter::Debug),
        "trace" => Some(log::LevelFilter::Trace),
        _ => None,
    }
}

/// Ordering key so `max_by_key` picks the most verbose level.
fn verbosity(level: &log::LevelFilter) -> u8 {
    match level {
        log::LevelFilter::Off => 0,
        log::LevelFilter::Error => 1,
        log::LevelFilter::Warn => 2,
        log::LevelFilter::Info => 3,
        log::LevelFilter::Debug => 4,
        log::LevelFilter::Trace => 5,
    }
}

pub fn format_timestamp() -> String {
    let now = SystemTime::now();
    let datetime = chrono::DateTime::<chrono::Local>::from(now);
    datetime.format("%Y-%m-%d %H:%M:%S%.3f").to_string()
}

/// Custom logger that captures logs to a buffer and outputs to stdout
pub struct CapturingLogger {
    buffer: SharedLogBuffer,
    level: log::LevelFilter,
}

impl CapturingLogger {
    pub fn new(buffer: SharedLogBuffer, level: log::LevelFilter) -> Self {
        Self { buffer, level }
    }
}

impl Log for CapturingLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= self.level
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }

        // Format the message
        let message = format!("{}", record.args());
        let timestamp = format_timestamp();
        let level = record.level().to_string();
        let target = record.target().to_string();

        // Print to stderr (visible in terminal)
        eprintln!("[LOG] [{}] [{}] {} - {}", timestamp, level, target, message);

        // Also capture to buffer
        if let Ok(mut buf) = self.buffer.lock() {
            buf.push(LogEntry {
                timestamp,
                level,
                message,
                target: Some(target),
            });
        }
    }

    fn flush(&self) {}
}

/// Initialize the capturing logger
pub fn init_logger(buffer: SharedLogBuffer, level: log::LevelFilter) {
    let logger = CapturingLogger::new(buffer, level);

    // Try to set the logger
    match log::set_boxed_logger(Box::new(logger)) {
        Ok(_) => {
            log::set_max_level(level);
            eprintln!(
                "[Logger] Capturing logger initialized successfully with level: {:?}",
                level
            );
        }
        Err(e) => {
            eprintln!(
                "[Logger] Failed to initialize logger (may already be set): {}",
                e
            );
            // Still try to set the max level
            log::set_max_level(level);
        }
    }
}
