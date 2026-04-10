use crate::config;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

// --- Data Structures ---

#[derive(Serialize, Deserialize, Debug)]
pub struct AiGenerateRequest {
    pub provider: String,
    pub model: String,
    pub prompt: String,
    pub schema: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AiExplainRequest {
    pub provider: String,
    pub model: String,
    pub query: String,
    pub language: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AiCellNameRequest {
    pub provider: String,
    pub model: String,
    pub query: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AiTabRenameRequest {
    pub provider: String,
    pub model: String,
    pub query: String,
}

#[derive(Deserialize, Debug)]
struct OllamaTagsResponse {
    models: Vec<OllamaModel>,
}

#[derive(Deserialize, Debug)]
struct OllamaModel {
    name: String,
}

#[derive(Deserialize, Debug)]
struct OpenAiModelList {
    data: Vec<OpenAiModel>,
}

#[derive(Deserialize, Debug)]
struct OpenAiModel {
    id: String,
}

#[derive(Deserialize, Debug)]
struct OpenRouterModelList {
    data: Vec<OpenRouterModel>,
}

#[derive(Deserialize, Debug)]
struct OpenRouterModel {
    id: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct AiModelsCache {
    last_updated: u64,
    models: HashMap<String, Vec<String>>,
}

// --- Helper Functions ---

fn load_default_models() -> HashMap<String, Vec<String>> {
    let yaml_content = include_str!("ai_models.yaml");
    serde_yaml::from_str(yaml_content).unwrap_or_else(|e| {
        println!("Failed to parse models.yaml: {}", e);
        HashMap::new() // Fallback to empty map on critical error (should be caught by tests)
    })
}

fn get_cache_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|p| p.join("ai_models_cache.json"))
}

fn load_cache(app: &AppHandle) -> Option<AiModelsCache> {
    let path = get_cache_path(app)?;
    if path.exists() {
        let content = fs::read_to_string(path).ok()?;
        serde_json::from_str(&content).ok()
    } else {
        None
    }
}

fn save_cache(app: &AppHandle, models: &HashMap<String, Vec<String>>) {
    if let Some(path) = get_cache_path(app) {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let cache = AiModelsCache {
            last_updated: timestamp,
            models: models.clone(),
        };

        if let Ok(content) = serde_json::to_string(&cache) {
            let _ = fs::write(path, content);
        }
    }
}

// --- Fetchers ---

async fn fetch_ollama_models(port: u16) -> Vec<String> {
    let client = Client::new();
    let url = format!("http://localhost:{}/api/tags", port);
    match client.get(&url).send().await {
        Ok(res) => {
            if res.status().is_success() {
                if let Ok(json) = res.json::<OllamaTagsResponse>().await {
                    return json.models.into_iter().map(|m| m.name).collect();
                }
            }
            Vec::new()
        }
        Err(_) => Vec::new(),
    }
}

async fn fetch_openai_models(api_key: &str) -> Vec<String> {
    if api_key.is_empty() {
        return Vec::new();
    }
    let client = Client::new();
    match client
        .get("https://api.openai.com/v1/models")
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
    {
        Ok(res) => {
            if res.status().is_success() {
                if let Ok(json) = res.json::<OpenAiModelList>().await {
                    return json
                        .data
                        .into_iter()
                        .map(|m| m.id)
                        .filter(|id| id.starts_with("gpt") || id.starts_with("o1"))
                        .collect();
                }
            }
            Vec::new()
        }
        Err(_) => Vec::new(),
    }
}

async fn fetch_openrouter_models() -> Vec<String> {
    let client = Client::new();
    match client
        .get("https://openrouter.ai/api/v1/models")
        .send()
        .await
    {
        Ok(res) => {
            if res.status().is_success() {
                if let Ok(json) = res.json::<OpenRouterModelList>().await {
                    return json.data.into_iter().map(|m| m.id).collect();
                }
            }
            Vec::new()
        }
        Err(_) => Vec::new(),
    }
}

async fn fetch_custom_openai_models(base_url: &str, api_key: &str) -> Vec<String> {
    if base_url.is_empty() || api_key.is_empty() {
        return Vec::new();
    }

    let client = Client::new();

    // Build the /models endpoint URL
    let url = if base_url.ends_with("/models") {
        base_url.to_string()
    } else if base_url.ends_with("/") {
        format!("{}models", base_url)
    } else if base_url.ends_with("/v1") {
        format!("{}/models", base_url)
    } else {
        format!("{}/v1/models", base_url)
    };

    match client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
    {
        Ok(res) => {
            if res.status().is_success() {
                if let Ok(json) = res.json::<OpenAiModelList>().await {
                    return json.data.into_iter().map(|m| m.id).collect();
                }
            }
            Vec::new()
        }
        Err(_) => Vec::new(),
    }
}

// --- Commands ---

#[tauri::command]
pub fn clear_ai_models_cache(app: AppHandle) -> Result<(), String> {
    if let Some(path) = get_cache_path(&app) {
        if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_ai_models(
    app: AppHandle,
    force_refresh: bool,
) -> Result<HashMap<String, Vec<String>>, String> {
    // Load config to get Ollama port
    let app_config = config::load_config_internal(&app);
    let ollama_port = app_config.ai_ollama_port.unwrap_or(11434);

    // 1. Check Cache (if not forced)
    if !force_refresh {
        if let Some(cache) = load_cache(&app) {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            // 24 hours = 86400 seconds
            if now - cache.last_updated < 86400 {
                let mut cached_models = cache.models;

                // Always refresh Ollama as it is local and fast
                let ollama_models = fetch_ollama_models(ollama_port).await;
                // Replace or insert ollama entry
                if !ollama_models.is_empty() {
                    cached_models.insert("ollama".to_string(), ollama_models);
                } else {
                    cached_models.insert("ollama".to_string(), vec![]);
                }

                // Always refresh custom-openai as it depends on user configuration
                if let (Some(base_url), Ok(api_key)) = (
                    app_config.ai_custom_openai_url.clone(),
                    config::get_ai_api_key("custom-openai"),
                ) {
                    if !base_url.is_empty() && !api_key.is_empty() {
                        let custom_models = fetch_custom_openai_models(&base_url, &api_key).await;
                        if !custom_models.is_empty() {
                            cached_models.insert("custom-openai".to_string(), custom_models);
                        } else {
                            cached_models.insert("custom-openai".to_string(), vec![]);
                        }
                    }
                }

                return Ok(cached_models);
            }
        }
    }

    let mut models = load_default_models();

    // 1. Ollama (Dynamic)
    let ollama_models = fetch_ollama_models(ollama_port).await;
    if !ollama_models.is_empty() {
        models.insert("ollama".to_string(), ollama_models);
    }

    // 2. OpenAI (Dynamic if key exists)
    if let Ok(key) = config::get_ai_api_key("openai") {
        let remote_models = fetch_openai_models(&key).await;
        if !remote_models.is_empty() {
            if let Some(static_list) = models.get_mut("openai") {
                let mut set: HashSet<String> = static_list.iter().cloned().collect();
                set.extend(remote_models);
                *static_list = set.into_iter().collect();
                static_list.sort();
            }
        }
    }

    // 3. OpenRouter (Dynamic public)
    let openrouter_models = fetch_openrouter_models().await;
    if !openrouter_models.is_empty() {
        if let Some(static_list) = models.get_mut("openrouter") {
            let favorites: HashSet<String> = static_list.iter().cloned().collect();
            let mut new_list = static_list.clone();

            for m in openrouter_models {
                if !favorites.contains(&m) {
                    new_list.push(m);
                }
            }
            *static_list = new_list;
        }
    }

    // 4. Custom OpenAI (Dynamic if configured)
    if let (Some(base_url), Ok(api_key)) = (
        app_config.ai_custom_openai_url,
        config::get_ai_api_key("custom-openai"),
    ) {
        if !base_url.is_empty() && !api_key.is_empty() {
            let custom_models = fetch_custom_openai_models(&base_url, &api_key).await;
            if !custom_models.is_empty() {
                models.insert("custom-openai".to_string(), custom_models);
            } else {
                models.insert("custom-openai".to_string(), vec![]);
            }
        } else {
            models.insert("custom-openai".to_string(), vec![]);
        }
    } else {
        models.insert("custom-openai".to_string(), vec![]);
    }

    // Save to Cache
    save_cache(&app, &models);

    Ok(models)
}

#[tauri::command]
pub async fn generate_ai_query(app: AppHandle, req: AiGenerateRequest) -> Result<String, String> {
    generate_query(app, req).await
}

#[tauri::command]
pub async fn explain_ai_query(app: AppHandle, req: AiExplainRequest) -> Result<String, String> {
    explain_query(app, req).await
}

#[tauri::command]
pub async fn analyze_ai_explain_plan(
    app: AppHandle,
    req: AiExplainRequest,
) -> Result<String, String> {
    analyze_explain_plan(app, req).await
}

#[tauri::command]
pub async fn generate_cell_name(app: AppHandle, req: AiCellNameRequest) -> Result<String, String> {
    generate_cellname(app, req).await
}

// --- Shared helpers ---

async fn resolve_model(
    provider: &str,
    model: &str,
    app_config: &config::AppConfig,
    ollama_port: u16,
) -> Result<String, String> {
    if !model.is_empty() {
        return Ok(model.to_string());
    }
    match provider {
        "ollama" => {
            let models = fetch_ollama_models(ollama_port).await;
            models
                .first()
                .cloned()
                .ok_or_else(|| "No Ollama models found. Is Ollama running?".to_string())
        }
        "custom-openai" => app_config
            .ai_custom_openai_model
            .as_ref()
            .filter(|m| !m.is_empty())
            .cloned()
            .ok_or_else(|| "No model specified for custom OpenAI provider.".to_string()),
        _ => {
            let models = load_default_models();
            models
                .get(provider)
                .and_then(|m| m.first())
                .cloned()
                .ok_or_else(|| format!("No models found for provider {}", provider))
        }
    }
}

async fn dispatch_provider(
    app_config: &config::AppConfig,
    gen_req: &AiGenerateRequest,
    system_prompt: &str,
    ollama_port: u16,
) -> Result<String, String> {
    let api_key = if gen_req.provider != "ollama" {
        config::get_ai_api_key(&gen_req.provider)?
    } else {
        String::new()
    };

    let client = Client::new();
    match gen_req.provider.as_str() {
        "openai" => generate_openai(&client, &api_key, gen_req, system_prompt).await,
        "anthropic" => generate_anthropic(&client, &api_key, gen_req, system_prompt).await,
        "openrouter" => generate_openrouter(&client, &api_key, gen_req, system_prompt).await,
        "ollama" => generate_ollama(&client, gen_req, system_prompt, ollama_port).await,
        "custom-openai" => {
            let base_url = app_config
                .ai_custom_openai_url
                .as_ref()
                .filter(|u| !u.is_empty())
                .ok_or("Custom OpenAI URL not configured.")?;
            generate_custom_openai(&client, &api_key, gen_req, system_prompt, base_url).await
        }
        "minimax" => generate_minimax(&client, &api_key, gen_req, system_prompt).await,
        _ => Err(format!("Unsupported provider: {}", gen_req.provider)),
    }
}

// --- Logic Implementation ---

pub async fn generate_query(app: AppHandle, mut req: AiGenerateRequest) -> Result<String, String> {
    log::info!("Generating AI query using provider: {}", req.provider);

    let app_config = config::load_config_internal(&app);
    let ollama_port = app_config.ai_ollama_port.unwrap_or(11434);
    req.model = resolve_model(&req.provider, &req.model, &app_config, ollama_port).await?;

    let raw_prompt = config::get_system_prompt(app);
    let system_prompt = raw_prompt.replace("{{SCHEMA}}", &req.schema);

    let result = dispatch_provider(&app_config, &req, &system_prompt, ollama_port).await;

    match &result {
        Ok(_) => log::info!("AI query generated successfully using {}", req.model),
        Err(e) => log::error!("AI query generation failed: {}", e),
    }

    result
}

pub async fn explain_query(app: AppHandle, mut req: AiExplainRequest) -> Result<String, String> {
    log::info!("Explaining query using AI provider: {}", req.provider);

    let app_config = config::load_config_internal(&app);
    let ollama_port = app_config.ai_ollama_port.unwrap_or(11434);
    req.model = resolve_model(&req.provider, &req.model, &app_config, ollama_port).await?;

    let raw_prompt = config::get_explain_prompt(app);
    let system_prompt = raw_prompt.replace("{{LANGUAGE}}", &req.language);

    let gen_req = AiGenerateRequest {
        provider: req.provider.clone(),
        model: req.model.clone(),
        prompt: format!("Query:\n{}\n", req.query),
        schema: String::new(),
    };

    let result = dispatch_provider(&app_config, &gen_req, &system_prompt, ollama_port).await;

    match &result {
        Ok(_) => log::info!("Query explanation generated successfully using {}", req.model),
        Err(e) => log::error!("Query explanation generation failed: {}", e),
    }

    result
}

pub async fn analyze_explain_plan(
    app: AppHandle,
    mut req: AiExplainRequest,
) -> Result<String, String> {
    log::info!(
        "Analyzing explain plan using AI provider: {}",
        req.provider
    );

    let app_config = config::load_config_internal(&app);
    let ollama_port = app_config.ai_ollama_port.unwrap_or(11434);
    req.model = resolve_model(&req.provider, &req.model, &app_config, ollama_port).await?;

    let raw_prompt = config::get_explainplan_prompt(app);
    let system_prompt = raw_prompt.replace("{{LANGUAGE}}", &req.language);

    let gen_req = AiGenerateRequest {
        provider: req.provider.clone(),
        model: req.model.clone(),
        prompt: req.query.clone(),
        schema: String::new(),
    };

    let result = dispatch_provider(&app_config, &gen_req, &system_prompt, ollama_port).await;

    match &result {
        Ok(_) => log::info!(
            "Explain plan analysis generated successfully using {}",
            req.model
        ),
        Err(e) => log::error!("Explain plan analysis failed: {}", e),
    }

    result
}

async fn generate_with_simple_prompt(
    app: AppHandle,
    provider: String,
    model: String,
    query: String,
    get_prompt: fn(AppHandle) -> String,
    label: &str,
) -> Result<String, String> {
    log::info!("Generating {} using AI provider: {}", label, provider);

    let app_config = config::load_config_internal(&app);
    let ollama_port = app_config.ai_ollama_port.unwrap_or(11434);
    let resolved_model = resolve_model(&provider, &model, &app_config, ollama_port).await?;

    let system_prompt = get_prompt(app);

    let gen_req = AiGenerateRequest {
        provider: provider.clone(),
        model: resolved_model.clone(),
        prompt: query,
        schema: String::new(),
    };

    let result = dispatch_provider(&app_config, &gen_req, &system_prompt, ollama_port).await;

    match &result {
        Ok(v) => log::info!("{} generated: {}", label, v),
        Err(e) => log::error!("{} generation failed: {}", label, e),
    }

    result
}

pub async fn generate_cellname(app: AppHandle, req: AiCellNameRequest) -> Result<String, String> {
    generate_with_simple_prompt(app, req.provider, req.model, req.query, config::get_cellname_prompt, "Cell name").await
}

#[tauri::command]
pub async fn generate_tab_rename(app: AppHandle, req: AiTabRenameRequest) -> Result<String, String> {
    generate_with_simple_prompt(app, req.provider, req.model, req.query, config::get_tabrename_prompt, "Tab name").await
}

// --- Provider Implementations ---

async fn generate_openai(
    client: &Client,
    api_key: &str,
    req: &AiGenerateRequest,
    system_prompt: &str,
) -> Result<String, String> {
    let body = json!({
        "model": req.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": req.prompt}
        ],
        "temperature": 0.0
    });

    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let error_text = res.text().await.unwrap_or_default();
        return Err(format!("OpenAI Error: {}", error_text));
    }

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Invalid response format from OpenAI")?;

    Ok(clean_response(content))
}

async fn generate_custom_openai(
    client: &Client,
    api_key: &str,
    req: &AiGenerateRequest,
    system_prompt: &str,
    base_url: &str,
) -> Result<String, String> {
    let body = json!({
        "model": req.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": req.prompt}
        ],
        "temperature": 0.0
    });

    // Ensure base_url ends with /v1/chat/completions or append it
    let url = if base_url.ends_with("/v1/chat/completions") {
        base_url.to_string()
    } else if base_url.ends_with("/") {
        format!("{}v1/chat/completions", base_url)
    } else if base_url.ends_with("/v1") {
        format!("{}/chat/completions", base_url)
    } else {
        format!("{}/v1/chat/completions", base_url)
    };

    let res = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let error_text = res.text().await.unwrap_or_default();
        return Err(format!("Custom OpenAI Error: {}", error_text));
    }

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Invalid response format from custom OpenAI-compatible provider")?;

