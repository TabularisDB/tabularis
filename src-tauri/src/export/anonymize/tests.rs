use super::*;
use serde_json::json;

fn spec(rules: &[(&str, AnonymizeRule)]) -> AnonymizeSpec {
    AnonymizeSpec {
        key: "test-export-key".to_string(),
        rules: rules
            .iter()
            .map(|(name, rule)| (name.to_string(), rule.clone()))
            .collect(),
    }
}

#[test]
fn fixed_value_replaces_with_literal() {
    let anonymizer = RowAnonymizer::new(spec(&[(
        "name",
        AnonymizeRule::Fixed {
            value: Some("***".to_string()),
        },
    )]));
    let headers = vec!["id".to_string(), "name".to_string()];
    let mut values = vec![json!(1), json!("Alice")];

    anonymizer.apply(&headers, &mut values);

    assert_eq!(values, vec![json!(1), json!("***")]);
}

#[test]
fn fixed_none_writes_real_null() {
    let anonymizer = RowAnonymizer::new(spec(&[("name", AnonymizeRule::Fixed { value: None })]));
    let headers = vec!["name".to_string()];
    let mut values = vec![json!("Alice")];

    anonymizer.apply(&headers, &mut values);

    assert_eq!(values, vec![Value::Null]);
}

#[test]
fn nulls_pass_through_untouched() {
    let anonymizer = RowAnonymizer::new(spec(&[
        ("name", AnonymizeRule::Hmac),
        (
            "email",
            AnonymizeRule::Fixed {
                value: Some("***".to_string()),
            },
        ),
    ]));
    let headers = vec!["name".to_string(), "email".to_string()];
    let mut values = vec![Value::Null, Value::Null];

    anonymizer.apply(&headers, &mut values);

    assert_eq!(values, vec![Value::Null, Value::Null]);
}

#[test]
fn unlisted_columns_pass_through() {
    let anonymizer = RowAnonymizer::new(spec(&[("secret", AnonymizeRule::Hmac)]));
    let headers = vec!["id".to_string(), "secret".to_string()];
    let mut values = vec![json!(42), json!("abc")];
    let original_id = values[0].clone();

    anonymizer.apply(&headers, &mut values);

    assert_eq!(values[0], original_id);
    assert_ne!(values[1], json!("abc"));
}

#[test]
fn hmac_is_deterministic_for_same_key() {
    let a = RowAnonymizer::new(spec(&[("user_id", AnonymizeRule::Hmac)]));
    let b = RowAnonymizer::new(spec(&[("user_id", AnonymizeRule::Hmac)]));
    let headers = vec!["user_id".to_string()];

    let mut va = vec![json!("12345")];
    let mut vb = vec![json!("12345")];
    a.apply(&headers, &mut va);
    b.apply(&headers, &mut vb);

    assert_eq!(va, vb);
    assert_eq!(
        va[0].as_str().unwrap().len(),
        super::HMAC_HEX_LEN,
        "digest is truncated to HMAC_HEX_LEN hex chars"
    );
}

#[test]
fn hmac_differs_for_different_keys_and_inputs() {
    let headers = vec!["user_id".to_string()];
    let base = spec(&[("user_id", AnonymizeRule::Hmac)]);

    let mut same_input_other_key = vec![json!("12345")];
    RowAnonymizer::new(AnonymizeSpec {
        key: "another-key".to_string(),
        ..base.clone()
    })
    .apply(&headers, &mut same_input_other_key);

    let mut other_input_same_key = vec![json!("67890")];
    RowAnonymizer::new(base.clone()).apply(&headers, &mut other_input_same_key);

    let mut baseline = vec![json!("12345")];
    RowAnonymizer::new(base).apply(&headers, &mut baseline);

    assert_ne!(baseline, same_input_other_key);
    assert_ne!(baseline, other_input_same_key);
}

#[test]
fn hmac_hashes_non_string_values_by_their_export_text() {
    let anonymizer = RowAnonymizer::new(spec(&[("n", AnonymizeRule::Hmac)]));
    let headers = vec!["n".to_string()];

    let mut from_number = vec![json!(12345)];
    let mut from_string = vec![json!("12345")];
    anonymizer.apply(&headers, &mut from_number);
    anonymizer.apply(&headers, &mut from_string);

    assert_eq!(
        from_number, from_string,
        "12345 (number) and \"12345\" (string) render identically in CSV/JSON"
    );
}

#[test]
fn partial_mask_keeps_edges() {
    assert_eq!(partial_mask("Jonathan", 2, 2), "Jo***an");
    assert_eq!(partial_mask("Jonathan", 1, 0), "J***");
    assert_eq!(partial_mask("Jonathan", 0, 3), "***han");
}

#[test]
fn partial_mask_fully_masks_short_values() {
    assert_eq!(partial_mask("ab", 2, 2), "***");
    assert_eq!(partial_mask("x", 1, 0), "***");
    assert_eq!(partial_mask("", 1, 1), "");
}

#[test]
fn partial_mask_is_multibyte_safe() {
    // 6 chars; keep 1 + 1 → first + *** + last.
    assert_eq!(partial_mask("日本語テスト", 1, 1), "日***ト");
}

#[test]
fn partial_mask_handles_emails_per_segment() {
    assert_eq!(partial_mask("john@example.com", 1, 0), "j***@***.com");
    assert_eq!(partial_mask("a@b.io", 1, 0), "a***@***.io");
    // Not email-shaped → generic masking.
    assert_eq!(partial_mask("a@b@c.com", 1, 0), "a***");
    assert_eq!(partial_mask("no-at-sign", 1, 0), "n***");
}

#[test]
fn partial_rule_applies_to_non_string_values() {
    let anonymizer = RowAnonymizer::new(spec(&[(
        "token",
        AnonymizeRule::Partial {
            keep_start: 2,
            keep_end: 1,
        },
    )]));
    let headers = vec!["token".to_string()];
    let mut values = vec![json!(123456)];

    anonymizer.apply(&headers, &mut values);

    assert_eq!(values, vec![json!("12***6")]);
}

#[test]
fn empty_rule_set_is_a_noop() {
    let anonymizer = RowAnonymizer::new(AnonymizeSpec {
        key: String::new(),
        rules: HashMap::new(),
    });
    assert!(anonymizer.is_noop());
}

#[test]
fn rule_deserialization_matches_frontend_payload() {
    let spec: AnonymizeSpec = serde_json::from_value(json!({
        "key": "abc123",
        "rules": {
            "name": { "type": "fixed", "value": "***" },
            "email": { "type": "partial", "keep_start": 1, "keep_end": 0 },
            "user_id": { "type": "hmac" },
            "gone": { "type": "fixed", "value": null }
        }
    }))
    .unwrap();

    assert_eq!(spec.key, "abc123");
    assert_eq!(
        spec.rules["name"],
        AnonymizeRule::Fixed {
            value: Some("***".to_string())
        }
    );
    assert_eq!(
        spec.rules["email"],
        AnonymizeRule::Partial {
            keep_start: 1,
            keep_end: 0
        }
    );
    assert_eq!(spec.rules["user_id"], AnonymizeRule::Hmac);
    assert_eq!(spec.rules["gone"], AnonymizeRule::Fixed { value: None });
}

#[test]
fn partial_rule_defaults_keep_start_to_one() {
    let rule: AnonymizeRule = serde_json::from_value(json!({ "type": "partial" })).unwrap();
    assert_eq!(
        rule,
        AnonymizeRule::Partial {
            keep_start: 1,
            keep_end: 0
        }
    );
}
