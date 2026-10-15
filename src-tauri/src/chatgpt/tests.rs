use super::{
    inference::request_body,
    protocol::{self, ResponseStream},
    storage::{self, Profile, Store, Tokens},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use openssl::{hash::MessageDigest, pkey::PKey, rsa::Rsa, sign::Signer};
use serde_json::{json, Value};

#[test]
fn pkce_matches_rfc7636_example() {
    assert_eq!(
        protocol::challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
    let a = protocol::random().unwrap();
    assert_eq!(a.len(), 43);
    assert_ne!(a, protocol::random().unwrap());
}

#[test]
fn callback_requires_state_code_and_issued_client() {
    let result = protocol::parse_callback(
        "/auth/callback?state=state&code=code&client_id=oaiapp_new",
        "state",
        None,
    )
    .unwrap();
    assert_eq!(result.client_id, "oaiapp_new");
    assert_eq!(result.code, "code");
    for target in [
        "/callback?state=state&code=code&client_id=oaiapp_new",
        "/auth/callback?state=wrong&code=code&client_id=oaiapp_new",
        "/auth/callback?code=code&client_id=oaiapp_new",
        "/auth/callback?state=state&code=code",
        "/auth/callback?state=state&code=code&client_id=dynamic_agent_client",
        "/auth/callback?state=state&code=&client_id=oaiapp_new",
        "/auth/callback?state=state&state=state&code=code&client_id=oaiapp_new",
        "/auth/callback?state=state&error=access_denied&code=code&client_id=oaiapp_new",
    ] {
        assert!(
            protocol::parse_callback(target, "state", None).is_err(),
            "{target}"
        );
    }
}

#[test]
fn returning_callback_reuses_only_the_selected_client() {
    assert_eq!(
        protocol::parse_callback("/auth/callback?state=s&code=c", "s", Some("oaiapp_saved"))
            .unwrap()
            .client_id,
        "oaiapp_saved"
    );
    assert!(protocol::parse_callback(
        "/auth/callback?state=s&code=c&client_id=oaiapp_other",
        "s",
        Some("oaiapp_saved")
    )
    .is_err());
}

fn signed_identity(claims: Value, alg: &str) -> (String, Value) {
    let rsa = Rsa::generate(2048).unwrap();
    let jwks = json!({ "keys": [{ "kid": "test", "kty": "RSA", "alg": "RS256", "use": "sig", "n": URL_SAFE_NO_PAD.encode(rsa.n().to_vec()), "e": URL_SAFE_NO_PAD.encode(rsa.e().to_vec()) }] });
    let key = PKey::from_rsa(rsa).unwrap();
    let message = format!(
        "{}.{}",
        URL_SAFE_NO_PAD.encode(json!({ "alg": alg, "kid": "test" }).to_string()),
        URL_SAFE_NO_PAD.encode(claims.to_string())
    );
    let mut signer = Signer::new(MessageDigest::sha256(), &key).unwrap();
    signer.update(message.as_bytes()).unwrap();
    (
        format!(
            "{message}.{}",
            URL_SAFE_NO_PAD.encode(signer.sign_to_vec().unwrap())
        ),
        jwks,
    )
}

fn claims() -> Value {
    json!({ "iss": super::ISSUER, "sub": "subject", "aud": "oaiapp_test", "exp": 2000, "nonce": "nonce", "email": "test@example.com" })
}

#[test]
fn verifies_identity_signature_and_security_claims() {
    let (token, jwks) = signed_identity(claims(), "RS256");
    let identity = protocol::verify_identity(&token, &jwks, "oaiapp_test", "nonce", 1000).unwrap();
    assert_eq!(identity.sub, "subject");
    assert!(protocol::verify_identity(&token, &jwks, "other", "nonce", 1000).is_err());
    assert!(protocol::verify_identity(&token, &jwks, "oaiapp_test", "other", 1000).is_err());
    assert!(protocol::verify_identity(&token, &jwks, "oaiapp_test", "nonce", 2000).is_err());
    let mut parts = token.split('.').map(str::to_string).collect::<Vec<_>>();
    parts[1] = URL_SAFE_NO_PAD.encode(json!({"sub":"forged"}).to_string());
    assert!(
        protocol::verify_identity(&parts.join("."), &jwks, "oaiapp_test", "nonce", 1000).is_err()
    );
    for (field, value) in [
        ("iss", json!("https://evil.example")),
        ("sub", json!("")),
        ("nbf", json!(1001)),
        ("aud", json!(["oaiapp_test", "other"])),
        ("azp", json!("other")),
    ] {
        let mut invalid = claims();
        invalid[field] = value;
        let (token, jwks) = signed_identity(invalid, "RS256");
        assert!(
            protocol::verify_identity(&token, &jwks, "oaiapp_test", "nonce", 1000).is_err(),
            "{field}"
        );
    }
    let (token, jwks) = signed_identity(claims(), "none");
    assert!(protocol::verify_identity(&token, &jwks, "oaiapp_test", "nonce", 1000).is_err());
}

#[test]
fn credentials_are_authenticated_and_encrypted() {
    let key = [7u8; 32];
    let plain = b"private access and refresh tokens";
    let encrypted = storage::encrypt(&key, plain).unwrap();
    assert_eq!(storage::decrypt(&key, &encrypted).unwrap(), plain);
    assert_ne!(storage::encrypt(&key, plain).unwrap(), encrypted);
    assert!(!encrypted.windows(plain.len()).any(|w| w == plain));
    assert!(storage::decrypt(&[8u8; 32], &encrypted).is_err());
    let mut tampered = encrypted;
    *tampered.last_mut().unwrap() ^= 1;
    assert!(storage::decrypt(&key, &tampered).is_err());
    for truncated in [b"".as_slice(), b"TCG1", &[0u8; 40]] {
        assert!(storage::decrypt(&key, truncated).is_err());
    }
}

#[test]
fn session_ipc_never_contains_credentials_or_host_identity() {
    let state = Store {
        host_id: "secret-host".into(),
        active_profile_id: Some("profile".into()),
        profiles: vec![Profile {
            id: "profile".into(),
            label: "Connection 1".into(),
            client_id: "secret-client".into(),
            subject: Some("secret-subject".into()),
            email: Some("test@example.com".into()),
            tokens: Some(Tokens {
                access_token: "secret-access".into(),
                refresh_token: "secret-refresh".into(),
                id_token: "secret-id".into(),
                scope: super::PLAN_SCOPE.into(),
                expires_at: 2000,
                earliest_refresh_at: None,
            }),
        }],
    };
    let exposed = serde_json::to_string(&super::session(&state)).unwrap();
    assert!(!exposed.contains("secret-"));
    assert!(exposed.contains("\"sharing\":true"));
    let mut state = state;
    state.profiles[0].tokens.as_mut().unwrap().scope = "openid profile email".into();
    assert!(!super::session(&state).profiles[0].sharing);
    assert!(super::session(&state).profiles[0].connected);
}

#[test]
fn inference_uses_required_responses_flags() {
    let body = request_body("account-model", "user prompt", "instructions");
    assert_eq!(body["store"], false);
    assert_eq!(body["stream"], true);
    assert_eq!(body["model"], "account-model");
    assert_eq!(
        body["input"],
        json!([{
            "type": "message",
            "role": "user",
            "content": [{ "type": "input_text", "text": "user prompt" }],
        }])
    );
    assert_eq!(body["instructions"], "instructions");
    assert_eq!(body.as_object().unwrap().len(), 5);
}

#[test]
fn stream_handles_utf8_split_chunks_and_crlf() {
    for newline in ["\n", "\r\n"] {
        let events = [
            json!({"type":"response.output_text.delta","delta":"SELECT 'città'"}),
            json!({"type":"response.completed","response":{"status":"completed"}}),
        ];
        let data = events
            .iter()
            .map(|event| {
                format!(
                    "event: {}{newline}data: {event}{newline}{newline}",
                    event["type"].as_str().unwrap()
                )
            })
            .collect::<String>();
        for chunk_size in 1..data.len() {
            let mut parser = ResponseStream::default();
            for chunk in data.as_bytes().chunks(chunk_size) {
                parser.push(chunk).unwrap();
            }
            assert_eq!(parser.finish().unwrap(), "SELECT 'città'");
        }
    }
}

#[test]
fn stream_requires_completed_nonempty_output() {
    let mut parser = ResponseStream::default();
    parser.push(b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial SQL\"}\n\ndata: [DONE]\n\n").unwrap();
    assert!(parser.finish().is_err());
    let mut parser = ResponseStream::default();
    parser
        .push(
            b"data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\n\n",
        )
        .unwrap();
    assert!(parser.finish().is_err());
    for kind in ["response.failed", "response.incomplete", "error"] {
        let mut parser = ResponseStream::default();
        assert!(parser
            .push(format!("data: {{\"type\":\"{kind}\"}}\n\n").as_bytes())
            .is_err());
    }
}

#[test]
fn usage_errors_have_recovery_actions_without_server_secrets() {
    assert!(protocol::api_error(429).contains("Manage usage"));
    assert!(protocol::api_error(401).contains("Continue with ChatGPT"));
    assert!(protocol::api_error(403).contains("allow plan usage"));
}

#[tokio::test]
async fn model_requests_and_response_streams_release_session_lock_after_authorization() {
    use std::time::Duration;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
        sync::oneshot,
    };
    for models in [true, false] {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/fixture", listener.local_addr().unwrap());
        let (started, received) = oneshot::channel();
        let (resume, paused) = oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut data = vec![];
            loop {
                let mut buffer = [0; 2048];
                let count = socket.read(&mut buffer).await.unwrap();
                assert!(count > 0);
                data.extend_from_slice(&buffer[..count]);
                if data.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            let headers = String::from_utf8_lossy(&data).to_ascii_lowercase();
            assert!(headers.contains("authorization: bearer fixture-token"));
            let body = if models {
                json!({"models":[
                    {"slug":"available", "display_name":"Available model", "visibility":"list"},
                    {"slug":"hidden", "display_name":"Hidden model", "visibility":"hide"}
                ]})
                .to_string()
            } else {
                "data: {\"type\":\"response.output_text.delta\",\"delta\":\"OK\"}\n\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\n\n".into()
            };
            // Pause with response headers sent; models/body streaming must not hold the lock.
            socket
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            started.send(()).unwrap();
            paused.await.unwrap();
            socket.write_all(body.as_bytes()).await.unwrap();
        });
        let request = tokio::spawn(async move {
            let client = reqwest::Client::builder().no_proxy().build().unwrap();
            if models {
                let models = super::inference::list_models_with_token(&client, &url, async {
                    assert!(super::SESSION_LOCK.try_lock().is_err());
                    Ok(Some("fixture-token".into()))
                })
                .await
                .unwrap();
                assert_eq!(models.len(), 1);
                assert_eq!(models[0].slug, "available");
            } else {
                let text = super::inference::generate_with_token(
                    &client,
                    &url,
                    "model",
                    "prompt",
                    "instructions",
                    async {
                        assert!(super::SESSION_LOCK.try_lock().is_err());
                        Ok("fixture-token".into())
                    },
                )
                .await
                .unwrap();
                assert_eq!(text, "OK");
            }
        });
        tokio::time::timeout(Duration::from_secs(5), received)
            .await
            .unwrap()
            .unwrap();
        let guard = tokio::time::timeout(Duration::from_secs(1), super::SESSION_LOCK.lock())
            .await
            .expect("Account operations must remain available while a response body is pending");
        drop(guard);
        resume.send(()).unwrap();
        request.await.unwrap();
        server.await.unwrap();
    }
}

