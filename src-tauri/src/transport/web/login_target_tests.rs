use super::login_target::login_return_target;

#[test]
fn accepts_the_connection_editor_route() {
    let id = "/connections/6f1c2a4e-9b7d-4c61-8a53-2f0e9d7b1c34/editor";
    assert_eq!(login_return_target(id), Some(id));
    let trailing = "/connections/conn_1.a~b/editor/";
    assert_eq!(login_return_target(trailing), Some(trailing));
    let escaped = "/connections/my%20db/editor";
    assert_eq!(login_return_target(escaped), Some(escaped));
}

#[test]
fn rejects_other_application_routes() {
    for target in [
        "/",
        "/connections",
        "/connections/",
        "/connections//editor",
        "/connections/abc",
        "/connections/abc/editor/extra",
        "/settings",
        "/api/v1/session",
        "/login",
        "",
    ] {
        assert_eq!(login_return_target(target), None, "{target:?}");
    }
}

#[test]
fn rejects_open_redirect_shapes() {
    for target in [
        "//evil.example/connections/abc/editor",
        "https://evil.example/connections/abc/editor",
        "/\\evil.example/connections/abc/editor",
        "/connections/a\\b/editor",
        "/connections/a%2Fb/editor",
        "/connections/a%2fb/editor",
        "/connections/a%5Cb/editor",
        "/connections/../editor",
        "/connections/./editor",
        "/connections/%2e%2E/editor",
        "/connections/%2E/editor",
        "/connections/a/b/editor",
        "connections/abc/editor",
    ] {
        assert_eq!(login_return_target(target), None, "{target:?}");
    }
}

#[test]
fn rejects_queries_fragments_and_unsafe_characters() {
    for target in [
        "/connections/abc/editor?next=//evil.example",
        "/connections/abc/editor#x",
        "/connections/a\"b/editor",
        "/connections/a<b/editor",
        "/connections/a b/editor",
        "/connections/a%zzb/editor",
        "/connections/a%2/editor",
        "/connections/é/editor",
        "/connections/a\r\nb/editor",
    ] {
        assert_eq!(login_return_target(target), None, "{target:?}");
    }
}
