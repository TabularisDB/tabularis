//! Column anonymization for file exports (#483).
//!
//! A transform layer between the row stream and the export sinks: per-column
//! rules rewrite values before they reach CSV/JSON/Markdown, so every driver
//! (built-in and plugin) is covered with no driver changes.
//!
//! Wording matters: this is *pseudonymization/masking*, not "GDPR-compliant
//! anonymization" — true anonymization is a legal assessment no tool can
//! guarantee on its own.

use std::collections::HashMap;

use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::Value;
use sha2::Sha256;

#[cfg(test)]
mod tests;

type HmacSha256 = Hmac<Sha256>;

/// Number of hex chars kept from the HMAC digest. 64 bits is plenty for
/// join stability across exported tables while keeping values compact.
const HMAC_HEX_LEN: usize = 16;

/// Per-column anonymization rule, selectable in the export dialog.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AnonymizeRule {
    /// Replace with a fixed value; `None` writes a real `NULL`.
    Fixed { value: Option<String> },
    /// Keep the first/last N chars, mask the middle. Emails are masked
    /// per-segment: `john@example.com` → `j***@***.com`.
    Partial {
        #[serde(default = "default_keep_start")]
        keep_start: usize,
        #[serde(default)]
        keep_end: usize,
    },
    /// Deterministic HMAC-SHA256 pseudonym: the same input + export key
    /// always yields the same output, so joins on anonymized keys still
    /// work across tables exported with the same key.
    Hmac,
}

fn default_keep_start() -> usize {
    1
}

/// The anonymization payload sent from the export dialog.
#[derive(Debug, Clone, Deserialize)]
pub struct AnonymizeSpec {
    /// Per-export HMAC key. Generated per dialog session; the user can reuse
    /// it across exports to keep pseudonyms stable (e.g. `user_id` joins).
    #[serde(default)]
    pub key: String,
    /// Column name → rule. Columns not listed pass through unchanged.
    #[serde(default)]
    pub rules: HashMap<String, AnonymizeRule>,
}

/// Applies an [`AnonymizeSpec`] to streamed rows. Built once per export.
pub struct RowAnonymizer {
    key: Vec<u8>,
    rules: HashMap<String, AnonymizeRule>,
}

impl RowAnonymizer {
    pub fn new(spec: AnonymizeSpec) -> Self {
        Self {
            key: spec.key.into_bytes(),
            rules: spec.rules,
        }
    }

    /// Returns true when no column has a rule (caller can skip the transform
    /// entirely and stream values through untouched).
    pub fn is_noop(&self) -> bool {
        self.rules.is_empty()
    }

    /// Transforms `values` in place according to the per-column rules.
    /// `NULL` values always stay `NULL` — anonymizing nulls would invent
    /// data the source never had.
    pub fn apply(&self, headers: &[String], values: &mut [Value]) {
        for (header, value) in headers.iter().zip(values.iter_mut()) {
            let Some(rule) = self.rules.get(header) else {
                continue;
            };
            if value.is_null() {
                continue;
            }
            *value = self.apply_rule(rule, value);
        }
    }

    fn apply_rule(&self, rule: &AnonymizeRule, value: &Value) -> Value {
        match rule {
            AnonymizeRule::Fixed { value: replacement } => match replacement {
                Some(text) => Value::String(text.clone()),
                None => Value::Null,
            },
            AnonymizeRule::Partial {
                keep_start,
                keep_end,
            } => Value::String(partial_mask(&value_to_text(value), *keep_start, *keep_end)),
            AnonymizeRule::Hmac => Value::String(self.hmac_hex(&value_to_text(value))),
        }
    }

    fn hmac_hex(&self, message: &str) -> String {
        let mut mac = HmacSha256::new_from_slice(&self.key).expect("HMAC accepts keys of any size");
        mac.update(message.as_bytes());
        let digest = mac.finalize().into_bytes();
        digest[..HMAC_HEX_LEN / 2]
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }
}

/// Renders a value as the text that would appear in the export before any
/// anonymization — strings as-is, everything else in its JSON form.
fn value_to_text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Masks a string, keeping `keep_start` leading and `keep_end` trailing
/// chars. Email-shaped values keep the shape `j***@***.com` so the result
/// still reads as an email without revealing the address.
pub fn partial_mask(text: &str, keep_start: usize, keep_end: usize) -> String {
    if text.is_empty() {
        return String::new();
    }

    if let Some(masked) = mask_email(text) {
        return masked;
    }

    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= keep_start + keep_end {
        // Too short to keep anything without leaking most of the value.
        return "***".to_string();
    }
    let prefix: String = chars[..keep_start].iter().collect();
    let suffix: String = chars[chars.len() - keep_end..].iter().collect();
    format!("{prefix}***{suffix}")
}

/// `john.doe@example.com` → `j***@***.com`. Returns `None` when the value is
/// not email-shaped (exactly one `@`, non-empty local part, dotted domain).
fn mask_email(text: &str) -> Option<String> {
    let (local, domain) = text.split_once('@')?;
    if local.is_empty() || domain.contains('@') {
        return None;
    }
    let (_, tld) = domain.rsplit_once('.')?;
    if tld.is_empty() {
        return None;
    }
    let first = local.chars().next()?;
    Some(format!("{first}***@***.{tld}"))
}
