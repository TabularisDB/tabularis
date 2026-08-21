use super::contract::{SessionNegotiation, WEB_API_VERSION};
use super::{server, static_assets};
use std::path::Path;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

#[tokio::test]
async fn serves_health_session_assets_and_spa_fallback() {
    let temp = tempfile::tempdir().unwrap();
    let assets = temp.path();
    std::fs::create_dir_all(assets.join("assets")).unwrap();
    std::fs::write(assets.join("index.html"), "<main>Tabularis Web</main>").unwrap();
    std::fs::write(assets.join("assets/app.js"), "window.tabularis = true;").unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let server = tokio::spawn(server::serve(listener, assets.to_path_buf(), async move {
        let _ = shutdown_rx.await;
    }));
    let client = reqwest::Client::new();
    let base_url = format!("http://{address}");

    let health = client
        .get(format!("{base_url}/healthz"))
        .send()
        .await
        .unwrap();
    assert_eq!(health.status(), reqwest::StatusCode::OK);
    assert_eq!(health.text().await.unwrap(), "ok");

    let session = client
        .get(format!("{base_url}/api/v1/session"))
        .send()
        .await
        .unwrap();
    assert_eq!(session.status(), reqwest::StatusCode::OK);
    let session: SessionNegotiation = session.json().await.unwrap();
    assert_eq!(session.api_version, WEB_API_VERSION);
    assert_eq!(session.server_version, env!("CARGO_PKG_VERSION"));
    assert!(!session.authenticated);
    assert!(!session.capabilities.rpc);
    assert!(!session.capabilities.events);

    let missing_api = client
        .get(format!("{base_url}/api/v1/not-implemented"))
        .send()
        .await
        .unwrap();
    assert_eq!(missing_api.status(), reqwest::StatusCode::NOT_FOUND);

    let index = client.get(&base_url).send().await.unwrap();
    assert_eq!(index.status(), reqwest::StatusCode::OK);
    assert_eq!(index.text().await.unwrap(), "<main>Tabularis Web</main>");

    let asset = client
        .get(format!("{base_url}/assets/app.js"))
        .send()
        .await
        .unwrap();
    assert_eq!(asset.status(), reqwest::StatusCode::OK);
    assert_eq!(asset.text().await.unwrap(), "window.tabularis = true;");

    let spa_route = client
        .get(format!("{base_url}/connections/example"))
        .send()
        .await
        .unwrap();
    assert_eq!(spa_route.status(), reqwest::StatusCode::OK);
    assert_eq!(
        spa_route.text().await.unwrap(),
        "<main>Tabularis Web</main>"
    );

    shutdown_tx.send(()).unwrap();
    server.await.unwrap().unwrap();
}

#[test]
fn resolves_explicit_and_packaged_web_roots() {
    let temp = tempfile::tempdir().unwrap();
    let explicit = temp.path().join("explicit");
    std::fs::create_dir_all(&explicit).unwrap();
    std::fs::write(explicit.join("index.html"), "Tabularis").unwrap();

    assert_eq!(
        static_assets::resolve_web_root(Some(&explicit)).unwrap(),
        explicit.canonicalize().unwrap()
    );

    let candidates = static_assets::candidate_web_roots(
        Path::new("/opt/Tabularis.app/Contents/MacOS/tabularis"),
        Path::new("/workspace/packages/web-ui/dist"),
    );
    assert!(candidates
        .contains(&Path::new("/opt/Tabularis.app/Contents/Resources/web-ui").to_path_buf()));
    assert!(candidates.contains(&Path::new("/workspace/packages/web-ui/dist").to_path_buf()));

    let linux_candidates = static_assets::candidate_web_roots(
        Path::new("/usr/bin/tabularis"),
        Path::new("/workspace/packages/web-ui/dist"),
    );
    assert!(linux_candidates.contains(&Path::new("/usr/lib/tabularis/web-ui").to_path_buf()));
}

#[test]
fn rejects_a_web_root_without_an_index() {
    let temp = tempfile::tempdir().unwrap();
    let error = static_assets::resolve_web_root(Some(temp.path())).unwrap_err();

    assert!(error.contains("index.html"));
}
