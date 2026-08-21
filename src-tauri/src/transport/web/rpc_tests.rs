use super::*;
use async_trait::async_trait;
use axum::body::to_bytes;
use axum::http::header::CONTENT_TYPE;
use axum::http::HeaderValue;

struct FixtureApplication {
    delay: Duration,
    contexts: Arc<Mutex<Vec<ApplicationRequestContext>>>,
}

impl FixtureApplication {
    fn new(delay: Duration) -> Self {
        Self {
            delay,
            contexts: Arc::new(Mutex::new(Vec::new())),
        }
    }

    async fn record(&self, context: ApplicationRequestContext) {
        self.contexts
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push(context);
        tokio::time::sleep(self.delay).await;
    }
}

#[async_trait]
impl ApplicationApi for FixtureApplication {
    async fn is_debug_mode(
        &self,
        context: ApplicationRequestContext,
    ) -> Result<bool, ApplicationError> {
        self.record(context).await;
        Ok(true)
    }

    async fn get_connections(
        &self,
        context: ApplicationRequestContext,
    ) -> Result<Vec<crate::models::SavedConnection>, ApplicationError> {
        self.record(context).await;
        Ok(Vec::new())
    }

    async fn cancel_query(
        &self,
        context: ApplicationRequestContext,
        _connection_id: String,
    ) -> Result<(), ApplicationError> {
        self.record(context).await;
        Err(ApplicationError::new("No running query found"))
    }

    async fn execute_connection_command(
        &self,
        context: ApplicationRequestContext,
        _command: ConnectionCommand,
    ) -> Result<Value, ApplicationError> {
        self.record(context).await;
        Ok(Value::Null)
    }

    async fn execute_metadata_command(
        &self,
        context: ApplicationRequestContext,
        _command: MetadataCommand,
    ) -> Result<Value, ApplicationError> {
        self.record(context).await;
        Ok(Value::Null)
    }

    async fn execute_tunnel_command(
        &self,
        context: ApplicationRequestContext,
        _command: TunnelCommand,
    ) -> Result<Value, ApplicationError> {
        self.record(context).await;
        Ok(Value::Null)
    }
}

fn json_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers
}

async fn response_json(response: Response) -> Value {
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&body).unwrap()
}

#[tokio::test]
async fn preserves_shared_serialization_fixture_in_success_envelopes() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../../packages/web-ui/tests/fixtures/transportSerialization.json"
    ))
    .unwrap();

    let body = response_json(success(fixture.clone())).await;

    assert_eq!(body, serde_json::json!({ "ok": true, "data": fixture }));
    assert_eq!(
        body["data"]["rows"][0][1],
        "BLOB:4:application/octet-stream:AAECAw=="
    );
    assert_eq!(body["data"]["rows"][0][2], "12345678901234567890.123456789");
    assert_eq!(body["data"]["rows"][0][3], "2026-08-21T19:20:21.123Z");
    assert!(body["data"]["rows"][0][4].is_null());
}

#[test]
fn declares_authorization_for_each_registered_command() {
    assert_eq!(
        RpcCommand::IsDebugMode.metadata().authorization,
        AuthorizationLevel::LocalAdmin
    );
    assert_eq!(
        RpcCommand::GetConnections.metadata().authorization,
        AuthorizationLevel::Database
    );
    assert_eq!(
        RpcCommand::CancelQuery.metadata().authorization,
        AuthorizationLevel::Database
    );
    assert_eq!(
        RpcCommand::Metadata(MetadataRpcCommand::GetTables)
            .metadata()
            .authorization,
        AuthorizationLevel::Database
    );
    assert_eq!(
        RpcCommand::Tunnel(TunnelRpcCommand::GetSshConnections)
            .metadata()
            .authorization,
        AuthorizationLevel::LocalAdmin
    );
    assert_eq!(
        RpcCommand::Tunnel(TunnelRpcCommand::RespondSshAskpass)
            .metadata()
            .authorization,
        AuthorizationLevel::Sensitive
    );
}

