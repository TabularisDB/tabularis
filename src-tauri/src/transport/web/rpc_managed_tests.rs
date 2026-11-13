use super::tests::{dispatch_json, response_json, FixtureApplication};
use super::*;
use serde_json::json;
use uuid::Uuid;

const DENIED: &str = "managed_connection_denied";

fn dispatcher_with(
    application: FixtureApplication,
    policy: ManagedConnectionPolicy,
) -> RpcDispatcher {
    RpcDispatcher::with_access_policy(
        Arc::new(application),
        RpcAccessPolicy {
            connection_policy: policy,
            ..RpcAccessPolicy::default()
        },
    )
}

fn managed(policy: ManagedConnectionPolicy) -> RpcDispatcher {
    dispatcher_with(FixtureApplication::new(Duration::ZERO), policy)
}

async fn call(dispatcher: &RpcDispatcher, command: &str, payload: Value) -> (StatusCode, Value) {
    // LocalAdmin so the authorization level never masks the managed policy.
    let response = dispatch_json(
        dispatcher,
        command,
        payload,
        Some(Uuid::new_v4()),
        AuthorizationLevel::LocalAdmin,
    )
    .await;
    let status = response.status();
    (status, response_json(response).await)
}

fn code(body: &Value) -> &str {
    body["error"]["code"].as_str().unwrap_or_default()
}

fn connection_params() -> Value {
    json!({"driver": "postgres", "host": "db.internal", "port": 5432, "database": "app",
           "username": "reader", "ssh_enabled": false})
}

#[tokio::test]
async fn managed_only_denies_every_connection_management_command_with_the_stable_code() {
    let dispatcher = managed(ManagedConnectionPolicy::managed_only());
    for command in [
        "save_connection",
        "update_connection",
        "delete_connection",
        "duplicate_connection",
        "test_connection",
        "list_databases",
        "set_connection_appearance",
        "save_connection_icon",
        "delete_connection_icon",
        "create_connection_group",
        "create_group_path",
        "update_connection_group",
        "move_group_to_parent",
        "delete_connection_group",
        "move_connection_to_group",
        "reorder_groups",
        "reorder_connections_in_group",
        "create_connection_tag",
        "update_connection_tag",
        "delete_connection_tag",
        "set_connection_tags",
        "export_connections_file",
        "list_connection_import_sources",
        "preview_connection_import",
        "apply_connection_import",
        "preview_tabularis_import_file",
        "apply_prepared_tabularis_import",
        "run_connections_backup",
        "set_connections_backup_password",
        "save_ssh_connection",
        "update_k8s_connection",
        "test_ssh_connection",
    ] {
        // An empty payload proves the denial happens before any decoding.
        let (status, body) = call(&dispatcher, command, json!({})).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{command}");
        assert_eq!(code(&body), DENIED, "{command}");
        assert_eq!(body["ok"], false, "{command}");
    }
}

#[tokio::test]
async fn managed_connections_stay_usable_for_normal_database_operations() {
    let dispatcher = managed(ManagedConnectionPolicy::managed_only());
    for (command, payload) in [
        ("get_connections", json!(null)),
        ("get_connections_with_groups", json!(null)),
        ("get_connection_by_id", json!({"id": "managed-1"})),
        (
            "register_active_connection",
            json!({"connectionId": "managed-1"}),
        ),
        (
            "disconnect_connection",
            json!({"connectionId": "managed-1"}),
        ),
        ("get_active_connections", json!(null)),
        ("get_registered_drivers", json!(null)),
    ] {
        let (status, body) = call(&dispatcher, command, payload).await;
        assert_ne!(code(&body), DENIED, "{command}");
        assert_eq!(status, StatusCode::OK, "{command}: {body}");
    }
}

#[tokio::test]
async fn standalone_never_returns_the_managed_denial() {
    let dispatcher = managed(ManagedConnectionPolicy::standalone());
    for command in [
        "save_connection",
        "delete_connection",
        "export_connections_file",
        "apply_prepared_tabularis_import",
        "create_connection_tag",
        "save_connection_icon",
    ] {
        let (_, body) = call(&dispatcher, command, json!({})).await;
        assert_ne!(code(&body), DENIED, "{command}");
    }
}

#[tokio::test]
async fn the_branding_and_organization_switches_are_independent() {
    let branding = managed(ManagedConnectionPolicy::managed_only().with_branding_allowed(true));
    let (_, body) = call(&branding, "delete_connection_icon", json!({})).await;
    assert_ne!(code(&body), DENIED);
    let (_, body) = call(&branding, "create_connection_tag", json!({})).await;
    assert_eq!(code(&body), DENIED);

    let organization =
        managed(ManagedConnectionPolicy::managed_only().with_organization_allowed(true));
    let (_, body) = call(&organization, "create_connection_tag", json!({})).await;
    assert_ne!(code(&body), DENIED);
    let (_, body) = call(&organization, "set_connection_appearance", json!({})).await;
    assert_eq!(code(&body), DENIED);
}

#[tokio::test]
async fn switches_do_not_open_connection_management() {
    let dispatcher = managed(
        ManagedConnectionPolicy::managed_only()
            .with_branding_allowed(true)
            .with_organization_allowed(true),
    );
    for command in ["save_connection", "update_connection", "delete_connection"] {
        let (_, body) = call(&dispatcher, command, json!({})).await;
        assert_eq!(code(&body), DENIED, "{command}");
    }
}

