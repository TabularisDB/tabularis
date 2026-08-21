use super::auth::{LocalSessionSecurity, LocalSessionSecurityConfig};
use super::contract::{SessionNegotiation, WEB_API_VERSION};
use super::{server, static_assets};
use reqwest::header::{COOKIE, HOST, LOCATION, ORIGIN, SET_COOKIE};
use std::path::Path;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

const CSRF_HEADER: &str = "x-tabularis-csrf";
const REQUEST_ID_HEADER: &str = "x-request-id";

#[tokio::test]
async fn requires_a_single_use_bootstrap_and_authenticated_session() {
    let temp = tempfile::tempdir().unwrap();
    let assets = temp.path();
    std::fs::create_dir_all(assets.join("assets")).unwrap();
    std::fs::write(assets.join("index.html"), "<main>Tabularis Web</main>").unwrap();
    std::fs::write(assets.join("assets/app.js"), "window.tabularis = true;").unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let base_url = format!("http://{address}");
    let (security, bootstrap_token) =
        LocalSessionSecurity::new(base_url.clone(), LocalSessionSecurityConfig::default()).unwrap();
    let bootstrap_url = format!(
        "{base_url}/api/v1/auth/bootstrap?token={}",
        bootstrap_token.expose()
    );
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let server = tokio::spawn(server::serve(
        listener,
        assets.to_path_buf(),
        security,
        async move {
            let _ = shutdown_rx.await;
        },
    ));
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();

    let health = client
        .get(format!("{base_url}/healthz"))
        .send()
        .await
        .unwrap();
    assert_eq!(health.status(), reqwest::StatusCode::OK);
    assert_eq!(health.text().await.unwrap(), "ok");

    let unauthorized = client
        .get(format!("{base_url}/api/v1/session"))
        .send()
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), reqwest::StatusCode::UNAUTHORIZED);
    assert!(uuid::Uuid::parse_str(
        unauthorized
            .headers()
            .get(REQUEST_ID_HEADER)
            .unwrap()
            .to_str()
            .unwrap()
    )
    .is_ok());

    let invalid_bootstrap = client
        .get(format!("{base_url}/api/v1/auth/bootstrap?token=invalid"))
        .send()
        .await
        .unwrap();
    assert_eq!(
        invalid_bootstrap.status(),
        reqwest::StatusCode::UNAUTHORIZED
    );

    let cross_origin_bootstrap = client
        .get(&bootstrap_url)
        .header(ORIGIN, "https://attacker.invalid")
        .send()
        .await
        .unwrap();
    assert_eq!(
        cross_origin_bootstrap.status(),
        reqwest::StatusCode::FORBIDDEN
    );

    let bootstrap = client.get(&bootstrap_url).send().await.unwrap();
    assert_eq!(bootstrap.status(), reqwest::StatusCode::SEE_OTHER);
    assert_eq!(bootstrap.headers().get(LOCATION).unwrap(), "/");
    assert_eq!(
        bootstrap.headers().get("referrer-policy").unwrap(),
        "no-referrer"
    );
    let set_cookie = bootstrap
        .headers()
        .get(SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap();
    assert!(set_cookie.contains("HttpOnly"));
    assert!(set_cookie.contains("SameSite=Strict"));
    assert!(set_cookie.contains("Path=/"));
    let cookie = set_cookie.split(';').next().unwrap().to_string();

    let replay = client.get(&bootstrap_url).send().await.unwrap();
    assert_eq!(replay.status(), reqwest::StatusCode::UNAUTHORIZED);

    let session = client
        .get(format!("{base_url}/api/v1/session"))
        .header(COOKIE, &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(session.status(), reqwest::StatusCode::OK);
    let session: SessionNegotiation = session.json().await.unwrap();
    assert_eq!(session.api_version, WEB_API_VERSION);
    assert_eq!(session.server_version, env!("CARGO_PKG_VERSION"));
    assert!(session.authenticated);
    assert!(!session.csrf_token.is_empty());
    assert!(!session.capabilities.rpc);
    assert!(!session.capabilities.events);

    let index = client
        .get(&base_url)
        .header(COOKIE, &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(index.status(), reqwest::StatusCode::OK);
    assert_eq!(index.text().await.unwrap(), "<main>Tabularis Web</main>");

    let asset = client
        .get(format!("{base_url}/assets/app.js"))
        .header(COOKIE, &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(asset.status(), reqwest::StatusCode::OK);
    assert_eq!(asset.text().await.unwrap(), "window.tabularis = true;");

    let spa_route = client
        .get(format!("{base_url}/connections/example"))
        .header(COOKIE, &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(spa_route.status(), reqwest::StatusCode::OK);
    assert_eq!(
        spa_route.text().await.unwrap(),
        "<main>Tabularis Web</main>"
    );

    let cross_origin = client
        .get(format!("{base_url}/api/v1/session"))
        .header(COOKIE, &cookie)
        .header(ORIGIN, "https://attacker.invalid")
        .send()
        .await
        .unwrap();
    assert_eq!(cross_origin.status(), reqwest::StatusCode::FORBIDDEN);

    let bad_host = client
        .get(format!("{base_url}/api/v1/session"))
        .header(COOKIE, &cookie)
        .header(HOST, "attacker.invalid")
        .send()
        .await
        .unwrap();
    assert_eq!(bad_host.status(), reqwest::StatusCode::FORBIDDEN);

    let missing_csrf = client
        .post(format!("{base_url}/api/v1/logout"))
        .header(COOKIE, &cookie)
        .header(ORIGIN, &base_url)
        .send()
        .await
        .unwrap();
    assert_eq!(missing_csrf.status(), reqwest::StatusCode::FORBIDDEN);

    let oversized = client
        .post(format!("{base_url}/api/v1/not-implemented"))
        .header(COOKIE, &cookie)
        .header(ORIGIN, &base_url)
        .header(CSRF_HEADER, &session.csrf_token)
        .header(reqwest::header::CONTENT_LENGTH, 1_048_577)
        .body("x")
        .send()
        .await
        .unwrap();
    assert_eq!(oversized.status(), reqwest::StatusCode::PAYLOAD_TOO_LARGE);

    let logout = client
        .post(format!("{base_url}/api/v1/logout"))
        .header(COOKIE, &cookie)
        .header(ORIGIN, &base_url)
        .header(CSRF_HEADER, &session.csrf_token)
        .send()
        .await
        .unwrap();
    assert_eq!(logout.status(), reqwest::StatusCode::NO_CONTENT);
    assert!(logout
        .headers()
        .get(SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .contains("Max-Age=0"));

    let logged_out = client
        .get(format!("{base_url}/api/v1/session"))
        .header(COOKIE, cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(logged_out.status(), reqwest::StatusCode::UNAUTHORIZED);

    shutdown_tx.send(()).unwrap();
    server.await.unwrap().unwrap();
}

#[tokio::test]
async fn expires_bootstrap_tokens_and_sessions() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("index.html"), "Tabularis").unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let base_url = format!("http://{address}");
    let (security, expired_bootstrap) = LocalSessionSecurity::new(
        base_url.clone(),
        LocalSessionSecurityConfig {
            bootstrap_ttl: Duration::from_millis(20),
            session_ttl: Duration::from_secs(1),
            max_body_bytes: 1_048_576,
        },
    )
    .unwrap();
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert!(security
        .consume_bootstrap(expired_bootstrap.expose())
        .is_none());

    let (security, bootstrap_token) = LocalSessionSecurity::new(
        base_url.clone(),
        LocalSessionSecurityConfig {
            bootstrap_ttl: Duration::from_secs(1),
            session_ttl: Duration::from_millis(20),
            max_body_bytes: 1_048_576,
        },
    )
    .unwrap();
    let bootstrap_url = format!(
        "{base_url}/api/v1/auth/bootstrap?token={}",
        bootstrap_token.expose()
    );
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let server = tokio::spawn(server::serve(
        listener,
        temp.path().to_path_buf(),
        security,
        async move {
            let _ = shutdown_rx.await;
        },
    ));
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let bootstrap = client.get(bootstrap_url).send().await.unwrap();
    let cookie = bootstrap
        .headers()
        .get(SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();

    tokio::time::sleep(Duration::from_millis(30)).await;
    let expired_session = client
        .get(format!("{base_url}/api/v1/session"))
        .header(COOKIE, cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(expired_session.status(), reqwest::StatusCode::UNAUTHORIZED);

    shutdown_tx.send(()).unwrap();
    server.await.unwrap().unwrap();
}

#[test]
fn redacts_generated_security_tokens() {
    let (security, bootstrap_token) = LocalSessionSecurity::new(
        "http://127.0.0.1:8080".to_string(),
        LocalSessionSecurityConfig::default(),
    )
    .unwrap();
    let token = bootstrap_token.expose().to_string();

    assert!(token.len() >= 43);
    assert!(!format!("{bootstrap_token:?}").contains(&token));
    assert!(!format!("{security:?}").contains(&token));
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
