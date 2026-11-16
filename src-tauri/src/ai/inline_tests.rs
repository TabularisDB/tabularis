use super::*;

fn request() -> InlineRequest {
    InlineRequest {
        request_id: "test".into(),
        provider: "ollama".into(),
        model: "local".into(),
        prefix: "SELECT ".into(),
        suffix: ";".into(),
        schema: "users".into(),
        dialect: "postgres".into(),
    }
}

#[test]
fn fenced_json_preserves_insertion_whitespace_and_keeps_strict_validation() {
    let json = r#"{"completion":" FROM users\n"}"#;
    for tag in ["", "json", "JSON"] {
        let response = format!("  ```{tag}\r\n{json}\r\n```  ");
        assert_eq!(completion(&response).unwrap(), " FROM users\n");
    }
    for json in [
        r#"{"completion":"x","command":"execute"}"#,
        r#"{"completion":"\u0000"}"#,
        "SELECT 1",
    ] {
        assert!(completion(&format!("```json\n{json}\n```")).is_err());
    }
    let large = serde_json::json!({"completion": "x".repeat(2001)}).to_string();
    assert!(completion(&format!("```json\n{large}\n```")).is_err());
}

#[test]
fn context_and_response_limits_are_enforced_without_losing_whitespace() {
    assert!(validate(&request()).is_ok());
    let mut large = request();
    large.prefix = "x".repeat(4001);
    assert!(validate(&large).is_err());
    let mut large = request();
    large.suffix = "x".repeat(1001);
    assert!(validate(&large).is_err());
    let mut large = request();
    large.schema = "x".repeat(8001);
    assert!(validate(&large).is_err());
    assert_eq!(
        completion(r#"{"completion":" FROM users\n"}"#).unwrap(),
        " FROM users\n"
    );
    assert!(completion("SELECT 1").is_err());
    assert!(completion(r#"{"completion":"x","command":"execute"}"#).is_err());
    assert!(completion(&serde_json::json!({"completion": "x".repeat(2001)}).to_string()).is_err());
}

#[tokio::test]
async fn cancellation_drops_the_provider_future_and_is_owner_scoped() {
    let requests = Requests::default();
    let owner = Uuid::new_v4();
    let key = ("/config".into(), Some(owner), "request".into());
    let (guard, registration) = requests.register(key.clone()).unwrap();
    let wrong_owner = ("/config".into(), Some(Uuid::new_v4()), "request".into());
    requests.cancel(wrong_owner).unwrap();
    assert!(!registration.handle().is_aborted());
    struct Dropped(std::sync::Arc<std::sync::atomic::AtomicBool>);
    impl Drop for Dropped {
        fn drop(&mut self) {
            self.0.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }
    let dropped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let sentinel = Dropped(dropped.clone());
    let future = async move {
        let _sentinel = sentinel;
        std::future::pending::<()>().await
    };
    {
        let future = Abortable::new(future, registration);
        futures::pin_mut!(future);
        assert!(futures::poll!(&mut future).is_pending());
        requests.cancel(key.clone()).unwrap();
        assert!(future.await.is_err());
    }
    assert!(dropped.load(std::sync::atomic::Ordering::SeqCst));
    drop(guard);
    assert!(!requests.0.lock().unwrap().contains_key(&key));
}

#[test]
fn early_cancel_duplicate_requests_and_capacity_are_safe() {
    let requests = Requests::default();
    let key = ("/config".into(), None, "early".into());
    requests.cancel(key.clone()).unwrap();
    assert!(requests.register(key).is_err());
    let key = ("/config".into(), None, "running".into());
    let (_guard, _) = requests.register(key.clone()).unwrap();
    assert!(requests.register(key).is_err());
    for n in 0..130 {
        requests
            .cancel(("/config".into(), None, format!("cancel-{n}")))
            .unwrap();
    }
    assert_eq!(requests.0.lock().unwrap().len(), 128);
    assert!(requests
        .register(("/config".into(), None, "overflow".into()))
        .is_err());
}
