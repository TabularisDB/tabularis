use super::super::types::ProxyProtocol;
use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

fn proxy_fixture() -> (ProxyEndpoint, thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut buffer = [0_u8; 2048];
        let count = stream.read(&mut buffer).unwrap();
        let request = String::from_utf8_lossy(&buffer[..count]);
        let first_line = request.lines().next().unwrap().to_string();
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
            .unwrap();
        first_line
    });
    (
        ProxyEndpoint {
            protocol: ProxyProtocol::Http,
            host: "127.0.0.1".into(),
            port,
            username: None,
            password: None,
        },
        handle,
    )
}

#[tokio::test]
async fn explicit_custom_proxy_is_used_by_both_reqwest_clients() {
    let target = "http://example.invalid/catalog";
    let (endpoint, request) = proxy_fixture();
    let client =
        build_http_client(HttpProxyPolicy::Custom(endpoint), Duration::from_secs(5)).unwrap();
    assert_eq!(
        client
            .get(target)
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap(),
        "ok"
    );
    assert!(request
        .join()
        .unwrap()
        .starts_with("GET http://example.invalid/catalog "));

    let (endpoint, request) = proxy_fixture();
    let client =
        build_http_client_012(HttpProxyPolicy::Custom(endpoint), Duration::from_secs(5)).unwrap();
    assert_eq!(
        client
            .get(target)
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap(),
        "ok"
    );
    assert!(request
        .join()
        .unwrap()
        .starts_with("GET http://example.invalid/catalog "));
}

#[test]
fn system_proxy_uses_process_proxy_settings_for_both_clients() {
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "proxy::http::tests::system_proxy_child",
            "--nocapture",
        ])
        .env("TABULARIS_SYSTEM_PROXY_CHILD", "1")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn system_proxy_child() {
    if std::env::var_os("TABULARIS_SYSTEM_PROXY_CHILD").is_none() {
        return;
    }
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        let target = "http://example.invalid/catalog";
        let (endpoint, request) = proxy_fixture();
        // This subprocess runs only this test, so changing its environment is isolated.
        unsafe {
            std::env::set_var(
                "HTTP_PROXY",
                format!("http://{}:{}", endpoint.host, endpoint.port),
            );
            std::env::remove_var("NO_PROXY");
            std::env::remove_var("no_proxy");
        }
        let client = build_http_client(HttpProxyPolicy::System, Duration::from_secs(5)).unwrap();
        assert_eq!(
            client
                .get(target)
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap(),
            "ok"
        );
        assert!(request
            .join()
            .unwrap()
            .starts_with("GET http://example.invalid/catalog "));

        let (endpoint, request) = proxy_fixture();
        unsafe {
            std::env::set_var(
                "HTTP_PROXY",
                format!("http://{}:{}", endpoint.host, endpoint.port),
            );
        }
        let client =
            build_http_client_012(HttpProxyPolicy::System, Duration::from_secs(5)).unwrap();
        assert_eq!(
            client
                .get(target)
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap(),
            "ok"
        );
        assert!(request
            .join()
            .unwrap()
            .starts_with("GET http://example.invalid/catalog "));
    });
}
