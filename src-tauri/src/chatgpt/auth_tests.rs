use super::{complete_sign_in, register_profile, Profile, Store, TokenResponse, Tokens};
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

fn profile(id: &str, client_id: &str) -> Profile {
    Profile {
        id: id.into(),
        label: id.into(),
        client_id: client_id.into(),
        subject: Some("account-subject".into()),
        email: Some("before@example.test".into()),
        tokens: Some(
            serde_json::from_value::<TokenResponse>(response())
                .unwrap()
                .tokens(None)
                .unwrap(),
        ),
    }
}

fn identity(subject: &str) -> crate::chatgpt::protocol::Identity {
    serde_json::from_value(json!({
        "iss": crate::chatgpt::ISSUER, "sub": subject,
        "aud": "oaiapp_saved", "exp": 2000, "email": "after@example.test"
    }))
    .unwrap()
}

#[test]
fn completing_browser_sign_in_preserves_other_accounts_changed_during_the_wait() {
    let original = profile("returning", "oaiapp_saved");
    let mut state = Store {
        profiles: vec![original.clone(), profile("other", "oaiapp_other")],
        ..Store::default()
    };
    // Another request rotated a different account while the browser was open.
    state.profiles[1].tokens.as_mut().unwrap().refresh_token = "rotated-while-signing-in".into();
    let callback = crate::chatgpt::protocol::Callback {
        code: "code".into(),
        client_id: original.client_id.clone(),
    };
    let id = register_profile(&mut state, Some(&original), &callback).unwrap();
    let mut tokens = original.tokens.unwrap();
    tokens.access_token = "reauthorized-access".into();
    complete_sign_in(
        &mut state,
        &id,
        &callback.client_id,
        identity("account-subject"),
        tokens,
    )
    .unwrap();
    assert_eq!(state.profiles.len(), 2);
    assert_eq!(state.active_profile_id.as_deref(), Some("returning"));
    assert_eq!(
        state.profiles[0].tokens.as_ref().unwrap().access_token,
        "reauthorized-access"
    );
    assert_eq!(
        state.profiles[1].tokens.as_ref().unwrap().refresh_token,
        "rotated-while-signing-in"
    );
}

#[test]
fn new_registration_is_retained_without_switching_or_replacing_existing_accounts() {
    let mut state = Store {
        active_profile_id: Some("other".into()),
        profiles: vec![profile("other", "oaiapp_other")],
        ..Store::default()
    };
    let callback = crate::chatgpt::protocol::Callback {
        code: "code".into(),
        client_id: "oaiapp_new".into(),
    };
    let id = register_profile(&mut state, None, &callback).unwrap();
    assert_eq!(state.active_profile_id.as_deref(), Some("other"));
    assert_eq!(state.profiles[1].id, id);
    assert_eq!(state.profiles[1].client_id, "oaiapp_new");
    assert!(state.profiles[1].tokens.is_none());
    assert!(state.profiles[0].tokens.is_some());
}

#[test]
fn stale_sign_in_rejects_removed_registrations_changed_clients_and_changed_subjects() {
    let original = profile("returning", "oaiapp_saved");
    let callback = crate::chatgpt::protocol::Callback {
        code: "code".into(),
        client_id: original.client_id.clone(),
    };
    let mut state = Store::default();
    assert!(register_profile(&mut state, Some(&original), &callback).is_err());
    state.profiles.push(profile("returning", "oaiapp_replaced"));
    assert!(register_profile(&mut state, Some(&original), &callback).is_err());
    assert!(complete_sign_in(
        &mut state,
        &original.id,
        &original.client_id,
        identity("account-subject"),
        original.tokens.clone().unwrap()
    )
    .is_err());
    state.profiles[0] = original.clone();
    assert!(complete_sign_in(
        &mut state,
        &original.id,
        &original.client_id,
        identity("different-subject"),
        original.tokens.unwrap()
    )
    .is_err());
    assert_eq!(
        state.profiles[0].email.as_deref(),
        Some("before@example.test")
    );
    assert!(state.active_profile_id.is_none());
}
