pub mod bootstrap;
pub mod events;
pub mod lifecycle;
pub mod paths;
pub mod secrets;
pub mod state;

use events::RuntimeEvents;
use paths::RuntimePaths;
use secrets::RuntimeSecrets;
use std::sync::Arc;

#[derive(Clone)]
pub struct RuntimeContext {
    pub paths: Arc<dyn RuntimePaths>,
    pub events: Arc<dyn RuntimeEvents>,
    pub secrets: Arc<dyn RuntimeSecrets>,
}

impl RuntimeContext {
    pub fn new(
        paths: Arc<dyn RuntimePaths>,
        events: Arc<dyn RuntimeEvents>,
        secrets: Arc<dyn RuntimeSecrets>,
    ) -> Self {
        Self {
            paths,
            events,
            secrets,
        }
    }

    pub fn system() -> Self {
        Self::new(
            Arc::new(paths::FixedRuntimePaths::system()),
            Arc::new(events::NoopRuntimeEvents),
            Arc::new(secrets::KeyringRuntimeSecrets),
        )
    }
}

#[cfg(test)]
mod tests;
