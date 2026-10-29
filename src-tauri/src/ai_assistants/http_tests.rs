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
    let directory = destination(&runtime.paths.plugins_dir(), "ollama").unwrap();
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join(".tabularium"), manifest.to_string()).unwrap();
    let result = call(
        &runtime,
        &crate::credential_cache::CredentialCache::default(),
        "ollama",
        "list_models",
        Value::Null,
    )
    .await
    .unwrap();
    assert_eq!(result, json!(["local-model"]));
    task.abort();
}