#[tokio::test]
async fn routes_all_metadata_commands_through_the_shared_application_api() {
    let dispatcher = RpcDispatcher::new(Arc::new(FixtureApplication::new(Duration::ZERO)));
    let commands = [
        (
            "get_available_databases",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
        (
            "get_schemas",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
        (
            "get_tables",
            serde_json::json!({"connectionId": "connection-1", "schema": "public"}),
        ),
        (
            "get_columns",
            serde_json::json!({"connectionId": "connection-1", "tableName": "users"}),
        ),
        (
            "get_foreign_keys",
            serde_json::json!({"connectionId": "connection-1", "tableName": "users"}),
        ),
        (
            "get_indexes",
            serde_json::json!({"connectionId": "connection-1", "tableName": "users"}),
        ),
        (
            "get_views",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
        (
            "get_view_columns",
            serde_json::json!({"connectionId": "connection-1", "viewName": "users_view"}),
        ),
        (
            "get_materialized_views",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
        (
            "get_materialized_view_columns",
            serde_json::json!({"connectionId": "connection-1", "viewName": "users_view"}),
        ),
        (
            "get_materialized_view_definition",
            serde_json::json!({"connectionId": "connection-1", "viewName": "users_view"}),
        ),
        (
            "get_routines",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
        (
            "get_triggers",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
        (
            "get_schema_snapshot",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
        (
            "get_selected_schemas",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
        (
            "set_selected_schemas",
            serde_json::json!({"connectionId": "connection-1", "schemas": ["public"]}),
        ),
        (
            "get_schema_preference",
            serde_json::json!({"connectionId": "connection-1"}),
        ),
        (
            "set_schema_preference",
            serde_json::json!({"connectionId": "connection-1", "schema": "public"}),
        ),
    ];

    for (command, payload) in commands {
        let response = dispatcher
            .dispatch(
                command,
                RequestId(format!("request-{command}")),
                &json_headers(),
                Bytes::from(serde_json::to_vec(&payload).unwrap()),
                None,
            )
            .await;
        assert_eq!(response.status(), StatusCode::OK, "{command}");
    }
}

#[tokio::test]
async fn rejects_invalid_payloads_with_a_stable_error_envelope() {
    let dispatcher = RpcDispatcher::new(Arc::new(FixtureApplication::new(Duration::ZERO)));
    let response = dispatcher
        .dispatch(
            "cancel_query",
            RequestId("request-invalid".to_string()),
            &json_headers(),
            Bytes::from_static(br#"{"unknown":true}"#),
            None,
        )
        .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = response_json(response).await;
    assert_eq!(body["ok"], false);
    assert_eq!(body["error"]["code"], "INVALID_REQUEST");
    assert_eq!(body["error"]["details"], Value::Null);
    assert_eq!(body["error"]["requestId"], "request-invalid");
    assert!(body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("unknown field `unknown`"));
}

#[tokio::test]
async fn enforces_deadlines_and_releases_cancellation_identifiers() {
    let application = Arc::new(FixtureApplication::new(Duration::from_millis(40)));
    let dispatcher = RpcDispatcher::new(application.clone());
    let mut deadline_headers = json_headers();
    deadline_headers.insert(RPC_DEADLINE_HEADER_NAME, HeaderValue::from_static("1"));
    deadline_headers.insert(
        RPC_CANCELLATION_HEADER_NAME,
        HeaderValue::from_static("query-1"),
    );

    let timeout = dispatcher
        .dispatch(
            "is_debug_mode",
            RequestId("request-timeout".to_string()),
            &deadline_headers,
            Bytes::from_static(b"null"),
            None,
        )
        .await;
    assert_eq!(timeout.status(), StatusCode::GATEWAY_TIMEOUT);
    assert_eq!(
        response_json(timeout).await["error"]["code"],
        "DEADLINE_EXCEEDED"
    );

    let retry = dispatcher
        .dispatch(
            "is_debug_mode",
            RequestId("request-retry".to_string()),
            &json_headers_with_cancellation("query-1"),
            Bytes::from_static(b"null"),
            None,
        )
        .await;
    assert_eq!(retry.status(), StatusCode::OK);

    let contexts = application
        .contexts
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    assert_eq!(contexts.len(), 2);
    assert_eq!(contexts[0].request_id, "request-timeout");
    assert_eq!(contexts[0].cancellation_id.as_deref(), Some("query-1"));
    assert_eq!(contexts[0].authorization, AuthorizationLevel::LocalAdmin);
    assert!(contexts[0].deadline <= Instant::now());
}

#[tokio::test]
async fn rejects_duplicate_active_cancellation_identifiers() {
    let dispatcher =
        RpcDispatcher::new(Arc::new(FixtureApplication::new(Duration::from_millis(40))));
    let first_dispatcher = dispatcher.clone();
    let first = tokio::spawn(async move {
        first_dispatcher
            .dispatch(
                "is_debug_mode",
                RequestId("request-first".to_string()),
                &json_headers_with_cancellation("shared"),
                Bytes::from_static(b"null"),
                None,
            )
            .await
    });
    tokio::time::sleep(Duration::from_millis(5)).await;

    let duplicate = dispatcher
        .dispatch(
            "is_debug_mode",
            RequestId("request-duplicate".to_string()),
            &json_headers_with_cancellation("shared"),
            Bytes::from_static(b"null"),
            None,
        )
        .await;
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(duplicate).await["error"]["code"],
        "CANCELLATION_ID_IN_USE"
    );
    assert_eq!(first.await.unwrap().status(), StatusCode::OK);
}

fn json_headers_with_cancellation(id: &str) -> HeaderMap {
    let mut headers = json_headers();
    headers.insert(
        RPC_CANCELLATION_HEADER_NAME,
        HeaderValue::from_str(id).unwrap(),
    );
    headers
}
