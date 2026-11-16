use crate::application::connection_files::ImportEnvelopeCache;
use crate::commands::AbortHandleMap;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

pub struct ApplicationState {
    pub pending_install: Arc<crate::plugins::deep_link::PendingInstall>,
    pub query_cancellation: Arc<crate::commands::QueryCancellationState>,
    pub export_cancellation: Arc<crate::export::ExportCancellationState>,
    pub dump_cancellation: Arc<crate::dump_commands::DumpCancellationState>,
    pub credential_cache: Arc<crate::credential_cache::CredentialCache>,
    pub connection_cache: Arc<crate::connection_cache::ConnectionCache>,
    pub import_envelope_cache: Arc<ImportEnvelopeCache>,
    pub pending_explain_file: Arc<crate::explain_import::PendingExplainFile>,
    pub web_active_connections: Mutex<HashMap<Uuid, HashSet<String>>>,
    pub web_approval_owners: Mutex<HashMap<String, Uuid>>,
    pub web_preferences:
        Mutex<HashMap<Uuid, crate::application::persistence::WebSessionPreferences>>,
}

impl ApplicationState {
    pub fn abort_background_jobs(&self) {
        abort_all(&self.query_cancellation.handles);
        abort_all(&self.export_cancellation.handles);
        abort_all(&self.dump_cancellation.handles);
    }
}

fn abort_all(handles: &Arc<Mutex<AbortHandleMap>>) {
    let pending = {
        let mut handles = handles.lock().unwrap_or_else(|error| error.into_inner());
        handles
            .drain()
            .flat_map(|(_, handles)| handles)
            .collect::<Vec<_>>()
    };

    for handle in pending {
        handle.abort();
    }
}

impl Default for ApplicationState {
    fn default() -> Self {
        Self {
            pending_install: Arc::new(crate::plugins::deep_link::PendingInstall::default()),
            query_cancellation: Arc::new(crate::commands::QueryCancellationState::default()),
            export_cancellation: Arc::new(crate::export::ExportCancellationState::default()),
            dump_cancellation: Arc::new(crate::dump_commands::DumpCancellationState::default()),
            credential_cache: Arc::new(crate::credential_cache::CredentialCache::default()),
            connection_cache: Arc::new(crate::connection_cache::ConnectionCache::default()),
            import_envelope_cache: Arc::new(ImportEnvelopeCache::default()),
            pending_explain_file: Arc::new(crate::explain_import::PendingExplainFile::default()),
            web_active_connections: Mutex::new(HashMap::new()),
            web_approval_owners: Mutex::new(HashMap::new()),
            web_preferences: Mutex::new(HashMap::new()),
        }
    }
}
