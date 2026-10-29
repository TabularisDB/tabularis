use super::{read_manifest, recipe, AssistantManifest, Authentication, HttpRequest};
use crate::{credential_cache::CredentialCache, runtime::RuntimeContext};
use reqwest::Client;
use serde_json::{json, Value};
use std::time::Duration;

pub async fn call(
    runtime: &RuntimeContext,
    cache: &CredentialCache,
    provider: &str,
    method: &str,
    request: Value,
) -> Result<Value, String> {
    let manifest = read_manifest(&runtime.paths.plugins_dir(), provider)?;
    crate::plugins::runtime_version::enforce_min_runtime_version(
        provider,
        manifest.min_runtime_version.as_deref(),
    )?;
    let config = crate::application::persistence::load_config(runtime);
    let mut settings = manifest
        .settings
        .iter()
        .filter_map(|definition| {
            definition
                .default
                .clone()
                .map(|value| (definition.key.clone(), value))
        })
        .collect::<serde_json::Map<_, _>>();
    if let Some(plugin) = config
        .plugins
        .as_ref()
        .and_then(|plugins| plugins.get(provider))
    {
        settings.extend(plugin.settings.clone());
    }
    let key = if manifest.ai_assistant.authentication == Authentication::ApiKey {
        crate::application::ai::get_api_key(runtime, cache, provider).ok()
    } else {
        None
    };
    let variables = json!({"settings":settings,"model":request["model"],"prompt":request["prompt"],"system_prompt":request["system_prompt"]});
    let mut builder = Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none());
    let policy = if manifest.ai_assistant.direct {
        crate::proxy::HttpProxyPolicy::Disabled
    } else {
        crate::proxy::resolve_http_policy(crate::proxy::SCOPE_AI, Some(provider))?
    };
    match policy {
        crate::proxy::HttpProxyPolicy::System => {}
        crate::proxy::HttpProxyPolicy::Disabled => builder = builder.no_proxy(),
        crate::proxy::HttpProxyPolicy::Custom(endpoint) => {
            builder = builder.no_proxy().proxy(
                reqwest::Proxy::all(crate::proxy::endpoint_to_proxy_url(&endpoint)?)
                    .map_err(|_| "Invalid AI assistant proxy")?,
            )
        }
    }
    let client = builder
        .build()
        .map_err(|_| "Could not build AI assistant HTTP client")?;
    let operation = execute(&client, &manifest, &variables, key.as_deref(), method);
    match crate::plugins::call_timeout::for_plugin(provider) {
        Some(timeout) => tokio::time::timeout(timeout, operation)
            .await
            .map_err(|_| "AI assistant request timed out".to_string())?,
        None => operation.await,
    }
}

pub(crate) async fn execute(
    client: &Client,
    manifest: &AssistantManifest,
    variables: &Value,
    key: Option<&str>,
    method: &str,
) -> Result<Value, String> {
    match method {
        "generate" => {
            let mut last_error = "AI assistant has no generation request".to_string();
            for request in &manifest.ai_assistant.generate.requests {
                match send(client, manifest, request, variables, key, true)
                    .await
                    .and_then(|value| {
                        recipe::response_text(&value, &manifest.ai_assistant.generate.response)
                    }) {
                    Ok(text) => return Ok(json!(text)),
                    Err(error) => last_error = error,
                }
            }
            Err(last_error)
        }
        "list_models" => {
            let mut models = manifest.ai_assistant.default_models.clone();
            for source in &manifest.ai_assistant.models.sources {
                let Ok(value) =
                    send(client, manifest, &source.request, variables, key, false).await
                else {
                    continue;
                };
                let Some(items) = value.pointer(&source.items_path).and_then(Value::as_array)
                else {
                    continue;
                };
                for item in items {
                    if source
                        .filters
                        .iter()
                        .all(|filter| recipe::matches(item, filter))
                    {
                        if let Some(id) = item
                            .pointer(&source.id_path)
                            .and_then(Value::as_str)
                            .filter(|id| !id.is_empty())
                        {
                            if !models.iter().any(|model| model == id) {
                                models.push(id.to_string());
                            }
                        }
                    }
                }
                if manifest.ai_assistant.models.fallback {
                    break;
                }
            }
            Ok(json!(models))
        }
        _ => Err("Unsupported AI assistant operation".into()),
    }
}

async fn send(
    client: &Client,
    manifest: &AssistantManifest,
    request: &HttpRequest,
    variables: &Value,
    key: Option<&str>,
    post: bool,
) -> Result<Value, String> {
    let url = recipe::request_url(&request.url, &request.append_path, variables)?;
    let mut builder = if post {
        client.post(url)
    } else {
        client.get(url)
    };
    for (name, value) in &request.headers {
        builder = builder.header(name, value);
    }
    let contract = &manifest.ai_assistant;
    if request.authenticated && contract.authentication == Authentication::ApiKey {
        match key.filter(|key| !key.is_empty()) {
            Some(key) => {
                builder = builder.header(
                    &contract.api_key_header,
                    format!("{}{key}", contract.api_key_prefix),
                )
            }
            None if !contract.optional_api_key => {
                return Err(format!("API key for {} is not configured", manifest.name))
            }
            None => {}
        }
    }
    if let Some(body) = &request.body {
        builder = builder.json(&recipe::render(body, variables)?);
    }
    let mut response = builder
        .send()
        .await
        .map_err(|_| format!("{} request failed", manifest.name))?;
    if !response.status().is_success() {
        return Err(format!(
            "{} returned HTTP {}",
            manifest.name,
            response.status().as_u16()
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read AI assistant response")?
    {
        if bytes.len() + chunk.len() > 16 * 1024 * 1024 {
            return Err("AI assistant response exceeds byte limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "AI assistant returned invalid JSON".into())
}
