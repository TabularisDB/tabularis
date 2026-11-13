//! Scrubs known credential values out of text and JSON bound for a browser.
//!
//! Managed mode must not leak a database password through a driver error or a
//! pushed event. The redactor holds the current secret values and removes any
//! occurrence of them.
//!
//! A long secret is replaced where it occurs. A short one cannot be replaced
//! in place without corrupting unrelated text (a one character password is in
//! almost every message), and skipping it would leak it, so any string that
//! contains one is replaced whole.

use serde_json::{Map, Value};
use std::sync::{Arc, RwLock};

pub const REDACTED: &str = "[redacted]";

/// Secrets at least this long are replaced in place; shorter ones redact the
/// whole string that contains them.
pub const MIN_SUBSTRING_SECRET_LENGTH: usize = 4;

#[derive(Default)]
struct Secrets {
    /// Longest first, so a secret that contains another one is removed whole.
    long: Vec<String>,
    short: Vec<String>,
}

#[derive(Clone, Default)]
pub struct SecretRedactor {
    secrets: Arc<RwLock<Arc<Secrets>>>,
}

impl std::fmt::Debug for SecretRedactor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SecretRedactor").finish_non_exhaustive()
    }
}

/// Whether a stored credential is too short to be replaced in place.
pub fn is_short_secret(value: &str) -> bool {
    value.len() < MIN_SUBSTRING_SECRET_LENGTH
}

impl SecretRedactor {
    pub fn new(values: impl IntoIterator<Item = String>) -> Self {
        let redactor = Self::default();
        redactor.replace(values);
        redactor
    }

    /// Replace the known secrets. Empty and whitespace-only values carry no
    /// information a reader could recover, so they are not tracked.
    pub fn replace(&self, values: impl IntoIterator<Item = String>) {
        let mut secrets = Secrets::default();
        for value in values {
            if value.trim().is_empty() {
                continue;
            }
            if is_short_secret(&value) {
                secrets.short.push(value);
            } else {
                secrets.long.push(value);
            }
        }
        secrets
            .long
            .sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
        secrets.long.dedup();
        secrets.short.sort();
        secrets.short.dedup();
        *self.secrets.write().unwrap_or_else(|e| e.into_inner()) = Arc::new(secrets);
    }

    pub fn is_empty(&self) -> bool {
        let secrets = self.snapshot();
        secrets.long.is_empty() && secrets.short.is_empty()
    }

    fn snapshot(&self) -> Arc<Secrets> {
        self.secrets
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn redact(&self, text: &str) -> String {
        self.redact_with(&self.snapshot(), text)
    }

    fn redact_with(&self, secrets: &Secrets, text: &str) -> String {
        if secrets
            .short
            .iter()
            .any(|secret| text.contains(secret.as_str()))
        {
            return REDACTED.to_string();
        }
        let mut redacted = text.to_string();
        for secret in &secrets.long {
            if redacted.contains(secret.as_str()) {
                redacted = redacted.replace(secret.as_str(), REDACTED);
            }
        }
        redacted
    }

    /// Redact every string, including object keys, inside a JSON value.
    /// Numbers, booleans and nulls are not text a credential travels in.
    pub fn redact_value(&self, value: &mut Value) {
        let secrets = self.snapshot();
        if secrets.long.is_empty() && secrets.short.is_empty() {
            return;
        }
        self.redact_value_with(&secrets, value);
    }

    fn redact_value_with(&self, secrets: &Secrets, value: &mut Value) {
        match value {
            Value::String(text) => *text = self.redact_with(secrets, text),
            Value::Array(items) => items
                .iter_mut()
                .for_each(|item| self.redact_value_with(secrets, item)),
            Value::Object(map) => {
                let entries = std::mem::take(map);
                let mut redacted = Map::with_capacity(entries.len());
                for (key, mut item) in entries {
                    self.redact_value_with(secrets, &mut item);
                    let mut key = self.redact_with(secrets, &key);
                    // Two keys can redact to the same text; keep both values.
                    while redacted.contains_key(&key) {
                        key.push('_');
                    }
                    redacted.insert(key, item);
                }
                *map = redacted;
            }
            Value::Null | Value::Bool(_) | Value::Number(_) => {}
        }
    }
}

#[cfg(test)]
mod tests;
