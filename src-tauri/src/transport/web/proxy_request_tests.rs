use super::{
    auth::*, base_path::PublicBasePath, events::WebEventBus, provisioning::ProvisioningToken,
    server,
};
use crate::{
    application::{AuthorizationLevel, ManagedConnectionPolicy, RuntimeApplicationApi},
    runtime::{paths::FixedRuntimePaths, state::ApplicationState, RuntimeContext},
};
use reqwest::header::{COOKIE, SET_COOKIE};
use std::{sync::Arc, time::Duration};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Error},
};

const PROXY_SECRET: &str = "proxy-secret-for-every-request-regression";
const MACHINE_TOKEN: &str = "independent-machine-provisioning-token-12345";

#[tokio::test]
async fn cookies_and_websockets_require_gateway_auth_but_provisioning_does_not() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("index.html"), "test").unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().into(),
            temp.path().into(),
        )),
        Arc::new(crate::runtime::events::NoopRuntimeEvents),
        Arc::new(crate::runtime::secrets::KeyringRuntimeSecrets),
    );
    let application = Arc::new(RuntimeApplicationApi::new(
        runtime,
        Arc::new(ApplicationState::default()),
    ));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let origin = format!("http://{address}");
    let security = LocalSessionSecurity::new_remote(
        RemoteSessionSecurityConfig {
            trusted_proxies: vec![],
            public_origin: origin.clone(),
            allowed_origins: vec![origin.clone()],
            session_ttl: Duration::from_secs(60),
            max_body_bytes: 1024 * 1024,
            authorization: AuthorizationLevel::Database,
            rate_limit: Default::default(),
        },
        RemoteAuthentication::proxy(PROXY_SECRET),
    )
    .unwrap();
    let issued = security.authenticate_proxy(PROXY_SECRET, "alice").unwrap();
    let cookie = format!("tabularis_session={}", issued.cookie_value);
    let csrf = security
        .authenticate(&issued.cookie_value)
        .unwrap()
        .csrf_token;
    // A correct existing-cookie request must work even when creation is impossible.
    for _ in 1..MAX_SESSIONS {
        security.authenticate_proxy(PROXY_SECRET, "alice").unwrap();
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(server::serve_with_configuration(
        listener,
        temp.path().into(),
        temp.path().into(),
        temp.path().join("plugins"),
        security.clone(),
        application,
        WebEventBus::default(),
        Arc::default(),
        ManagedConnectionPolicy::managed_only(),
        Some(ProvisioningToken::new(MACHINE_TOKEN).unwrap()),
        PublicBasePath::default(),
        async {
            let _ = rx.await;
        },
    ));
    let client = reqwest::Client::new();
    for supplied in [None, Some("wrong-secret"), Some(PROXY_SECRET)] {
        for path in ["/", "/api/v1/session"] {
            let mut request = client
                .get(format!("{origin}{path}"))
                .header(COOKIE, &cookie)
                .header(PROXY_USER_HEADER_NAME, "alice");
            if let Some(secret) = supplied {
                request = request.header(PROXY_SECRET_HEADER_NAME, secret);
            }
            let response = request.send().await.unwrap();
            assert_eq!(
                response.status().as_u16(),
                if supplied == Some(PROXY_SECRET) {
                    200
                } else {
                    401
                }
            );
            assert!(
                response.headers().get(SET_COOKIE).is_none(),
                "existing sessions must not be replaced"
            );
            if path.ends_with("session") && response.status().is_success() {
                let session: serde_json::Value = response.json().await.unwrap();
                assert_eq!(session["csrfToken"], csrf);
            }
        }
        let mut mutation = client
            .post(format!("{origin}/api/v1/rpc/get_connections"))
            .header(COOKIE, &cookie)
            .header(PROXY_USER_HEADER_NAME, "alice")
            .header("origin", &origin)
            .header(CSRF_HEADER_NAME, &csrf)
            .json(&serde_json::Value::Null);
        if let Some(secret) = supplied {
            mutation = mutation.header(PROXY_SECRET_HEADER_NAME, secret);
        }
        assert_eq!(
            mutation.send().await.unwrap().status().as_u16(),
            if supplied == Some(PROXY_SECRET) {
                200
            } else {
                401
            }
        );
        let mut upgrade = format!("ws://{address}/api/v1/events")
            .into_client_request()
            .unwrap();
        upgrade
            .headers_mut()
            .insert("cookie", cookie.parse().unwrap());
        upgrade
            .headers_mut()
            .insert("origin", origin.parse().unwrap());
        upgrade
            .headers_mut()
            .insert(PROXY_USER_HEADER_NAME, "alice".parse().unwrap());
        if let Some(secret) = supplied {
            upgrade
                .headers_mut()
                .insert(PROXY_SECRET_HEADER_NAME, secret.parse().unwrap());
        }
        match connect_async(upgrade).await {
            Ok((mut socket, response)) => {
                assert_eq!(supplied, Some(PROXY_SECRET));
                assert_eq!(response.status().as_u16(), 101);
                socket.close(None).await.unwrap();
            }
            Err(Error::Http(response)) => {
                assert_ne!(supplied, Some(PROXY_SECRET));
                assert_eq!(response.status().as_u16(), 401);
            }
            Err(error) => panic!("unexpected WebSocket error: {error}"),
        }
    }
    assert_eq!(
        client
            .get(format!("{origin}/api/v1/session"))
            .header(COOKIE, &cookie)
            .header(PROXY_SECRET_HEADER_NAME, PROXY_SECRET)
            .send()
            .await
            .unwrap()
            .status(),
        401,
        "missing forwarded identity"
    );
    let collection = format!("{origin}/api/v1/provisioning/connections");
    assert_eq!(
        client
            .get(&collection)
            .bearer_auth(MACHINE_TOKEN)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        client
            .get(&collection)
            .header(COOKIE, &cookie)
            .header(PROXY_SECRET_HEADER_NAME, PROXY_SECRET)
            .header(PROXY_USER_HEADER_NAME, "alice")
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        client
            .get(format!("{origin}/healthz"))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        client
            .get(format!(
                "{origin}/api/v1/sandbox/plugins/{}/invalid/probe/__guest__.html",
                issued.session_id()
            ))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    let authenticated = security.authenticate(&issued.cookie_value).unwrap();
    let ticket = authenticated.sandbox_ticket("probe");
    assert_eq!(
        client
            .get(format!(
                "{origin}/api/v1/sandbox/plugins/{}/{ticket}/probe/__guest__.html",
                issued.session_id()
            ))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert!(matches!(
        security.authenticate_proxy(PROXY_SECRET, "alice"),
        Err(AuthenticationError::SessionLimitReached)
    ));
    let _ = tx.send(());
    task.await.unwrap().unwrap();
}