    Ok(clean_response(content))
}

async fn generate_openrouter(
    client: &Client,
    api_key: &str,
    req: &AiGenerateRequest,
    system_prompt: &str,
) -> Result<String, String> {
    let body = json!({
        "model": req.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": req.prompt}
        ],
        "temperature": 0.0
    });

    let res = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("HTTP-Referer", "https://github.com/debba/tabularis")
        .header("X-Title", "Tabularis")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let error_text = res.text().await.unwrap_or_default();
        return Err(format!("OpenRouter Error: {}", error_text));
    }

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Invalid response format from OpenRouter")?;

    Ok(clean_response(content))
}

async fn generate_anthropic(
    client: &Client,
    api_key: &str,
    req: &AiGenerateRequest,
    system_prompt: &str,
) -> Result<String, String> {
    let body = json!({
        "model": req.model,
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": req.prompt}
        ],
        "max_tokens": 1024,
        "temperature": 0.0
    });

    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let error_text = res.text().await.unwrap_or_default();
        return Err(format!("Anthropic Error: {}", error_text));
    }

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let content = json["content"][0]["text"]
        .as_str()
        .ok_or("Invalid response format from Anthropic")?;

    Ok(clean_response(content))
}

async fn generate_ollama(
    client: &Client,
    req: &AiGenerateRequest,
    system_prompt: &str,
    port: u16,
) -> Result<String, String> {
    let body = json!({
        "model": req.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": req.prompt}
        ],
        "stream": false,
        "options": {
            "temperature": 0.0
        }
    });

    let url = format!("http://localhost:{}/api/chat", port);
    let res = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Ollama on port {}: {}", port, e))?;

    if !res.status().is_success() {
        let error_text = res.text().await.unwrap_or_default();
        return Err(format!("Ollama Error: {}", error_text));
    }

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let content = json["message"]["content"]
        .as_str()
        .ok_or("Invalid response format from Ollama")?;

    Ok(clean_response(content))
}

