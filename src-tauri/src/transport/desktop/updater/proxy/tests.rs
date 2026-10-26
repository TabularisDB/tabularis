use super::*;
use crate::proxy::{ProxyEndpoint, ProxyProtocol};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

struct Fixture {
    port: u16,
    base: String,
    requests: Arc<Mutex<Vec<String>>>,
    task: tokio::task::JoinHandle<()>,
}

impl Fixture {
    async fn start(proxy: bool) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let base = if proxy {
            "http://updates.example.invalid".to_string()
        } else {
            format!("http://127.0.0.1:{port}")
        };
        let manifest = serde_json::json!({
            "version": "999.0.0",
            "url": format!("{base}/package"),
            "signature": "unused-test-signature"
        })
        .to_string();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&requests);
        let task = tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") && request.len() < 16384 {
                    let Ok(byte) = stream.read_u8().await else {
                        break;
                    };
                    request.push(byte);
                }
                let request = String::from_utf8(request).unwrap();
                let is_manifest = request.lines().next().unwrap().contains("/manifest");
                captured.lock().unwrap().push(request);
                // A package error exercises download routing without installing or
                // bypassing the updater's signature verification.
                let (status, body) = if is_manifest {
                    ("200 OK", manifest.as_str())
                } else {
                    ("418 I'm a teapot", "fixture package response")
                };
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream.write_all(response.as_bytes()).await.unwrap();
            }
        });
        Self {
            port,
            base,
            requests,
            task,
        }
    }

    fn endpoint(&self) -> ProxyEndpoint {
        ProxyEndpoint {
            protocol: ProxyProtocol::Http,
            host: "127.0.0.1".into(),
            port: self.port,
            username: Some("proxy-user".into()),
            password: Some("proxy-password".into()),
        }
    }

    fn assert_requests(&self, proxied: bool) {
        let requests = self.requests.lock().unwrap();
        assert_eq!(
            requests.len(),
            2,
            "manifest and package must use the same route"
        );
        for (request, path) in requests.iter().zip(["manifest", "package"]) {
            let target = if proxied {
                format!("{}/{path}", self.base)
            } else {
                format!("/{path}")
            };
            assert!(request.starts_with(&format!("GET {target} HTTP/1.1")));
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn app() -> tauri::App<tauri::test::MockRuntime> {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({"pubkey": "unused-test-key", "dangerousInsecureTransportProtocol": true}),
    );
    tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap()
}

async fn check_and_download(builder: UpdaterBuilder, fixture: &Fixture) {
    let updater = builder
        .endpoints(vec![format!("{}/manifest", fixture.base).parse().unwrap()])
        .unwrap()
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap();
    let update = updater.check().await.unwrap().expect("fixture update");
    let error = update.download(|_, _| {}, || {}).await.unwrap_err();
    assert!(error.to_string().contains("418"), "{error}");
}

#[test]
fn manifest_and_package_requests_follow_each_proxy_mode() {
    const CHILD: &str = "TABULARIS_UPDATER_PROXY_TEST";
    if std::env::var_os(CHILD).is_none() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "transport::desktop::updater::proxy::tests::manifest_and_package_requests_follow_each_proxy_mode",
                "--nocapture",
            ])
            .env(CHILD, "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }

    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let system = Fixture::start(true).await;
        let custom = Fixture::start(true).await;
        let direct = Fixture::start(false).await;
        // Isolate environment changes from the rest of the test suite.
        for name in [
            "http_proxy",
            "https_proxy",
            "ALL_PROXY",
            "all_proxy",
            "NO_PROXY",
            "no_proxy",
        ] {
            std::env::remove_var(name);
        }
        for name in ["HTTP_PROXY", "HTTPS_PROXY"] {
            std::env::set_var(name, format!("http://127.0.0.1:{}", system.port));
        }
        let app = app();
        check_and_download(
            with_policy(app.updater_builder(), HttpProxyPolicy::System).unwrap(),
            &system,
        )
        .await;
        system.assert_requests(true);

        check_and_download(
            with_policy(
                app.updater_builder(),
                HttpProxyPolicy::Custom(custom.endpoint()),
            )
            .unwrap(),
            &custom,
        )
        .await;
        custom.assert_requests(true);
        for request in custom.requests.lock().unwrap().iter() {
            assert!(request
                .to_ascii_lowercase()
                .contains("proxy-authorization: basic "));
        }

        // Exercise the production policy lookup as well as the updater adapter.
        let config = crate::config::AppConfig {
            proxy: Some(crate::proxy::GlobalProxySettings {
                modes: crate::proxy::ProxyScopeModes {
                    app_http: crate::proxy::HttpProxyMode::Disabled,
                    ..Default::default()
                },
                ..Default::default()
            }),
            ..Default::default()
        };
        crate::config::cache_config(&config);
        check_and_download(app_updater_builder(app.handle()).unwrap(), &direct).await;
        direct.assert_requests(false);
        system.assert_requests(true);
        custom.assert_requests(true);
    });
}

#[test]
fn invalid_custom_endpoint_is_rejected_before_updater_requests() {
    let app = app();
    for (host, port) in [("", 7890), ("127.0.0.1", 0), ("invalid host", 7890)] {
        let endpoint = ProxyEndpoint {
            host: host.into(),
            port,
            ..Default::default()
        };
        assert!(with_policy(app.updater_builder(), HttpProxyPolicy::Custom(endpoint)).is_err());
    }
}
