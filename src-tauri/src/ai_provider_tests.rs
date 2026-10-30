//! Wire-level regression tests. Every request terminates at a local fixture.
use super::*;
use openssl::{
    asn1::Asn1Time,
    hash::MessageDigest,
    pkey::PKey,
    rsa::Rsa,
    ssl::{SslAcceptor, SslMethod},
    x509::{X509NameBuilder, X509},
};
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
    time::Duration,
};

struct CapturedRequest {
    target: String,
    headers: String,
    body: serde_json::Value,
}

struct Fixture {
    client: Client,
    port: u16,
    requests: thread::JoinHandle<Vec<CapturedRequest>>,
}

fn read_headers(stream: &mut impl Read) -> String {
    let mut bytes = Vec::new();
    while !bytes.ends_with(b"\r\n\r\n") {
        let mut byte = [0];
        stream.read_exact(&mut byte).unwrap();
        bytes.push(byte[0]);
        assert!(bytes.len() < 16 * 1024);
    }
    String::from_utf8(bytes).unwrap()
}

fn serve(
    stream: &mut (impl Read + Write),
    target: String,
    status: u16,
    response: &serde_json::Value,
) -> CapturedRequest {
    let headers = read_headers(stream);
    let length = headers
        .lines()
        .find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().unwrap())
        })
        .unwrap();
    assert!(length < 64 * 1024);
    let mut bytes = vec![0; length];
    stream.read_exact(&mut bytes).unwrap();
    let body = serde_json::from_slice(&bytes).unwrap();
    let response = response.to_string();
    write!(stream, "HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}", response.len()).unwrap();
    stream.flush().unwrap();
    CapturedRequest {
        target,
        headers,
        body,
    }
}

impl Fixture {
    fn new(tls: bool, responses: Vec<(u16, serde_json::Value)>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let mut client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(10));
        if tls {
            // Test-only proxy, with an ephemeral self-signed certificate. It
            // never forwards traffic or uses configured provider credentials.
            client = client
                .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{port}")).unwrap())
                .danger_accept_invalid_certs(true);
        }
        let client = client.build().unwrap();
        let requests = thread::spawn(move || {
            let acceptor = if tls {
                let key = PKey::from_rsa(Rsa::generate(2048).unwrap()).unwrap();
                let mut name = X509NameBuilder::new().unwrap();
                name.append_entry_by_text("CN", "fixture.invalid").unwrap();
                let name = name.build();
                let mut certificate = X509::builder().unwrap();
                certificate.set_version(2).unwrap();
                certificate.set_subject_name(&name).unwrap();
                certificate.set_issuer_name(&name).unwrap();
                certificate.set_pubkey(&key).unwrap();
                certificate
                    .set_not_before(&Asn1Time::days_from_now(0).unwrap())
                    .unwrap();
                certificate
                    .set_not_after(&Asn1Time::days_from_now(1).unwrap())
                    .unwrap();
                certificate.sign(&key, MessageDigest::sha256()).unwrap();
                let mut acceptor = SslAcceptor::mozilla_intermediate(SslMethod::tls()).unwrap();
                acceptor.set_private_key(&key).unwrap();
                acceptor.set_certificate(&certificate.build()).unwrap();
                Some(acceptor.build())
            } else {
                None
            };
            responses
                .into_iter()
                .map(|(status, response)| {
                    let (mut socket, _) = listener.accept().unwrap();
                    socket
                        .set_read_timeout(Some(Duration::from_secs(10)))
                        .unwrap();
                    socket
                        .set_write_timeout(Some(Duration::from_secs(10)))
                        .unwrap();
                    if let Some(acceptor) = &acceptor {
                        let connect = read_headers(&mut socket);
                        assert!(connect.starts_with("CONNECT "));
                        let target = connect.lines().next().unwrap().to_string();
                        socket
                            .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                            .unwrap();
                        let mut stream = acceptor.accept(socket).unwrap();
                        serve(&mut stream, target, status, &response)
                    } else {
                        serve(&mut socket, "loopback".into(), status, &response)
                    }
                })
                .collect()
        });
        Self {
            client,
            port,
            requests,
        }
    }
}

async fn generate(provider: &str, fixture: &Fixture) -> Result<String, String> {
    let req = AiGenerateRequest {
        provider: provider.into(),
        model: "fixture-model".into(),
        prompt: "Count authors".into(),
        schema: String::new(),
    };
    match provider {
        "openai" => generate_openai(&fixture.client, "fixture-key", &req, "SQL instructions").await,
        "anthropic" => {
            generate_anthropic(&fixture.client, "fixture-key", &req, "SQL instructions").await
        }
        "openrouter" => {
            generate_openrouter(&fixture.client, "fixture-key", &req, "SQL instructions").await
        }
        "runcrate" => {
            generate_runcrate(&fixture.client, "fixture-key", &req, "SQL instructions").await
        }
        "minimax" => {
            generate_minimax(&fixture.client, "fixture-key", &req, "SQL instructions").await
        }
        "custom-openai" => {
            generate_custom_openai(
                &fixture.client,
                "fixture-key",
                &req,
                "SQL instructions",
                "https://fixture.invalid/v1/",
            )
            .await
        }
        "ollama" => generate_ollama(&fixture.client, &req, "SQL instructions", fixture.port).await,
        _ => unreachable!(),
    }
}

