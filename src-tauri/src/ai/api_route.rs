use super::{ai_client_for, Client, OpenAiModelList};
use crate::{credential_cache::CredentialCache, runtime::RuntimeContext};

pub(super) const BASE_URL: &str = "https://global.api-route.com/v1";

pub(super) async fn models(runtime: &RuntimeContext, cache: &CredentialCache) -> Vec<String> {
    let Ok(key) = crate::application::ai::get_api_key(runtime, cache, "api-route") else {
        return Vec::new();
    };
    let cached_models = super::load_cache(runtime)
        .and_then(|mut cached| cached.models.remove("api-route"))
        .unwrap_or_default();
    let Ok(client) = ai_client_for("api-route") else {
        return cached_models;
    };
    models_with_client(&client, &key, cached_models).await
}

pub(super) async fn models_with_client(
    client: &Client,
    key: &str,
    cached_models: Vec<String>,
) -> Vec<String> {
    if key.is_empty() {
        return Vec::new();
    }
    let Ok(response) = client
        .get(format!("{BASE_URL}/models"))
        .bearer_auth(key)
        .send()
        .await
    else {
        return cached_models;
    };
    if !response.status().is_success() {
        return cached_models;
    }
    match response.json::<OpenAiModelList>().await {
        Ok(models) => models.data.into_iter().map(|model| model.id).collect(),
        Err(_) => cached_models,
    }
}
