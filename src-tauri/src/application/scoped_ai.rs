//! Opt-in, operator-controlled Web AI. No provider selection or execution authority from clients.
use super::{secret_redaction::SecretRedactor, ApplicationRequestContext, AuthorizationLevel};
use crate::{
    credential_cache::CredentialCache,
    runtime::{state::ApplicationState, RuntimeContext},
};
use serde::Deserialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::{watch, Semaphore};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub provider: String,
    pub model: String,
    pub api_key_file: Option<PathBuf>,
    pub connections: Vec<Scope>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scope {
    pub id: String,
    pub database: String,
    pub schemas: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GenerateRequest {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
    pub prompt: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExplainRequest {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
    pub query: String,
    pub language: String,
}
pub enum Request {
    Generate(GenerateRequest),
    Explain(ExplainRequest),
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, Eq, PartialEq)]
pub struct Capability {
    pub provider: String,
    pub model: String,
}

pub struct ScopedAi {
    config: Config,
    cache: CredentialCache,
    redactor: SecretRedactor,
    permits: Semaphore,
    active: Mutex<HashMap<Uuid, (Uuid, watch::Sender<bool>)>>,
}
struct Active<'a> {
    service: &'a ScopedAi,
    id: Uuid,
}
impl Drop for Active<'_> {
    fn drop(&mut self) {
        self.service.active.lock().unwrap().remove(&self.id);
    }
}

fn protected_read(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let file = std::fs::File::open(path).map_err(|_| "Cannot read Web AI configuration")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if file
            .metadata()
            .map_err(|_| "Invalid Web AI file")?
            .permissions()
            .mode()
            & 0o027
            != 0
        {
            return Err("Web AI files must not be group-writable or accessible to others".into());
        }
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read Web AI file")?;
    if bytes.len() as u64 > limit {
        return Err("Web AI file exceeds limit".into());
    }
    Ok(bytes)
}
impl ScopedAi {
    pub fn capability(&self) -> Capability {
        Capability {
            provider: self.config.provider.clone(),
            model: self.config.model.clone(),
        }
    }

