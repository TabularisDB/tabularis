//! Bounded JSON templates and selectors, with no scripting or expression engine.
use super::{AssistantContract, JsonFilter, ResponseRecipe};
use serde_json::Value;

pub fn validate(contract: &AssistantContract) -> Result<(), String> {
    if contract.generate.requests.is_empty()
        || contract.generate.requests.len() > 4
        || contract.models.sources.len() > 8
    {
        return Err("Invalid AI assistant request count".into());
    }
    reqwest::header::HeaderName::from_bytes(contract.api_key_header.as_bytes())
        .map_err(|_| "Invalid API key header")?;
    reqwest::header::HeaderValue::from_str(&contract.api_key_prefix)
        .map_err(|_| "Invalid API key prefix")?;
    for request in contract
        .generate
        .requests
        .iter()
        .chain(contract.models.sources.iter().map(|source| &source.request))
    {
        if request.url.len() > 2048
            || request.headers.len() > 16
            || (!request.append_path.is_empty() && !request.append_path.starts_with('/'))
        {
            return Err("Invalid AI assistant HTTP recipe".into());
        }
        for (key, value) in &request.headers {
            reqwest::header::HeaderName::from_bytes(key.as_bytes())
                .map_err(|_| "Invalid AI assistant header")?;
            reqwest::header::HeaderValue::from_str(value)
                .map_err(|_| "Invalid AI assistant header value")?;
            if [
                "authorization",
                "proxy-authorization",
                "host",
                "cookie",
                "content-length",
            ]
            .contains(&key.to_lowercase().as_str())
            {
                return Err(
                    "AI assistant headers must not override authentication or transport".into(),
                );
            }
        }
    }
    Ok(())
}

/// Exact variable references preserve the JSON type and cannot inject syntax.
pub fn render(value: &Value, variables: &Value) -> Result<Value, String> {
    match value {
        Value::String(text) if text.starts_with("{{") && text.ends_with("}}") => {
            variable(&text[2..text.len() - 2], variables).cloned()
        }
        Value::Array(items) => items.iter().map(|item| render(item, variables)).collect(),
        Value::Object(object) => object
            .iter()
            .map(|(key, value)| Ok((key.clone(), render(value, variables)?)))
            .collect(),
        _ => Ok(value.clone()),
    }
}

fn variable<'a>(name: &str, variables: &'a Value) -> Result<&'a Value, String> {
    let mut parts = name.split('.');
    let root = parts.next().unwrap_or("");
    if !["model", "prompt", "system_prompt", "settings"].contains(&root) {
        return Err("Unsupported AI assistant template variable".into());
    }
    let mut value = variables
        .get(root)
        .ok_or("Missing AI assistant template variable")?;
    for part in parts {
        value = value.get(part).ok_or("Missing AI assistant setting")?;
    }
    Ok(value)
}

pub fn request_url(template: &str, append: &str, variables: &Value) -> Result<url::Url, String> {
    let mut rest = template;
    let mut output = String::new();
    while let Some((prefix, tail)) = rest.split_once("{{") {
        output.push_str(prefix);
        let (name, tail) = tail
            .split_once("}}")
            .ok_or("Invalid AI assistant URL template")?;
        if !name.starts_with("settings.") {
            return Err("Only user settings can be interpolated into AI assistant URLs".into());
        }
        let value = variable(name, variables)?;
        let text = value
            .as_str()
            .map(str::to_owned)
            .or_else(|| value.as_u64().map(|number| number.to_string()))
            .ok_or("Invalid AI assistant URL setting")?;
        output.push_str(text.trim_end_matches('/'));
        rest = tail;
    }
    output.push_str(rest);
    if !append.is_empty() && !output.trim_end_matches('/').ends_with(append) {
        output = format!("{}{append}", output.trim_end_matches('/'));
    }
    let url = url::Url::parse(&output).map_err(|_| "Invalid AI assistant endpoint URL")?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "AI assistant endpoints must be HTTP(S) URLs without credentials or fragments".into(),
        );
    }
    Ok(url)
}

pub fn matches(value: &Value, filter: &JsonFilter) -> bool {
    let Some(field) = value.pointer(&filter.path) else {
        return filter.missing_matches;
    };
    filter
        .equals
        .as_ref()
        .is_none_or(|expected| field == expected)
        && filter.contains.as_ref().is_none_or(|expected| {
            field
                .as_array()
                .is_some_and(|items| items.contains(expected))
        })
        && filter
            .starts_with
            .as_ref()
            .is_none_or(|prefix| field.as_str().is_some_and(|text| text.starts_with(prefix)))
        && (filter.prefixes.is_empty()
            || field.as_str().is_some_and(|text| {
                filter
                    .prefixes
                    .iter()
                    .any(|prefix| text.starts_with(prefix))
            }))
}

pub fn response_text(value: &Value, response: &ResponseRecipe) -> Result<String, String> {
    let mut selected = value
        .pointer(&response.path)
        .ok_or("AI assistant response path is missing")?;
    if let Some(filter) = &response.select {
        selected = selected
            .as_array()
            .and_then(|items| items.iter().find(|item| matches(item, filter)))
            .ok_or("AI assistant response contains no matching text block")?;
    }
    let text = selected
        .pointer(&response.value_path)
        .and_then(Value::as_str)
        .ok_or("AI assistant response is not text")?
        .trim();
    if text.starts_with("```") {
        Ok(text
            .lines()
            .skip(1)
            .take_while(|line| line.trim() != "```")
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .into())
    } else {
        Ok(text.to_string())
    }
}
