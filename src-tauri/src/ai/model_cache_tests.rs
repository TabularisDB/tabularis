use super::*;
use crate::runtime::{
    events::NoopRuntimeEvents, paths::FixedRuntimePaths, secrets::RuntimeSecrets,
};
use std::sync::Arc;

struct NoSecrets;
impl RuntimeSecrets for NoSecrets {
    fn get(&self, _: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
    fn set(&self, _: &str, _: &str) -> Result<(), String> {
        unreachable!()
    }
    fn delete(&self, _: &str) -> Result<(), String> {
        unreachable!()
    }
}

#[tokio::test]
async fn account_and_custom_endpoints_keep_explicit_model_selection() {
    let dir = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(dir.path().into(), dir.path().into())),
        Arc::new(NoopRuntimeEvents),
        Arc::new(NoSecrets),
    );
    let cache = CredentialCache::default();
    for provider in ["api-route", "custom-openai"] {
        assert!(resolve_model(&runtime, &cache, provider, "")
            .await
            .unwrap_err()
            .contains("Select"));
        assert_eq!(
            resolve_model(&runtime, &cache, provider, "exact/model:id")
                .await
                .unwrap(),
            "exact/model:id"
        );
    }
    let api =
        crate::ai_assistants::read_manifest(&runtime.paths.plugins_dir(), "api-route").unwrap();
    assert_eq!(
        api.ai_assistant.api_key_env.as_deref(),
        Some("API_ROUTE_API_KEY")
    );
    assert_eq!(
        api.ai_assistant.generate.requests[0].url,
        "https://global.api-route.com/v1"
    );
    assert!(api.builtin);
}

#[test]
fn crash_analysis_retains_its_language_and_redaction_instructions() {
    let prompt = crash_analysis_system_prompt("German");
    assert!(prompt.contains("German"));
    assert!(prompt.contains("[redacted]"));
    assert!(!prompt.contains("{{LANGUAGE}}"));
}
