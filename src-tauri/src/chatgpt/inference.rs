use super::{auth, protocol, storage::LockedStore, RESOURCE, SESSION_LOCK};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Deserialize)]
struct ModelList {
    models: Vec<ChatGptModel>,
}

#[derive(Deserialize, Serialize)]
pub struct ChatGptModel {
    pub slug: String,
    #[serde(rename(deserialize = "display_name", serialize = "displayName"))]
    pub display_name: String,
    #[serde(skip_serializing)]
    visibility: String,
}

pub async fn list_models() -> Result<Vec<ChatGptModel>, String> {
    let _guard = SESSION_LOCK.lock().await;
    let disk = LockedStore::open()?;
    let mut store = disk.load()?;
    // An unconnected installation has no ChatGPT catalog, and no static fallback.
    let active = store
        .active_profile_id
        .as_ref()
        .and_then(|id| store.profiles.iter().find(|p| &p.id == id));
    if !active.is_some_and(|p| p.tokens.as_ref().is_some_and(|t| t.sharing())) {
        return Ok(vec![]);
    }
    let token = auth::access_token(&disk, &mut store).await?;
    let response = super::http_client()?
        .get(format!("{RESOURCE}/models"))
        .bearer_auth(token)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|_| "Could not load ChatGPT models. Check your connection.")?;
    if !response.status().is_success() {
        return Err(super::api_errors::from_response(response).await);
    }
    let models: ModelList = response
        .json()
        .await
        .map_err(|_| "ChatGPT returned an invalid model catalog.")?;
    Ok(models
        .models
        .into_iter()
        .filter(|m| m.visibility == "list")
        .collect())
}

pub(super) fn request_body(model: &str, prompt: &str, instructions: &str) -> Value {
    // ChatGPT plan usage requires an input array even for a single text prompt.
    json!({
        "model": model,
        "input": [{
            "type": "message",
            "role": "user",
            "content": [{ "type": "input_text", "text": prompt }],
        }],
        "instructions": instructions,
        "store": false,
        "stream": true,
    })
}

pub async fn generate(model: &str, prompt: &str, instructions: &str) -> Result<String, String> {
    let _guard = SESSION_LOCK.lock().await;
    let disk = LockedStore::open()?;
    let mut store = disk.load()?;
    let token = auth::access_token(&disk, &mut store).await?;
    let mut response = super::http_client()?
        .post(format!("{RESOURCE}/responses"))
        .bearer_auth(token)
        .json(&request_body(model, prompt, instructions))
        .timeout(std::time::Duration::from_secs(180))
        .send()
        .await
        .map_err(|_| "Could not reach ChatGPT. Check your connection and proxy settings.")?;
    if !response.status().is_success() {
        return Err(super::api_errors::from_response(response).await);
    }
    let mut parser = protocol::ResponseStream::default();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "ChatGPT stream was interrupted. Please try again.")?
    {
        parser.push(&chunk)?;
        if parser.completed {
            break;
        }
    }
    parser.finish()
}
