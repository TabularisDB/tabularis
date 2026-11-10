use super::{ai_client_for, Client, OpenAiModelList};
use crate::{credential_cache::CredentialCache, runtime::RuntimeContext};

pub(super) const BASE_URL: &str = "https://global.api-route.com/v1";

pub(super) async fn models(runtime: &RuntimeContext, cache: &CredentialCache) -> Vec<String> {
    let Ok(key) = crate::application::ai::get_api_key(runtime, cache, "api-route") else {
        return Vec::new();
    };
    let Ok(client) = ai_client_for("api-route") else {
        return super::load_cache(runtime)
            .and_then(|mut cached| cached.models.remove("api-route"))
            .unwrap_or_default();
    };
    models_with_cache(runtime, &client, &key).await
}

// Keep the shared cache age: refreshing this account must not postpone other providers.
pub(super) async fn models_with_cache(
    runtime: &RuntimeContext,
    client: &Client,
    key: &str,
) -> Vec<String> {
    let fetched = fetch_models(client, key).await;
    let _guard = super::MODEL_CACHE_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let mut cached = super::load_cache_unlocked(runtime);
    let previous = cached
        .as_ref()
        .and_then(|entry| entry.models.get("api-route"))
        .cloned()
        .unwrap_or_default();
    let Ok(models) = fetched else {
        return previous;
    };
    if let Some(entry) = cached.as_mut() {
        entry.models.insert("api-route".into(), models.clone());
        if let Ok(content) = serde_json::to_string(entry) {
            if let Err(error) = std::fs::write(super::get_cache_path(runtime), content) {
                log::warn!("Failed to persist API Route model cache: {error}");
            }
        }
    }
    models
}

#[cfg(test)]
pub(super) async fn models_with_client(
    client: &Client,
    key: &str,
    cached_models: Vec<String>,
) -> Vec<String> {
    fetch_models(client, key).await.unwrap_or(cached_models)
}

async fn fetch_models(client: &Client, key: &str) -> Result<Vec<String>, reqwest::Error> {
    if key.is_empty() {
        return Ok(Vec::new());
    }
    let response = client
        .get(format!("{BASE_URL}/models"))
        .bearer_auth(key)
        .send()
        .await?
        .error_for_status()?;
    let models = response.json::<OpenAiModelList>().await?;
    Ok(models.data.into_iter().map(|model| model.id).collect())
}
