use super::*;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode, Uri},
    routing::any,
    Json, Router,
};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

#[derive(Clone)]
struct FixtureState {
    responses: Arc<Mutex<VecDeque<(StatusCode, Value)>>>,
    captured: Arc<Mutex<Vec<(String, HeaderMap, Value)>>>,
}

async fn handle(
    State(state): State<FixtureState>,
    uri: Uri,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> (StatusCode, Json<Value>) {
    let request = serde_json::from_slice(&body).unwrap_or(Value::Null);
    state
        .captured
        .lock()
        .unwrap()
        .push((uri.to_string(), headers, request));
    let (status, body) = state.responses.lock().unwrap().pop_front().unwrap();
    (status, Json(body))
}

async fn fixture(
    responses: Vec<(StatusCode, Value)>,
) -> (
    std::net::SocketAddr,
    FixtureState,
    tokio::task::JoinHandle<()>,
) {
    let state = FixtureState {
        responses: Arc::new(Mutex::new(responses.into())),
        captured: Default::default(),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = Router::new()
        .fallback(any(handle))
        .with_state(state.clone());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (addr, state, task)
}

fn route(request: &mut HttpRequest, addr: std::net::SocketAddr) {
    if request.url.contains("{{") {
        request.url = format!("http://{addr}");
    } else {
        let mut url = url::Url::parse(&request.url).unwrap();
        url.set_scheme("http").unwrap();
        url.set_host(Some("127.0.0.1")).unwrap();
        url.set_port(Some(addr.port())).unwrap();
        request.url = url.to_string();
    }
}

#[tokio::test]
async fn every_provider_generates_through_the_same_declarative_http_runtime() {
    for id in [
        "openai",
        "anthropic",
        "ollama",
        "openrouter",
        "requesty",
        "minimax",
        "custom-openai",
        "api-route",
        "opper",
        "runcrate",
    ] {
        let response = match id {
            "anthropic" => {
                json!({"content":[{"type":"thinking"},{"type":"text","text":"SELECT 1;"}]})
            }
            "ollama" => json!({"message":{"content":"SELECT 1;"}}),
            _ => json!({"choices":[{"message":{"content":"SELECT 1;"}}]}),
        };
        let (addr, state, task) = fixture(vec![(StatusCode::OK, response)]).await;
        let mut manifest = parse_manifest(tests::package(id).to_string().as_bytes()).unwrap();
        for request in &mut manifest.ai_assistant.generate.requests {
            route(request, addr);
        }
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let result = http::execute(&client,&manifest,&json!({"settings":{},"model":"fixture-model","prompt":"count users","system_prompt":"SQL instructions"}),Some("fixture-key"),"generate").await.unwrap();
        assert_eq!(result, "SELECT 1;", "{id}");
        let captured = state.captured.lock().unwrap();
        let (_, headers, body) = &captured[0];
        assert_eq!(body["model"], "fixture-model");
        if id == "anthropic" {
            assert_eq!(headers["x-api-key"], "fixture-key");
            assert!(body.get("temperature").is_none());
            assert_eq!(body["system"], "SQL instructions");
        } else if id == "ollama" {
            assert!(!headers.contains_key("authorization"));
            assert_eq!(body["stream"], false);
        } else {
            assert_eq!(headers["authorization"], "Bearer fixture-key");
            assert_eq!(body["messages"][0]["content"], "SQL instructions");
        }
        if id == "opper" {
            assert_eq!(headers["x-opper-name"], "tabularis");
        }
        task.abort();
    }
}

#[tokio::test]
async fn model_filters_cover_both_open_provider_pull_requests() {
    for (id, response, expected) in [
        (
            "runcrate",
            json!({"data":[{"id":"chat","output_modalities":["text"]},{"id":"image","output_modalities":["image"]},{"id":"unknown"}]}),
            "chat",
        ),
        (
            "opper",
            json!({"models":[{"model":"chat","type":"llm","pooled":true},{"model":"image","type":"image","pooled":true},{"model":"pinned","type":"llm","pooled":false}]}),
            "chat",
        ),
    ] {
        let (addr, state, task) = fixture(vec![(StatusCode::OK, response)]).await;
        let mut manifest = parse_manifest(tests::package(id).to_string().as_bytes()).unwrap();
        manifest.ai_assistant.default_models.clear();
        route(&mut manifest.ai_assistant.models.sources[0].request, addr);
        let result = http::execute(
            &reqwest::Client::builder().no_proxy().build().unwrap(),
            &manifest,
            &json!({"settings":{}}),
            None,
            "list_models",
        )
        .await
        .unwrap();
        assert_eq!(result, json!([expected]));
        assert!(!state.captured.lock().unwrap()[0]
            .1
            .contains_key("authorization"));
        task.abort();
    }
}

#[tokio::test]
async fn optional_key_is_omitted_and_minimax_retries_its_second_endpoint() {
    let (addr, state, task) = fixture(vec![(
        StatusCode::OK,
        json!({"choices":[{"message":{"content":"SELECT 1;"}}]}),
    )])
    .await;
    let mut manifest =
        parse_manifest(tests::package("custom-openai").to_string().as_bytes()).unwrap();
    route(&mut manifest.ai_assistant.generate.requests[0], addr);
    let variables = json!({"settings":{},"model":"local","prompt":"p","system_prompt":"s"});
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    assert!(
        http::execute(&client, &manifest, &variables, None, "generate")
            .await
            .is_ok()
    );
    assert!(!state.captured.lock().unwrap()[0]
        .1
        .contains_key("authorization"));
    task.abort();
    let (addr, state, task) = fixture(vec![
        (StatusCode::BAD_GATEWAY, json!({})),
        (
            StatusCode::OK,
            json!({"choices":[{"message":{"content":"SELECT 2;"}}]}),
        ),
    ])
    .await;
    let mut manifest = parse_manifest(tests::package("minimax").to_string().as_bytes()).unwrap();
    for request in &mut manifest.ai_assistant.generate.requests {
        route(request, addr);
    }
    assert_eq!(
        http::execute(&client, &manifest, &variables, Some("key"), "generate")
            .await
            .unwrap(),
        "SELECT 2;"
    );
    assert_eq!(state.captured.lock().unwrap().len(), 2);
    task.abort();
}

#[tokio::test]
async fn providers_without_authentication_never_read_the_keychain() {
    struct UnavailableSecrets;
    impl crate::runtime::secrets::RuntimeSecrets for UnavailableSecrets {
        fn get(&self, _: &str) -> Result<Option<String>, String> {
            panic!("A local provider must not access the keychain")
        }
        fn set(&self, _: &str, _: &str) -> Result<(), String> {
            unreachable!()
        }
        fn delete(&self, _: &str) -> Result<(), String> {
            unreachable!()
        }
    }
    let (addr, _state, task) = fixture(vec![(
        StatusCode::OK,
        json!({"models":[{"name":"local-model"}]}),
    )])
    .await;
    let temp = tempfile::tempdir().unwrap();
    let runtime = crate::runtime::RuntimeContext::new(
        Arc::new(crate::runtime::paths::FixedRuntimePaths::new(
            temp.path().join("config"),
            temp.path().join("data"),
        )),
        Arc::new(crate::runtime::events::NoopRuntimeEvents),
        Arc::new(UnavailableSecrets),
    );
    std::fs::create_dir_all(runtime.paths.config_dir()).unwrap();
    let mut manifest = tests::package("ollama");
    manifest["ai_assistant"]["models"]["sources"][0]["request"]["url"] =
        json!(format!("http://{addr}"));
    manifest["id"] = json!("local-fixture");
    let directory = destination(&runtime.paths.plugins_dir(), "local-fixture").unwrap();
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join(".tabularium"), manifest.to_string()).unwrap();
    let result = call(
        &runtime,
        &crate::credential_cache::CredentialCache::default(),
        "local-fixture",
        "list_models",
        Value::Null,
    )
    .await
    .unwrap();
    assert_eq!(result, json!(["local-model"]));
    task.abort();
}

#[tokio::test]
async fn gemini_native_api_supports_model_resources_settings_and_filtered_discovery() {
    let (addr, state, task) = fixture(vec![
        (StatusCode::OK, json!({"models":[{"name":"models/gemini-test","supportedGenerationMethods":["generateContent"]},{"name":"models/embed","supportedGenerationMethods":["embedContent"]}]})),
        (StatusCode::OK, json!({"candidates":[{"content":{"parts":[{"thought":true,"text":"private reasoning"},{"text":"SELECT 1;"}]}}]})),
    ]).await;
    let mut manifest = parse_manifest(tests::package("gemini").to_string().as_bytes()).unwrap();
    manifest.ai_assistant.default_models.clear();
    route(&mut manifest.ai_assistant.models.sources[0].request, addr);
    manifest.ai_assistant.generate.requests[0].url =
        format!("http://{addr}/v1beta/{{{{model}}}}:generateContent");
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let models = http::execute(
        &client,
        &manifest,
        &json!({"settings":{}}),
        Some("fixture-key"),
        "list_models",
    )
    .await
    .unwrap();
    assert_eq!(models, json!(["models/gemini-test"]));
    let result = http::execute(&client, &manifest, &json!({"settings":{},"model":"models/gemini-test","prompt":"Count customers","system_prompt":"SQL only"}), Some("fixture-key"), "generate").await.unwrap();
    assert_eq!(result, "SELECT 1;");
    let captured = state.captured.lock().unwrap();
    assert_eq!(captured[1].0, "/v1beta/models/gemini-test:generateContent");
    assert_eq!(captured[1].1["x-goog-api-key"], "fixture-key");
    assert!(!captured[1].1.contains_key("authorization"));
    assert_eq!(
        captured[1].2["systemInstruction"]["parts"][0]["text"],
        "SQL only"
    );
    assert_eq!(
        captured[1].2["contents"][0]["parts"][0]["text"],
        "Count customers"
    );
    task.abort();
}

struct CacheSecrets;
impl crate::runtime::secrets::RuntimeSecrets for CacheSecrets {
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

fn cache_provider(
    runtime: &crate::runtime::RuntimeContext,
    id: &str,
    addr: std::net::SocketAddr,
) -> AssistantManifest {
    let mut value = tests::package("custom-openai");
    value["id"] = json!(id);
    value["ai_assistant"]["authentication"] = json!("none");
    value["ai_assistant"]
        .as_object_mut()
        .unwrap()
        .remove("api_key_env");
    value["ai_assistant"]["direct"] = json!(true);
    value["ai_assistant"]["models"]["cache_seconds"] = json!(86400);
    value["ai_assistant"]["models"]["sources"][0]["request"]["url"] =
        json!(format!("http://{addr}/v1"));
    let dir = destination(&runtime.paths.plugins_dir(), id).unwrap();
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(".tabularium"), value.to_string()).unwrap();
    parse_manifest(value.to_string().as_bytes()).unwrap()
}

fn cache_runtime(dir: &std::path::Path) -> crate::runtime::RuntimeContext {
    let runtime = crate::runtime::RuntimeContext::new(
        Arc::new(crate::runtime::paths::FixedRuntimePaths::new(
            dir.join("config"),
            dir.join("data"),
        )),
        Arc::new(crate::runtime::events::NoopRuntimeEvents),
        Arc::new(CacheSecrets),
    );
    std::fs::create_dir_all(runtime.paths.config_dir()).unwrap();
    runtime
}

fn cache_value(runtime: &crate::runtime::RuntimeContext) -> Value {
    serde_json::from_slice(
        &std::fs::read(runtime.paths.config_dir().join("ai_models_cache.json")).unwrap(),
    )
    .unwrap()
}

#[tokio::test]
async fn failed_discovery_retains_the_catalog_age_and_retries_when_service_recovers() {
    for (status, response) in [
        (
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"error":"temporary failure"}),
        ),
        (StatusCode::OK, json!({"unexpected":"not a catalog"})),
    ] {
        let (addr, state, server) = fixture(vec![
            (status, response),
            (StatusCode::OK, json!({"data":[{"id":"recovered"}]})),
            (StatusCode::SERVICE_UNAVAILABLE, json!({})),
            (StatusCode::OK, json!({"data":[]})),
        ])
        .await;
        let temp = tempfile::tempdir().unwrap();
        let runtime = cache_runtime(temp.path());
        let manifest = cache_provider(&runtime, "cache-recovery", addr);
        let cache = crate::credential_cache::CredentialCache::default();
        let path = runtime.paths.config_dir().join("ai_models_cache.json");
        let initial = json!({"last_updated":123,"models":{"cache-recovery":["last-good"]},"fetched_at":{"cache-recovery":123}});
        std::fs::write(&path, initial.to_string()).unwrap();
        assert_eq!(
            crate::ai::get_provider_models(&runtime, &cache, &manifest, false).await,
            ["last-good"]
        );
        assert_eq!(
            cache_value(&runtime),
            initial,
            "failure must not change the successful catalog or age"
        );
        assert_eq!(
            crate::ai::get_provider_models(&runtime, &cache, &manifest, false).await,
            ["recovered"]
        );
        let recovered = cache_value(&runtime);
        assert_eq!(
            crate::ai::get_provider_models(&runtime, &cache, &manifest, true).await,
            ["recovered"]
        );
        assert_eq!(
            cache_value(&runtime),
            recovered,
            "forced failure must retain the successful entry too"
        );
        assert!(
            crate::ai::get_provider_models(&runtime, &cache, &manifest, true)
                .await
                .is_empty()
        );
        assert_eq!(
            cache_value(&runtime)["models"]["cache-recovery"],
            json!([]),
            "an empty successful response is an intentional catalog change"
        );
        assert_eq!(state.captured.lock().unwrap().len(), 4);
        server.abort();
    }
}