#[tokio::test]
async fn destination_overrides_on_a_managed_connection_id_are_denied() {
    let dispatcher = managed(ManagedConnectionPolicy::managed_only());
    let mut redirected = connection_params();
    redirected["host"] = json!("attacker.example");

    let (status, body) = call(
        &dispatcher,
        "update_connection",
        json!({"id": "managed-1", "name": "Managed", "params": redirected}),
    )
    .await;
    assert_eq!((status, code(&body)), (StatusCode::FORBIDDEN, DENIED));

    for command in ["test_connection", "list_databases"] {
        let (status, body) = call(
            &dispatcher,
            command,
            json!({"request": {"params": redirected, "connection_id": "managed-1"}}),
        )
        .await;
        assert_eq!(
            (status, code(&body)),
            (StatusCode::FORBIDDEN, DENIED),
            "{command}"
        );
    }

    // A tunnel or proxy swapped onto the same id is the same override.
    let mut tunnelled = connection_params();
    tunnelled["ssh_host"] = json!("jump.attacker.example");
    tunnelled["ssh_enabled"] = json!(true);
    let (_, body) = call(
        &dispatcher,
        "update_connection",
        json!({"id": "managed-1", "name": "Managed", "params": tunnelled}),
    )
    .await;
    assert_eq!(code(&body), DENIED);
}

#[tokio::test]
async fn a_smuggled_connection_import_is_denied_before_it_is_read() {
    let dispatcher = managed(ManagedConnectionPolicy::managed_only());
    let smuggled = json!({
        "file": {"kind": "upload", "token": "t"},
        "resolutions": [{"index": 0, "action": "import"}],
    });
    for command in [
        "preview_tabularis_import_file",
        "apply_prepared_tabularis_import",
        "apply_connection_import",
        "preview_connection_import",
    ] {
        let (status, body) = call(&dispatcher, command, smuggled.clone()).await;
        assert_eq!(
            (status, code(&body)),
            (StatusCode::FORBIDDEN, DENIED),
            "{command}"
        );
    }
}

#[tokio::test]
async fn exports_and_backups_cannot_carry_connections_out() {
    let dispatcher = managed(ManagedConnectionPolicy::managed_only());
    for (command, payload) in [
        ("export_connections_file", json!({"mode": "plain"})),
        ("run_connections_backup", json!(null)),
        (
            "set_connections_backup_target_password",
            json!({"targetId": "t", "password": "x"}),
        ),
    ] {
        let (_, body) = call(&dispatcher, command, payload).await;
        assert_eq!(code(&body), DENIED, "{command}");
    }
}

#[tokio::test]
async fn a_forged_managed_flag_in_a_browser_payload_is_rejected() {
    let dispatcher = managed(ManagedConnectionPolicy::standalone());
    for command in ["save_connection", "update_connection"] {
        let (status, body) = call(
            &dispatcher,
            command,
            json!({"id": "c", "name": "Forged", "params": connection_params(), "managed": true}),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{command}");
        assert_eq!(code(&body), "INVALID_REQUEST", "{command}");
    }
}

#[tokio::test]
async fn the_denial_names_the_action_and_carries_no_payload_data() {
    let dispatcher = managed(ManagedConnectionPolicy::managed_only());
    let mut params = connection_params();
    params["password"] = json!("pw-in-the-request");
    let (_, body) = call(
        &dispatcher,
        "save_connection",
        json!({"name": "n", "params": params}),
    )
    .await;
    assert_eq!(body["error"]["details"]["action"], "create");
    assert!(!body.to_string().contains("pw-in-the-request"));
}

fn failing_dispatcher(
    message: &str,
    secret: &str,
    policy: ManagedConnectionPolicy,
) -> RpcDispatcher {
    let mut application = FixtureApplication::new(Duration::ZERO);
    application.failure = Some(message.to_string());
    application.secrets = vec![secret.to_string()];
    dispatcher_with(application, policy)
}

async fn failing_call(dispatcher: &RpcDispatcher) -> (StatusCode, Value) {
    call(
        dispatcher,
        "register_active_connection",
        json!({"connectionId": "managed-1"}),
    )
    .await
}

#[tokio::test]
async fn driver_errors_cannot_carry_a_stored_credential_to_the_browser() {
    let dispatcher = failing_dispatcher(
        "FATAL: password authentication failed (password: s3cr3t-db-pw, uri: pg://u:s3cr3t-db-pw@h)",
        "s3cr3t-db-pw",
        ManagedConnectionPolicy::managed_only(),
    );

    let (status, body) = failing_call(&dispatcher).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(!body.to_string().contains("s3cr3t-db-pw"), "{body}");
    assert!(body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("[redacted]"));
}

#[tokio::test]
async fn driver_errors_cannot_carry_a_short_stored_password_to_the_browser() {
    for secret in ["a", "ab", "abc"] {
        let dispatcher = failing_dispatcher(
            &format!("driver rejected password {secret}"),
            secret,
            ManagedConnectionPolicy::managed_only(),
        );

        let (status, body) = failing_call(&dispatcher).await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(body["error"]["message"], "[redacted]", "{secret}");
    }
}

#[tokio::test]
async fn standalone_error_messages_are_passed_through_unchanged() {
    let dispatcher = failing_dispatcher(
        "login failed for s3cr3t-db-pw",
        "s3cr3t-db-pw",
        ManagedConnectionPolicy::standalone(),
    );

    let (_, body) = failing_call(&dispatcher).await;
    assert_eq!(body["error"]["message"], "login failed for s3cr3t-db-pw");
}
