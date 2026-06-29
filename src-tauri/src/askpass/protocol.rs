//! Line-based wire protocol between the askpass client (this same binary,
//! re-executed by ssh as its `SSH_ASKPASS` helper) and the askpass server
//! running inside the main Tabularis process.
//!
//! Every message is a single line. Prompt and response text is escaped so a
//! message can never contain a raw newline.

/// The kind of interaction ssh is asking for, derived from the
/// `SSH_ASKPASS_PROMPT` environment variable (OpenSSH 8.4+).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptKind {
    /// Regular secret prompt (key passphrase, security-key PIN).
    Secret,
    /// Yes/no confirmation; ssh only inspects the helper's exit status.
    Confirm,
    /// Notification only (e.g. "Confirm user presence for key ..."); ssh
    /// terminates the helper once the condition is satisfied.
    Notify,
}

impl PromptKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            PromptKind::Secret => "secret",
            PromptKind::Confirm => "confirm",
            PromptKind::Notify => "notify",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "secret" => Some(PromptKind::Secret),
            "confirm" => Some(PromptKind::Confirm),
            "notify" => Some(PromptKind::Notify),
            _ => None,
        }
    }

    /// Map the value of ssh's `SSH_ASKPASS_PROMPT` env var to a kind.
    /// Unset or unknown values mean a regular secret prompt.
    pub fn from_ssh_env(value: Option<&str>) -> Self {
        match value {
            Some("confirm") => PromptKind::Confirm,
            Some("none") => PromptKind::Notify,
            _ => PromptKind::Secret,
        }
    }
}

/// Escape backslashes and line breaks so the text fits on a single line.
pub fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

/// Reverse [`escape`].
pub fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('\\') => out.push('\\'),
            Some(other) => {
                // Unknown escape: keep it verbatim.
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

/// Client → server: `ASK <kind> <escaped prompt>`.
pub fn encode_request(kind: PromptKind, prompt: &str) -> String {
    format!("ASK {} {}", kind.as_str(), escape(prompt))
}

pub fn decode_request(line: &str) -> Option<(PromptKind, String)> {
    let rest = line.strip_prefix("ASK ")?;
    let (kind, prompt) = match rest.split_once(' ') {
        Some((kind, prompt)) => (kind, prompt),
        None => (rest, ""),
    };
    Some((PromptKind::parse(kind)?, unescape(prompt)))
}

/// Server → client: `OK <escaped secret>` when the user answered,
/// `CANCEL` when the prompt was dismissed or timed out.
pub fn encode_response(response: Option<&str>) -> String {
    match response {
        Some(secret) => format!("OK {}", escape(secret)),
        None => "CANCEL".to_string(),
    }
}

/// Returns `None` for malformed lines, `Some(None)` for a cancellation and
/// `Some(Some(secret))` for an answered prompt.
pub fn decode_response(line: &str) -> Option<Option<String>> {
    if line == "CANCEL" {
        return Some(None);
    }
    if line == "OK" {
        return Some(Some(String::new()));
    }
    let secret = line.strip_prefix("OK ")?;
    Some(Some(unescape(secret)))
}
