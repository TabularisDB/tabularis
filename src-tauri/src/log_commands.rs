use crate::application::operations;

pub use operations::{GetLogsRequest, LogSettings};

/// Lets the frontend record user-relevant events (e.g. a database pruned from
/// a connection's selection) in the activity log shown in Settings → Logs.
pub fn log_frontend_event(level: String, message: String) {
    match level.as_str() {
        "error" => log::error!(target: "frontend", "{}", message),
        "warn" => log::warn!(target: "frontend", "{}", message),
        "debug" => log::debug!(target: "frontend", "{}", message),
        "trace" => log::trace!(target: "frontend", "{}", message),
        _ => log::info!(target: "frontend", "{}", message),
    }
}

pub fn test_log() -> Result<(), String> {
    log::info!("Test log message from frontend");
    log::debug!("Debug test message: {}", 42);
    log::warn!("Warning test message");
    Ok(())
}

#[cfg(test)]
#[path = "log_commands_tests.rs"]
mod tests;
