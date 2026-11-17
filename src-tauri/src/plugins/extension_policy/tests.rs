use super::*;
use serde_json::json;

#[test]
fn plugin_extension_requires_matching_external_driver() {
    assert!(validate_target("neon", "neon").is_ok());
    assert!(validate_target("neon", "postgres").is_err());
    assert!(validate_target("postgres", "postgres").is_err());
    assert!(validate_target("../neon", "../neon").is_err());
    assert!(validate_target("", "").is_err());
}

#[test]
fn plugin_extension_rejects_reserved_methods_and_bad_args() {
    assert!(validate_request("neon_status", &json!({})).is_ok());
    for method in [
        "initialize",
        "execute_query",
        "ping",
        "",
        "neon status",
        "__proto__",
    ] {
        assert!(validate_request(method, &json!({})).is_err(), "{method}");
    }
    assert!(validate_request("neon_status", &json!([])).is_err());
    assert!(validate_request("neon_status", &json!({"body": "x".repeat(1_048_577)})).is_err());
}

#[test]
fn plugin_extension_secrets_are_validated_before_storage() {
    assert!(validate_secrets(&json!({"API_TOKEN": "secret"})).is_ok());
    for secrets in [
        json!({}),
        json!({"API_TOKEN": 4}),
        json!({"API_TOKEN": ""}),
        json!({"bad key": "value"}),
        json!({"API_TOKEN": "x".repeat(65537)}),
    ] {
        assert!(validate_secrets(&secrets).is_err());
    }
    assert_ne!(secret_key("neon", "first"), secret_key("neon", "second"));
    assert_ne!(secret_key("neon", "first"), secret_key("other", "first"));
}
