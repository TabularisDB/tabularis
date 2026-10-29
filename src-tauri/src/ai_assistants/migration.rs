use crate::{config::AppConfig, credential_cache::CredentialCache, runtime::RuntimeContext};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeSet;

const LEGACY: &[&str] = &[
    "openai",
    "anthropic",
    "openrouter",
    "requesty",
    "minimax",
    "ollama",
    "custom-openai",
];

#[derive(Default, Serialize, Deserialize)]
pub(crate) struct Migration {
    pub pending: BTreeSet<String>,
    pub completed: BTreeSet<String>,
}

pub(crate) fn candidates(config: &AppConfig, configured_keys: &[String]) -> BTreeSet<String> {
    let mut ids = configured_keys.iter().cloned().collect::<BTreeSet<_>>();
    ids.extend(config.ai_provider.iter().cloned());
    if let Some(models) = &config.ai_custom_models {
        ids.extend(models.keys().cloned());
    }
    if config
        .ai_custom_openai_url
        .as_ref()
        .is_some_and(|url| !url.trim().is_empty())
    {
        ids.insert("custom-openai".into());
    }
    if config.ai_ollama_port.is_some_and(|port| port != 11434) {
        ids.insert("ollama".into());
    }
    ids.retain(|id| LEGACY.contains(&id.as_str()));
    ids
}

/// A durable pending set allows offline upgrades to retry. Completed entries
/// prevent a later intentional uninstall from being undone on the next launch.
pub async fn migrate_legacy_providers(
    runtime: &RuntimeContext,
    cache: &CredentialCache,
) -> Result<(), String> {
    // A process-wide or per-provider lock would still let two application
    // processes overwrite each other's durable pending/completed snapshots.
    use fs2::FileExt;
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(
            runtime
                .paths
                .config_dir()
                .join("ai-assistant-migration.lock"),
        )
        .map_err(|error| error.to_string())?;
    lock.try_lock_exclusive()
        .map_err(|_| "AI assistant migration is already running".to_string())?;
    let path = runtime
        .paths
        .config_dir()
        .join("ai-assistant-migration-v1.json");
    let mut migration = match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice::<Migration>(&bytes)
            .map_err(|_| "Invalid AI assistant migration state")?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let config = crate::application::persistence::load_config(runtime);
            let keys = LEGACY
                .iter()
                .filter(|id| **id != "ollama")
                .filter(|id| crate::application::ai::key_status(runtime, cache, id).configured)
                .map(|id| (*id).to_string())
                .collect::<Vec<_>>();
            let migration = Migration {
                pending: candidates(&config, &keys),
                completed: BTreeSet::new(),
            };
            save(&path, &migration)?;
            super::notify_changed(runtime);
            migration
        }
        Err(e) => return Err(e.to_string()),
    };
    for id in migration.pending.clone() {
        let guard = match crate::plugins::install_cancellation::begin(&id) {
            Ok(guard) => guard,
            Err(_) => continue,
        };
        let config = crate::application::persistence::load_config(runtime);
        if super::read_manifest(&runtime.paths.plugins_dir(), &id).is_err() {
            let base = config
                .tabularium_registry_url
                .as_deref()
                .unwrap_or(crate::plugins::registry::DEFAULT_TABULARIUM_URL);
            if let Err(error) = super::install(runtime, &id, None, base, guard.cancellation()).await
            {
                log::warn!("AI assistant migration for {id} will retry: {error}");
                continue;
            }
        }
        // Re-read after network work so unrelated settings cannot be overwritten
        // with the snapshot from before the download.
        let config = crate::application::persistence::load_config(runtime);
        let mut settings = std::collections::HashMap::new();
        if id == "ollama" {
            settings
                .entry("port".into())
                .or_insert(json!(config.ai_ollama_port.unwrap_or(11434)));
        }
        if id == "custom-openai" {
            if let Some(url) = &config.ai_custom_openai_url {
                settings.entry("base_url".into()).or_insert(json!(url));
            }
            if let Some(model) = &config.ai_custom_openai_model {
                settings.entry("model".into()).or_insert(json!(model));
            }
        }
        crate::application::persistence::merge_missing_plugin_settings(runtime, &id, settings)?;
        crate::ai::clear_models_cache(runtime)?;
        migration.pending.remove(&id);
        migration.completed.insert(id);
        save(&path, &migration)?;
        super::notify_changed(runtime);
    }
    Ok(())
}

fn save(path: &std::path::Path, migration: &Migration) -> Result<(), String> {
    let mut file =
        tempfile::NamedTempFile::new_in(path.parent().ok_or("Invalid AI migration path")?)
            .map_err(|e| e.to_string())?;
    use std::io::Write;
    file.write_all(&serde_json::to_vec_pretty(migration).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
