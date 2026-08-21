use crate::connection_import_commands::ImportEnvelopeCache;
use std::sync::Arc;

pub struct ApplicationState {
    pub pending_install: crate::plugins::deep_link::PendingInstall,
    pub query_cancellation: crate::commands::QueryCancellationState,
    pub export_cancellation: crate::export::ExportCancellationState,
    pub dump_cancellation: crate::dump_commands::DumpCancellationState,
    pub credential_cache: Arc<crate::credential_cache::CredentialCache>,
    pub connection_cache: Arc<crate::connection_cache::ConnectionCache>,
    pub import_envelope_cache: ImportEnvelopeCache,
    pub pending_explain_file: crate::explain_import::PendingExplainFile,
    pub json_viewer_store: crate::json_viewer::JsonViewerStore,
    pub results_window_store: crate::results_window::ResultsWindowStore,
    pub query_history_state: crate::query_history::QueryHistoryState,
}

impl Default for ApplicationState {
    fn default() -> Self {
        Self {
            pending_install: crate::plugins::deep_link::PendingInstall::default(),
            query_cancellation: crate::commands::QueryCancellationState::default(),
            export_cancellation: crate::export::ExportCancellationState::default(),
            dump_cancellation: crate::dump_commands::DumpCancellationState::default(),
            credential_cache: Arc::new(crate::credential_cache::CredentialCache::default()),
            connection_cache: Arc::new(crate::connection_cache::ConnectionCache::default()),
            import_envelope_cache: ImportEnvelopeCache::default(),
            pending_explain_file: crate::explain_import::PendingExplainFile::default(),
            json_viewer_store: crate::json_viewer::JsonViewerStore::default(),
            results_window_store: crate::results_window::ResultsWindowStore::default(),
            query_history_state: crate::query_history::QueryHistoryState::default(),
        }
    }
}
