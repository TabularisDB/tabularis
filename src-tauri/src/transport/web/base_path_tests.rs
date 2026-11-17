use super::*;
#[test]
fn rejects_nonlocal_unsafe_and_non_normalized_paths() {
    for path in [
        "",
        "relative",
        "https://host/a/",
        "//host/a",
        "/a//b",
        "/a/../b",
        "/./a",
        "/a?x",
        "/a#x",
        "/a%2fb",
        "/a\\b",
        "/a b",
        "/a\nb",
    ] {
        assert!(PublicBasePath::parse(path).is_err(), "{path:?}");
    }
    for path in ["/", "/workspaces/a/", "/workspaces/b/"] {
        assert_eq!(PublicBasePath::parse(path).unwrap().as_str(), path);
    }
    assert_eq!(
        PublicBasePath::parse("/workspaces/a").unwrap().as_str(),
        "/workspaces/a/"
    );
}
#[test]
fn legacy_build_conflicts_fail_closed() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("index.html"),
        "<head><meta name=\"tabularis-build-base\" content=\"/legacy/\"></head>",
    )
    .unwrap();
    assert_eq!(
        PublicBasePath::for_build(dir.path(), None)
            .unwrap()
            .as_str(),
        "/legacy/"
    );
    assert!(PublicBasePath::for_build(dir.path(), Some("/another/")).is_err());
    assert!(PublicBasePath::for_build(dir.path(), Some("/legacy/")).is_ok());
    std::fs::write(dir.path().join("index.html"), "<head></head>").unwrap();
    assert!(PublicBasePath::for_build(dir.path(), Some("/new/")).is_err());
    assert!(PublicBasePath::for_build(dir.path(), None).is_ok());
}
#[tokio::test]
async fn login_redirect_cookie_and_shell_use_only_configured_path() {
    use axum::{middleware, routing::get, Router};
    for prefix in ["/", "/workspaces/a/", "/workspaces/b/"] {
        let base = PublicBasePath::parse(prefix).unwrap();
        let router = Router::new()
            .route(
                "/login",
                get(|| async {
                    (
                        [(header::CONTENT_TYPE, "text/html")],
                        "<form action=\"/api/v1/auth/login\"></form>",
                    )
                }),
            )
            .route(
                "/redirect",
                get(|| async {
                    (
                        StatusCode::SEE_OTHER,
                        [
                            (header::LOCATION, "/connections/test/editor"),
                            (
                                header::SET_COOKIE,
                                "tabularis_session=test; Path=/; HttpOnly",
                            ),
                        ],
                    )
                }),
            )
            .route(
                "/",
                get(|| async {
                    (
                        [(header::CONTENT_TYPE, "text/html")],
                        "<head><meta name=\"tabularis-build-base\" content=\"/\"></head>",
                    )
                }),
            )
            .layer(middleware::from_fn_with_state(base.clone(), adapt_response));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let response = client
            .get(format!("{origin}/redirect"))
            .send()
            .await
            .unwrap();
        assert_eq!(
            response.headers()[header::LOCATION],
            base.public_path("connections/test/editor")
        );
        assert!(response.headers()[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .contains(&format!("Path={prefix};")));
        let login = client
            .get(format!("{origin}/login"))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert!(login.contains(&format!(
            "action=\"{}\"",
            base.public_path("api/v1/auth/login")
        )));
        let html = client
            .get(&origin)
            .header("X-Forwarded-Prefix", "/evil/")
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert!(html.contains(&format!("<base href=\"{prefix}\">")));
        assert!(!html.contains("evil"));
        task.abort();
    }
}
