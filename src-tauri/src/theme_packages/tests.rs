mod archive;
mod author_journeys;
mod catalog;
mod catalog_safety;
mod contract_edges;
mod http_fixture;
mod identity;
mod lifecycle;
mod kind_layout;
mod manual_fixture;
mod metadata;
mod snapshot;
mod snapshot_edit;
mod snapshot_safety;
mod storage;
mod transport;
mod transport_edges;
mod zip_layout;

use super::*;
use serde_json::{json, Value};

#[test]
fn shared_contract_vectors_match_native_validation() {
    let cases: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/themes/validation-v1.json"
    ))
    .unwrap();
    for case in cases.as_array().unwrap() {
        let source = case["source"].as_str().unwrap().as_bytes();
        let result = if case["kind"] == "definition" {
            validate_definition_json(source)
        } else {
            validate_manifest_json(source)
        };
        assert_eq!(
            result.is_ok(),
            case["valid"].as_bool().unwrap(),
            "{}: {:?}",
            case["name"],
            result
        );
    }
}

#[test]
fn json_limits_reject_before_schema_or_recursive_allocation() {
    use super::json::parse_bounded_json;
    let input = "{\"a\":\"é\"}".as_bytes();
    assert!(parse_bounded_json(input, 10, 16, 32768).is_ok());
    assert!(parse_bounded_json(input, 9, 16, 32768)
        .unwrap_err()
        .contains("byte"));
    let depth16 = format!("{}0{}", "[".repeat(16), "]".repeat(16));
    assert!(parse_bounded_json(depth16.as_bytes(), 1024, 16, 32768).is_ok());
    let depth17 = format!("{}0{}", "[".repeat(17), "]".repeat(17));
    assert!(parse_bounded_json(depth17.as_bytes(), 1024, 16, 32768)
        .unwrap_err()
        .contains("depth"));
    let nodes = serde_json::to_vec(&vec![0; 32768]).unwrap();
    assert!(parse_bounded_json(&nodes, 262144, 16, 32768)
        .unwrap_err()
        .contains("node"));
    assert!(parse_bounded_json(&[0xff], 100, 16, 32768).is_err());
    assert!(parse_bounded_json(b"1e1000", 100, 16, 32768).is_err());
}

#[test]
fn portable_paths_reject_platform_ambiguity() {
    for path in [
        ".tabularium",
        "themes/dark.json",
        "README.md",
        "a/b/c/d/e/f/g/h.json",
        "COM10.json",
    ] {
        assert!(is_safe_relative_path(path), "{}", path);
    }
    for path in [
        "",
        "../escape",
        "/absolute",
        "C:/theme",
        "\\\\host\\share",
        "themes\\dark.json",
        "themes//dark.json",
        "themes/CON.json",
        "themes/folder./x.json",
        "themes/a ",
        "themes/a\n",
        "themes/a\0",
        "themes/a:stream",
        "themes/%2e%2e/x",
        "themes/café.json",
        "themes/",
        "a/b/c/d/e/f/g/h/i.json",
    ] {
        assert!(!is_safe_relative_path(path), "{:?}", path);
    }
    assert!(is_safe_relative_path(&"a".repeat(240)));
    assert!(!is_safe_relative_path(&"a".repeat(241)));
}

#[test]
fn registry_identity_is_canonical_and_separate() {
    let key = registry_key("https://EXAMPLE.test:443/registry///").unwrap();
    assert_eq!(key, registry_key("https://example.test/registry").unwrap());
    assert_eq!(key.len(), 64);
    assert_ne!(
        key,
        registry_key("https://other.example.test/registry").unwrap()
    );
    assert_ne!(key, registry_key("https://example.test/another").unwrap());
    for url in [
        "file:///tmp/registry",
        "https://user:pass@example.test",
        "https://example.test?token=a",
        "https://example.test#fragment",
        "invalid",
    ] {
        assert!(registry_key(url).is_err());
    }
}

#[test]
fn runtime_floor_is_fail_closed_and_obeys_semver_precedence() {
    let manifest = json!({"min_runtime_version": "1.0.0+release.2"});
    assert!(validate_runtime_version(&manifest, "1.0.0+release.1").is_ok());
    assert!(validate_runtime_version(&manifest, "1.1.0").is_ok());
    for host in ["0.24.0", "1.0.0-beta.1", "invalid", "v1.0.0", " 1.0.0"] {
        assert!(validate_runtime_version(&manifest, host).is_err());
    }
    assert!(validate_runtime_version(&json!({"min_runtime_version":"^1.0.0"}), "2.0.0").is_err());
    assert!(validate_runtime_version(&json!({}), "2.0.0").is_err());
}

#[test]
fn schema_limits_and_unsupported_fields_are_enforced_natively() {
    assert!(validate_definition_json(&vec![b' '; 262145])
        .unwrap_err()
        .contains("byte"));
    assert!(validate_manifest_json(&vec![b' '; 65537])
        .unwrap_err()
        .contains("byte"));
    for definition in [
        json!({"schemaVersion":1,"mode":"dark","layout":{"spacing":{"base":2}}}),
        json!({"schemaVersion":1,"mode":"dark","editor":{"rules":vec![json!({"token":"string"});1025]}}),
        json!({"schemaVersion":1,"mode":"dark","$ref":"https://invalid.test/remote-schema"}),
    ] {
        assert!(validate_definition_json(&serde_json::to_vec(&definition).unwrap()).is_err());
    }
}