fn success(provider: &str) -> serde_json::Value {
    let text = "```sql\nSELECT COUNT(*) FROM authors;\n```";
    match provider {
        "anthropic" => json!({"content":[{"type":"text","text":text}]}),
        "ollama" => json!({"message":{"content":text}}),
        _ => json!({"choices":[{"message":{"content":text}}]}),
    }
}

#[tokio::test]
async fn existing_providers_keep_their_wire_protocols_and_parse_completed_sql() {
    for provider in [
        "openai",
        "anthropic",
        "openrouter",
        "runcrate",
        "minimax",
        "custom-openai",
        "ollama",
    ] {
        let fixture = Fixture::new(provider != "ollama", vec![(200, success(provider))]);
        assert_eq!(
            generate(provider, &fixture).await.unwrap(),
            "SELECT COUNT(*) FROM authors;",
            "{provider}"
        );
        let requests = fixture.requests.join().unwrap();
        let request = &requests[0];
        assert_eq!(request.body["model"], "fixture-model", "{provider}");
        assert!(
            request.body.get("input").is_none(),
            "{provider} must retain its original protocol"
        );
        let headers = request.headers.to_ascii_lowercase();
        if provider == "ollama" {
            assert!(request.headers.starts_with("POST /api/chat "));
            assert_eq!(request.body["stream"], false);
            assert_eq!(request.body["messages"][1]["content"], "Count authors");
            assert_eq!(request.body["messages"][0]["content"], "SQL instructions");
            assert!(!headers.contains("authorization:"));
        } else if provider == "anthropic" {
            assert!(request.headers.starts_with("POST /v1/messages "));
            assert!(headers.contains("x-api-key: fixture-key"));
            assert!(headers.contains("anthropic-version:"));
            assert_eq!(request.body["system"], "SQL instructions");
            assert_eq!(request.body["messages"][0]["role"], "user");
            assert!(request.body.get("temperature").is_none());
        } else {
            assert!(request
                .headers
                .lines()
                .next()
                .unwrap()
                .contains("/chat/completions "));
            assert!(headers.contains("authorization: bearer fixture-key"));
            assert_eq!(request.body["messages"][0]["role"], "system");
            assert_eq!(request.body["messages"][0]["content"], "SQL instructions");
            assert_eq!(request.body["messages"][1]["content"], "Count authors");
            if provider == "openrouter" {
                assert!(headers.contains("http-referer: https://github.com/tabularisdb/tabularis"));
                assert!(headers.contains("x-title: tabularis"));
            }
            if provider == "runcrate" {
                assert!(request.target.contains("api.runcrate.ai:443"));
                assert!(request.headers.starts_with("POST /v1/chat/completions "));
            }
        }
    }
}

#[tokio::test]
async fn anthropic_skips_thinking_blocks_before_the_text_block() {
    let fixture = Fixture::new(
        true,
        vec![(
            200,
            json!({"content":[
                {"type":"thinking","thinking":"","signature":"fixture-signature"},
                {"type":"text","text":"```sql\nSELECT COUNT(*) FROM authors;\n```"}
            ]}),
        )],
    );
    assert_eq!(
        generate("anthropic", &fixture).await.unwrap(),
        "SELECT COUNT(*) FROM authors;"
    );
    fixture.requests.join().unwrap();
}

#[tokio::test]
async fn anthropic_without_a_text_block_is_an_invalid_response() {
    let fixture = Fixture::new(
        true,
        vec![(
            200,
            json!({"content":[{"type":"thinking","thinking":"","signature":"fixture-signature"}]}),
        )],
    );
    let error = generate("anthropic", &fixture).await.unwrap_err();
    assert_eq!(error, "Invalid response format from Anthropic");
    fixture.requests.join().unwrap();
}

#[tokio::test]
async fn anthropic_reports_max_tokens_when_no_text_block_was_produced() {
    let fixture = Fixture::new(
        true,
        vec![(
            200,
            json!({
                "stop_reason":"max_tokens",
                "content":[{"type":"thinking","thinking":"","signature":"fixture-signature"}]
            }),
        )],
    );
    let error = generate("anthropic", &fixture).await.unwrap_err();
    assert_eq!(
        error,
        "Anthropic stopped at the max_tokens limit before producing an answer"
    );
    fixture.requests.join().unwrap();
}

#[tokio::test]
async fn existing_providers_propagate_http_failures() {
    for provider in [
        "openai",
        "anthropic",
        "openrouter",
        "runcrate",
        "custom-openai",
        "ollama",
    ] {
        let fixture = Fixture::new(
            provider != "ollama",
            vec![(400, json!({"error":"fixture-rejection"}))],
        );
        let error = generate(provider, &fixture).await.unwrap_err();
        assert!(error.contains("fixture-rejection"), "{provider}: {error}");
        fixture.requests.join().unwrap();
    }
}

#[tokio::test]
async fn minimax_retries_its_other_region_after_a_failure() {
    let fixture = Fixture::new(
        true,
        vec![
            (401, json!({"error":"fixture-rejection"})),
            (200, success("minimax")),
        ],
    );
    assert_eq!(
        generate("minimax", &fixture).await.unwrap(),
        "SELECT COUNT(*) FROM authors;"
    );
    let requests = fixture.requests.join().unwrap();
    assert_eq!(requests.len(), 2);
    assert_ne!(requests[0].target, requests[1].target);
}
