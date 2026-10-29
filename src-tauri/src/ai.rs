use crate::credential_cache::CredentialCache;
use crate::runtime::RuntimeContext;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

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

#[derive(Serialize, Deserialize, Debug)]
pub struct AiSuggestTableNameRequest {
    pub provider: String,
    pub model: String,
    pub headers: Vec<String>,
    pub sample_rows: Vec<Vec<String>>,
}

#[derive(Serialize, Deserialize, Debug)]
struct AiModelsCache {
    last_updated: u64,
    models: HashMap<String, Vec<String>>,
    #[serde(default)]
    fetched_at: HashMap<String, u64>,
}

fn get_cache_path(runtime: &RuntimeContext) -> std::path::PathBuf {
    runtime.paths.config_dir().join("ai_models_cache.json")
}

fn load_cache(runtime: &RuntimeContext) -> Option<AiModelsCache> {
    let path = get_cache_path(runtime);
    if path.exists() {
        let content = fs::read_to_string(path).ok()?;
        serde_json::from_str(&content).ok()
    } else {
        None
    }
}

fn save_cache(
    runtime: &RuntimeContext,
    models: &HashMap<String, Vec<String>>,
    fetched_at: HashMap<String, u64>,
) {
    let path = get_cache_path(runtime);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let cache = AiModelsCache {
        last_updated: timestamp,
        models: models.clone(),
        fetched_at,
    };

    if let Ok(content) = serde_json::to_string(&cache) {
        let _ = fs::create_dir_all(runtime.paths.config_dir());
        let _ = fs::write(path, content);
    }
}

// --- Fetchers ---

