//! Scrubs known credential values out of text and JSON bound for a browser.
//!
//! Managed mode must not leak a database password through a driver error or a
//! pushed event. The redactor holds the current secret values and replaces any
//! occurrence with a fixed marker.

use serde_json::Value;
use std::sync::{Arc, RwLock};

pub const REDACTED: &str = "[redacted]";

/// Values shorter than this are not scrubbed: replacing a one or two character
/// password would corrupt every message that happens to contain it.
pub const MIN_SECRET_LENGTH: usize = 4;

#[derive(Clone, Default)]
pub struct SecretRedactor {
    secrets: Arc<RwLock<Arc<[String]>>>,
}

impl std::fmt::Debug for SecretRedactor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SecretRedactor").finish_non_exhaustive()
    }
}

impl SecretRedactor {
    pub fn new(values: impl IntoIterator<Item = String>) -> Self {
        let redactor = Self::default();
        redactor.replace(values);
        redactor
    }

    /// Replace the known secrets. Longest values go first so a secret that
    /// contains another one is removed whole.
    pub fn replace(&self, values: impl IntoIterator<Item = String>) {
        let mut values: Vec<String> = values
            .into_iter()
            .filter(|value| value.len() >= MIN_SECRET_LENGTH)
            .collect();
        values.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
        values.dedup();
        *self.secrets.write().unwrap_or_else(|e| e.into_inner()) = values.into();
    }

    pub fn is_empty(&self) -> bool {
        self.snapshot().is_empty()
    }

    fn snapshot(&self) -> Arc<[String]> {
        self.secrets
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn redact(&self, text: &str) -> String {
        let secrets = self.snapshot();
        let mut redacted = text.to_string();
        for secret in secrets.iter() {
            if redacted.contains(secret.as_str()) {
                redacted = redacted.replace(secret.as_str(), REDACTED);
            }
        }
        redacted
    }

    /// Redact every string, including object keys, inside a JSON value.
    pub fn redact_value(&self, value: &mut Value) {
        if self.is_empty() {
            return;
        }
        match value {
            Value::String(text) => *text = self.redact(text),
            Value::Array(items) => items.iter_mut().for_each(|item| self.redact_value(item)),
            Value::Object(map) => {
                let entries = std::mem::take(map);
                for (key, mut item) in entries {
                    self.redact_value(&mut item);
                    map.insert(self.redact(&key), item);
                }
            }
            Value::Null | Value::Bool(_) | Value::Number(_) => {}
        }
    }
}

#[cfg(test)]
mod tests;