async fn generate_minimax(
    client: &Client,
    api_key: &str,
    req: &AiGenerateRequest,
    system_prompt: &str,
) -> Result<String, String> {
    let body = json!({
        "model": req.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": req.prompt}
        ],
        "temperature": 0.1
    });

    let res = client
        .post("https://api.minimax.io/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let error_text = res.text().await.unwrap_or_default();
        return Err(format!("MiniMax Error: {}", error_text));
    }

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Invalid response format from MiniMax")?;

    Ok(clean_response(content))
}

fn clean_response(text: &str) -> String {
    let text = text.trim();
    if text.starts_with("```") {
        let mut lines = text.lines();
        lines.next(); // Skip first line
        let mut result = Vec::new();
        for line in lines {
            if line.trim() == "```" {
                break;
            }
            result.push(line);
        }
        return result.join("\n").trim().to_string();
    }
    text.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_default_models() {
        let models = load_default_models();
        assert!(models.contains_key("openai"));
        assert!(models.contains_key("anthropic"));
        assert!(models.contains_key("openrouter"));
        assert!(models.contains_key("minimax"));

        // Check for new futuristic models from yaml
        let openai = models.get("openai").unwrap();
        assert!(openai.contains(&"gpt-5.2".to_string()));

        // Check MiniMax models
        let minimax = models.get("minimax").unwrap();
        assert!(minimax.contains(&"MiniMax-M2.7".to_string()));
        assert!(minimax.contains(&"MiniMax-M2.7-highspeed".to_string()));

        // Ollama is not in yaml, so it shouldn't be here yet
        assert!(!models.contains_key("ollama"));
    }

    #[test]
    fn test_clean_response() {
        let input = "```sql\nSELECT * FROM users;\n```";
        let output = clean_response(input);
        assert_eq!(output, "SELECT * FROM users;");

        let input_no_code = "SELECT * FROM users;";
        let output_no_code = clean_response(input_no_code);
        assert_eq!(output_no_code, "SELECT * FROM users;");

        let input_whitespace = "   ```sql\nSELECT 1;\n```   ";
        let output_whitespace = clean_response(input_whitespace);
        assert_eq!(output_whitespace, "SELECT 1;");
    }
}
