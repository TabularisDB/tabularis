//! Bounded HTTP diagnostics. Never expose raw bodies, credentials, or echoed prompts.
use serde_json::Value;

#[cfg(test)]
#[path = "api_errors_tests.rs"]
mod tests;

pub(super) async fn from_response(mut response: reqwest::Response) -> String {
    let status = response.status().as_u16();
    let mut body = Vec::new();
    while let Ok(Some(chunk)) = response.chunk().await {
        if body.len().saturating_add(chunk.len()) > 64 * 1024 {
            return super::protocol::api_error(status);
        }
        body.extend_from_slice(&chunk);
    }
    from_body(status, &body)
}

fn identifier(value: &Value) -> Option<&str> {
    value.as_str().filter(|s| {
        !s.is_empty()
            && s.len() <= 128
            && s.bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"_-.[]".contains(&c))
    })
}

pub(super) fn from_body(status: u16, body: &[u8]) -> String {
    let fallback = super::protocol::api_error(status);
    let Ok(value) = serde_json::from_slice::<Value>(body) else {
        return fallback;
    };
    let error = &value["error"];
    let code = identifier(&error["code"]).or_else(|| identifier(&error["type"]));
    let param = identifier(&error["param"]);
    // These are protocol metadata only. Do not display arbitrary server messages,
    // which can contain echoed request content or credentials from a proxy.
    let mut details = Vec::new();
    if let Some(code) = code {
        details.push(format!("code: {code}"));
    }
    if let Some(param) = param {
        details.push(format!("parameter: {param}"));
    }
    let message = error["message"]
        .as_str()
        .or_else(|| value["detail"].as_str());
    if message.is_some_and(|m| {
        m.trim()
            .trim_end_matches('.')
            .eq_ignore_ascii_case("Input must be a list")
    }) {
        details.push("input must be an array of messages".into());
    }
    if details.is_empty() {
        fallback
    } else {
        format!("{fallback} ({})", details.join("; "))
    }
}
