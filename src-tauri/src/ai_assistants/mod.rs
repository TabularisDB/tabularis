//! Declarative AI provider packages. ChatGPT account login remains host-owned.
mod http;
mod install;
mod manifest;
mod migration;
mod recipe;

pub use http::call;
pub use install::{install, recover_installations, uninstall};
pub use manifest::{
    destination, list_installed, parse_manifest, read_manifest, AssistantContract,
    AssistantManifest, Authentication, GenerationRecipe, HttpRequest, JsonFilter, ModelDiscovery,
    ModelSource, ResponseRecipe,
};
pub use migration::migrate_legacy_providers;

pub const KIND: &str = "ai-assistant";
pub const CHANGED_EVENT: &str = "tabularis://ai-providers-changed";

pub fn notify_changed(runtime: &crate::runtime::RuntimeContext) {
    let _ = runtime.events.emit(CHANGED_EVENT, serde_json::Value::Null);
}

#[cfg(test)]
mod http_tests;
#[cfg(test)]
mod tests;
