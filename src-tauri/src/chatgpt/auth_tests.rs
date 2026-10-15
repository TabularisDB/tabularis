use super::{TokenResponse, Tokens};
use serde_json::{json, Value};

fn response() -> Value {
    json!({ "access_token": "new-access", "refresh_token": "new-refresh", "id_token": "verified-id", "token_type": "Bearer", "expires_in": 3600, "scope": "openid chatgpt.tokens.use.direct" })
}

#[test]
fn token_response_tracks_expiry_and_granted_scope() {
    let before = crate::chatgpt::protocol::now();
    let tokens = serde_json::from_value::<TokenResponse>(response())
        .unwrap()
        .tokens(None)
        .unwrap();
    assert!(tokens.sharing());
    assert!(tokens.expires_at >= before + 3600);
    assert!(tokens.expires_at <= crate::chatgpt::protocol::now() + 3600);
    let mut identity_only = response();
    identity_only["scope"] = json!("openid email");
    assert!(!serde_json::from_value::<TokenResponse>(identity_only)
        .unwrap()
        .tokens(None)
        .unwrap()
        .sharing());
}

#[test]
fn refresh_rotates_credentials_and_retains_omitted_identity_and_scope() {
    let previous = Tokens {
        access_token: "old-access".into(),
        refresh_token: "old-refresh".into(),
        id_token: "retained-id".into(),
        scope: "openid chatgpt.tokens.use.direct".into(),
        expires_at: 1,
        earliest_refresh_at: None,
    };
    let mut value = response();
    value.as_object_mut().unwrap().remove("id_token");
    value.as_object_mut().unwrap().remove("scope");
    let tokens = serde_json::from_value::<TokenResponse>(value)
        .unwrap()
        .tokens(Some(&previous))
        .unwrap();
    assert_eq!(tokens.access_token, "new-access");
    assert_eq!(tokens.refresh_token, "new-refresh");
    assert_eq!(tokens.id_token, "retained-id");
    assert_eq!(tokens.scope, previous.scope);
}

#[test]
fn refresh_honors_a_narrowed_grant() {
    let previous = serde_json::from_value::<TokenResponse>(response())
        .unwrap()
        .tokens(None)
        .unwrap();
    let mut value = response();
    value["scope"] = json!("openid email");
    let tokens = serde_json::from_value::<TokenResponse>(value)
        .unwrap()
        .tokens(Some(&previous))
        .unwrap();
    assert!(!tokens.sharing());
}

#[test]
fn initial_exchange_requires_identity_permissions_and_valid_bearer_credentials() {
    for field in ["id_token", "scope"] {
        let mut value = response();
        value.as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<TokenResponse>(value)
            .unwrap()
            .tokens(None)
            .is_err());
    }
    for (field, value) in [
        ("token_type", json!("Basic")),
        ("access_token", json!("")),
        ("refresh_token", json!("")),
        ("expires_in", json!(0)),
    ] {
        let mut invalid = response();
        invalid[field] = value;
        assert!(serde_json::from_value::<TokenResponse>(invalid)
            .unwrap()
            .tokens(None)
            .is_err());
    }
}