    pub fn from_env(runtime: &RuntimeContext) -> Result<Option<Arc<Self>>, String> {
        std::env::var_os("TABULARIS_WEB_AI_CONFIG_FILE")
            .map(|path| Self::load(runtime, Path::new(&path)).map(Arc::new))
            .transpose()
    }
    pub fn load(runtime: &RuntimeContext, path: &Path) -> Result<Self, String> {
        let config: Config = serde_json::from_slice(&protected_read(path, 65536)?)
            .map_err(|_| "Invalid Web AI configuration")?;
        if config.model.trim().is_empty()
            || config.model.len() > 256
            || config.connections.is_empty()
            || config.connections.len() > 128
            || config.connections.iter().any(|s| {
                s.id.is_empty()
                    || s.database.is_empty()
                    || s.schemas.is_empty()
                    || s.schemas.iter().any(|s| s.is_empty())
            })
        {
            return Err("Invalid Web AI scope or model".into());
        }
        let manifest =
            crate::ai_assistants::read_manifest(&runtime.paths.plugins_dir(), &config.provider)
                .map_err(|_| "Web AI provider package unavailable")?;
        let cache = CredentialCache::default();
        let redactor = SecretRedactor::default();
        if let Some(path) = &config.api_key_file {
            let key = String::from_utf8(protected_read(path, 16384)?)
                .map_err(|_| "Invalid Web AI key file")?;
            let key = key.trim_end_matches(['\r', '\n']);
            if key.len() < 4 {
                return Err("Web AI key too short".into());
            }
            crate::credential_cache::set_ai_key_cached(&cache, &config.provider, key);
            redactor.extend([key.to_string()]);
        } else if manifest.ai_assistant.authentication
            == crate::ai_assistants::Authentication::ApiKey
            && !manifest.ai_assistant.optional_api_key
        {
            return Err("Web AI provider requires api_key_file".into());
        } else {
            cache.ai_keys.lock().unwrap().insert(
                config.provider.clone(),
                crate::credential_cache::CacheEntry::Present(String::new()),
            );
        }
        Ok(Self {
            config,
            cache,
            redactor,
            permits: Semaphore::new(2),
            active: Mutex::new(HashMap::new()),
        })
    }
    pub fn cancel_session(&self, session: Uuid) {
        for (owner, cancel) in self.active.lock().unwrap().values() {
            if *owner == session {
                let _ = cancel.send(true);
            }
        }
    }
    fn authorize(
        &self,
        runtime: &RuntimeContext,
        id: &str,
        database: &str,
        schema: &str,
    ) -> Result<String, String> {
        if !self
            .config
            .connections
            .iter()
            .any(|s| s.id == id && s.database == database && s.schemas.iter().any(|s| s == schema))
        {
            return Err("AI_SCOPE_DENIED".into());
        }
        let file = crate::persistence::load_connections_file(&runtime.paths.connections_file())
            .map_err(|_| "AI_SCOPE_DENIED")?;
        let saved = file
            .connections
            .iter()
            .find(|s| {
                s.id == id
                    && s.managed
                    && matches!(s.params.driver.as_str(), "mysql" | "postgres")
                    && (s.params.driver != "mysql" || schema == database)
                    && s.params.database.as_vec().iter().any(|d| d == database)
            })
            .ok_or("AI_SCOPE_DENIED")?;
        // Bind completion to the same saved definition; rotation/deletion invalidates it.
        serde_json::to_string(saved).map_err(|_| "AI_SCOPE_DENIED".into())
    }
    pub async fn execute(
        &self,
        runtime: &RuntimeContext,
        state: &ApplicationState,
        context: ApplicationRequestContext,
        request: Request,
    ) -> Result<String, String> {
        let owner = context
            .session_id
            .filter(|_| context.authorization.permits(AuthorizationLevel::Database))
            .ok_or("AI_SCOPE_DENIED")?;
        let (id, database, schema, text) = match &request {
            Request::Generate(r) => (&r.connection_id, &r.database, &r.schema, &r.prompt),
            Request::Explain(r) => (&r.connection_id, &r.database, &r.schema, &r.query),
        };
        if text.trim().is_empty() || text.len() > 16384 {
            return Err("AI_INVALID_REQUEST".into());
        }
        if let Request::Explain(r) = &request {
            if r.language.len() > 64 {
                return Err("AI_INVALID_REQUEST".into());
            }
        }
        let (snapshot, revision) = {
            let _guard = state.provisioning_lock.try_lock().map_err(|_| "AI_BUSY")?;
            (
                self.authorize(runtime, id, database, schema)?,
                state
                    .provisioning_revision
                    .load(std::sync::atomic::Ordering::SeqCst),
            )
        };
        let _permit = self.permits.try_acquire().map_err(|_| "AI_BUSY")?;
        let (cancel, mut cancelled) = watch::channel(false);
        let token = Uuid::new_v4();
        self.active.lock().unwrap().insert(token, (owner, cancel));
        let _active = Active {
            service: self,
            id: token,
        };
        // Shared AI services may not publish anything to other browser sessions.
        let mut private_runtime = runtime.clone();
        private_runtime.events = Arc::new(crate::runtime::events::NoopRuntimeEvents);
        let operation = async {
            let result = match &request {
                Request::Generate(r) => {
                    let schema = super::metadata::get_ai_schema_context(
                        &private_runtime,
                        Some(owner),
                        id,
                        Some(schema.clone()),
                        Some(database.clone()),
                    )
                    .await?;
                    if schema.len() > 65536
                        || state
                            .provisioning_revision
                            .load(std::sync::atomic::Ordering::SeqCst)
                            != revision
                    {
                        return Err("AI_UNAVAILABLE".into());
                    }
                    crate::ai::generate_query(
                        &private_runtime,
                        &self.cache,
                        crate::ai::AiGenerateRequest {
                            provider: self.config.provider.clone(),
                            model: self.config.model.clone(),
                            prompt: r.prompt.clone(),
                            schema,
                        },
                    )
                    .await?
                }
                Request::Explain(r) => {
                    crate::ai::explain_query(
                        &private_runtime,
                        &self.cache,
                        crate::ai::AiExplainRequest {
                            provider: self.config.provider.clone(),
                            model: self.config.model.clone(),
                            query: r.query.clone(),
                            language: r.language.clone(),
                        },
                    )
                    .await?
                }
            };
            let _guard = state
                .provisioning_lock
                .try_lock()
                .map_err(|_| "AI_UNAVAILABLE")?;
            if result.len() > 65536
                || state
                    .provisioning_revision
                    .load(std::sync::atomic::Ordering::SeqCst)
                    != revision
                || self.authorize(runtime, id, database, schema)? != snapshot
            {
                return Err("AI_UNAVAILABLE".into());
            }
            self.redactor
                .extend(super::connections::collect_secret_values(runtime)?);
            Ok::<_, String>(self.redactor.redact(&result))
        };
        tokio::select! {
            _ = cancelled.changed() => Err("AI_UNAVAILABLE".into()),
            result = tokio::time::timeout(Duration::from_secs(30),operation) => result.map_err(|_| "AI_UNAVAILABLE".to_string())?.map_err(|_| "AI_UNAVAILABLE".to_string()),
        }
    }
}

#[cfg(test)]
#[path = "scoped_ai_tests.rs"]
mod tests;