#[tokio::test]
async fn overlapping_discoveries_merge_into_the_latest_cache_instead_of_an_old_snapshot() {
    use std::future::Future;
    for (status, response, expected) in [
        (
            StatusCode::OK,
            json!({"data":[{"id":"fresh-a"}]}),
            "fresh-a",
        ),
        (StatusCode::SERVICE_UNAVAILABLE, json!({}), "old-a"),
    ] {
        let (addr_a, _, server_a) = fixture(vec![(status, response)]).await;
        let (addr_b, _, server_b) =
            fixture(vec![(StatusCode::OK, json!({"data":[{"id":"fresh-b"}]}))]).await;
        let temp = tempfile::tempdir().unwrap();
        let runtime = cache_runtime(temp.path());
        let a = cache_provider(&runtime, "cache-a", addr_a);
        let b = cache_provider(&runtime, "cache-b", addr_b);
        std::fs::write(runtime.paths.config_dir().join("ai_models_cache.json"), json!({"last_updated":123,"models":{"cache-a":["old-a"],"cache-b":["old-b"]},"fetched_at":{"cache-a":123,"cache-b":123}}).to_string()).unwrap();
        let cache = crate::credential_cache::CredentialCache::default();
        let mut pending = Box::pin(crate::ai::get_provider_models(&runtime, &cache, &a, false));
        std::future::poll_fn(|cx| {
            assert!(pending.as_mut().poll(cx).is_pending());
            std::task::Poll::Ready(())
        })
        .await;
        assert_eq!(
            crate::ai::get_provider_models(&runtime, &cache, &b, false).await,
            ["fresh-b"]
        );
        let intermediate = cache_value(&runtime);
        assert_eq!(pending.await, [expected]);
        let final_cache = cache_value(&runtime);
        assert_eq!(final_cache["models"]["cache-a"], json!([expected]));
        assert_eq!(final_cache["models"]["cache-b"], json!(["fresh-b"]));
        assert_eq!(
            final_cache["fetched_at"]["cache-b"],
            intermediate["fetched_at"]["cache-b"]
        );
        if !status.is_success() {
            assert_eq!(final_cache["fetched_at"]["cache-a"], 123);
        }
        server_a.abort();
        server_b.abort();
    }
}