#[tokio::test]
async fn disconnected_catalog_skips_http_without_waiting_for_the_browser_sign_in_gate() {
    let _sign_in = super::SIGN_IN_LOCK.lock().await;
    // An unreachable endpoint makes any accidental HTTP request fail the test.
    let result = super::inference::list_models_with_token(
        &reqwest::Client::new(),
        "http://127.0.0.1:0/models",
        async { Ok(None) },
    )
    .await
    .unwrap();
    assert!(result.is_empty());
}

/// Opt-in smoke test: uses the account already connected in desktop settings.
/// Sends only a fixed diagnostic prompt, never database queries or schema data.
#[tokio::test]
#[ignore = "Requires a connected ChatGPT account and consumes a small amount of plan usage"]
async fn live_chatgpt_inference_completes() {
    let config = crate::config::load_config_from_disk();
    assert_eq!(config.ai_provider.as_deref(), Some("chatgpt"));
    let model = config
        .ai_model
        .filter(|m| !m.is_empty())
        .expect("Select a ChatGPT model in AI settings before running this test.");
    let text = super::generate(
        &model,
        "Reply with exactly: OK.",
        "You are testing the Tabularis ChatGPT integration.",
    )
    .await
    .expect("ChatGPT inference must reach response.completed.");
    assert!(!text.trim().is_empty());
}