pub fn clear_models_cache(runtime: &RuntimeContext) -> Result<(), String> {
    let path = get_cache_path(runtime);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub async fn get_models(
    runtime: &RuntimeContext,
    cache: &CredentialCache,
    force_refresh: bool,
) -> Result<HashMap<String, Vec<String>>, String> {
    let installed = crate::ai_assistants::list_installed(&runtime.paths.plugins_dir());
    let previous = if force_refresh {
        None
    } else {
        load_cache(runtime)
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let mut models = HashMap::new();
    let mut fetched_at = HashMap::new();
    for manifest in installed {
        let fetched = previous
            .as_ref()
            .and_then(|entry| entry.fetched_at.get(&manifest.id).copied())
            .unwrap_or(0);
        let cached = previous
            .as_ref()
            .filter(|_| {
                manifest.ai_assistant.models.cache_seconds > 0
                    && now.saturating_sub(fetched) < manifest.ai_assistant.models.cache_seconds
            })
            .and_then(|entry| entry.models.get(&manifest.id));
        if let Some(cached) = cached {
            fetched_at.insert(manifest.id.clone(), fetched);
            models.insert(manifest.id, cached.clone());
            continue;
        }
        let available = crate::ai_assistants::call(
            runtime,
            cache,
            &manifest.id,
            "list_models",
            serde_json::Value::Null,
        )
        .await
        .and_then(|value| serde_json::from_value::<Vec<String>>(value).map_err(|e| e.to_string()))
        .unwrap_or(manifest.ai_assistant.default_models);
        fetched_at.insert(manifest.id.clone(), now);
        models.insert(manifest.id, available);
    }
    save_cache(runtime, &models, fetched_at);
    Ok(models)
}

async fn resolve_model(
    runtime: &RuntimeContext,
    cache: &CredentialCache,
    provider: &str,
    model: &str,
) -> Result<String, String> {
    if !model.is_empty() {
        return Ok(model.to_string());
    }
    if provider == "chatgpt" {
        return crate::chatgpt::list_models()
            .await?
            .into_iter()
            .next()
            .map(|model| model.slug)
            .ok_or_else(|| {
                "No ChatGPT models available. Continue with ChatGPT in AI settings.".into()
            });
    }
    let config = crate::application::persistence::load_config(runtime);
    if let Some(model) = config
        .plugins
        .as_ref()
        .and_then(|plugins| plugins.get(provider))
        .and_then(|plugin| plugin.settings.get("model"))
        .and_then(serde_json::Value::as_str)
        .filter(|model| !model.is_empty())
    {
        return Ok(model.to_string());
    }
    if let Some(model) = config
        .ai_custom_models
        .as_ref()
        .and_then(|models| models.get(provider))
        .and_then(|models| models.first())
    {
        return Ok(model.clone());
    }
    get_models(runtime,cache,false).await?.get(provider).and_then(|models| models.first()).cloned()
        .ok_or_else(|| format!("No models available for AI provider '{provider}'. Check its installation and settings."))
}

async fn dispatch_provider(
    runtime: &RuntimeContext,
    cache: &CredentialCache,
    gen_req: &AiGenerateRequest,
    system_prompt: &str,
) -> Result<String, String> {
    if gen_req.provider == "chatgpt" {
        return crate::chatgpt::generate(&gen_req.model, &gen_req.prompt, system_prompt).await;
    }
    let result = crate::ai_assistants::call(
        runtime,
        cache,
        &gen_req.provider,
        "generate",
        json!({"model":gen_req.model,"prompt":gen_req.prompt,"system_prompt":system_prompt}),
    )
    .await?;
    result
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "AI provider returned an invalid generation result".into())
}

pub async fn generate_query(
    runtime: &RuntimeContext,
    cache: &CredentialCache,
    mut req: AiGenerateRequest,
) -> Result<String, String> {
    log::info!("Generating AI query using provider: {}", req.provider);

    req.model = resolve_model(runtime, cache, &req.provider, &req.model).await?;

    let raw_prompt = crate::application::persistence::get_prompt(
        runtime,
        crate::application::persistence::PromptKind::System,
    );
    let system_prompt = raw_prompt.replace("{{SCHEMA}}", &req.schema);

    let result = dispatch_provider(runtime, cache, &req, &system_prompt).await;

    match &result {
        Ok(_) => log::info!("AI query generated successfully using {}", req.model),
        Err(e) => log::error!("AI query generation failed: {}", e),
    }

    result
}

pub async fn explain_query(
    runtime: &RuntimeContext,
    cache: &CredentialCache,
    mut req: AiExplainRequest,
) -> Result<String, String> {
    log::info!("Explaining query using AI provider: {}", req.provider);

    req.model = resolve_model(runtime, cache, &req.provider, &req.model).await?;

    let raw_prompt = crate::application::persistence::get_prompt(
        runtime,
        crate::application::persistence::PromptKind::Explain,
    );
    let system_prompt = raw_prompt.replace("{{LANGUAGE}}", &req.language);

    let gen_req = AiGenerateRequest {
        provider: req.provider.clone(),
        model: req.model.clone(),
        prompt: format!("Query:\n{}\n", req.query),
        schema: String::new(),
    };

    let result = dispatch_provider(runtime, cache, &gen_req, &system_prompt).await;

    match &result {
        Ok(_) => log::info!(
            "Query explanation generated successfully using {}",
            req.model
        ),
        Err(e) => log::error!("Query explanation generation failed: {}", e),
    }

    result
}

pub async fn analyze_explain_plan(
    runtime: &RuntimeContext,
    cache: &CredentialCache,
    mut req: AiExplainRequest,
) -> Result<String, String> {
    log::info!("Analyzing explain plan using AI provider: {}", req.provider);

    req.model = resolve_model(runtime, cache, &req.provider, &req.model).await?;

    let raw_prompt = crate::application::persistence::get_prompt(
        runtime,
        crate::application::persistence::PromptKind::ExplainPlan,
    );
    let system_prompt = raw_prompt.replace("{{LANGUAGE}}", &req.language);

    let gen_req = AiGenerateRequest {
        provider: req.provider.clone(),
        model: req.model.clone(),
        prompt: req.query.clone(),
        schema: String::new(),
    };

    let result = dispatch_provider(runtime, cache, &gen_req, &system_prompt).await;

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
    runtime: &RuntimeContext,
    cache: &CredentialCache,
    provider: String,
    model: String,
    query: String,
    prompt_kind: crate::application::persistence::PromptKind,
    label: &str,
) -> Result<String, String> {
    log::info!("Generating {} using AI provider: {}", label, provider);

    let resolved_model = resolve_model(runtime, cache, &provider, &model).await?;
    let system_prompt = crate::application::persistence::get_prompt(runtime, prompt_kind);

    let gen_req = AiGenerateRequest {
        provider: provider.clone(),
        model: resolved_model.clone(),
        prompt: query,
        schema: String::new(),
    };

    let result = dispatch_provider(runtime, cache, &gen_req, &system_prompt).await;

    match &result {
        Ok(v) => log::info!("{} generated: {}", label, v),
        Err(e) => log::error!("{} generation failed: {}", label, e),
    }

    result
}

pub async fn generate_cellname(
    runtime: &RuntimeContext,
    cache: &CredentialCache,
    req: AiCellNameRequest,
) -> Result<String, String> {
    generate_with_simple_prompt(
        runtime,
        cache,
        req.provider,
        req.model,
        req.query,
        crate::application::persistence::PromptKind::CellName,
        "Cell name",
    )
    .await
}

pub async fn suggest_table_name_with_runtime(
    runtime: &RuntimeContext,
    cache: &CredentialCache,
    req: AiSuggestTableNameRequest,
) -> Result<String, String> {
    log::info!("Suggesting table name using AI provider: {}", req.provider);

    let resolved_model = resolve_model(runtime, cache, &req.provider, &req.model).await?;

    let sample_preview = req
        .sample_rows
        .iter()
        .take(3)
        .map(|r| r.join(", "))
        .collect::<Vec<_>>()
        .join(" | ");

    let prompt = format!(
        "Given these column names: [{}] and sample data: [{}], suggest a concise snake_case table name that describes this data. Reply with only the table name, nothing else.",
        req.headers.join(", "),
        sample_preview
    );

    let gen_req = AiGenerateRequest {
        provider: req.provider.clone(),
        model: resolved_model,
        prompt,
        schema: String::new(),
    };

    let system_prompt = "You are a database naming expert. Reply with only a snake_case table name, no explanation.";
    let result = dispatch_provider(runtime, cache, &gen_req, system_prompt).await;

    match &result {
        Ok(name) => {
            let cleaned = name
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_lowercase()
                .replace(|c: char| !c.is_alphanumeric() && c != '_', "_")
                .trim_matches('_')
                .to_string();
            log::info!("Table name suggested: {}", cleaned);
            Ok(cleaned)
        }
        Err(e) => {
            log::error!("Table name suggestion failed: {}", e);
            Err(e.clone())
        }
    }
}

pub async fn generate_tab_name(
    runtime: &RuntimeContext,
    cache: &CredentialCache,
    req: AiTabRenameRequest,
) -> Result<String, String> {
    generate_with_simple_prompt(
        runtime,
        cache,
        req.provider,
        req.model,
        req.query,
        crate::application::persistence::PromptKind::TabRename,
        "Tab name",
    )
    .await
}
