//! Parity tests for routine (function/procedure) and trigger introspection.

use serde_json::Value;

use crate::parity::ParityHarness;

#[tokio::test]
#[ignore]
async fn parity_get_routine_parameters() {
    require_pg!();
    let harness = ParityHarness::new().await;

    let result = harness
        .assert_parity(
            "get_routine_parameters:add_numbers",
            |driver, params| async move {
                driver
                    .get_routine_parameters(&params, "add_numbers", Some("test_schema"), None)
                    .await
            },
        )
        .await;

    let params_arr = result
        .as_array()
        .expect("routine parameters should be an array");
    assert!(!params_arr.is_empty(), "add_numbers should have parameters");

    // Verify parameter names are present
    let names: Vec<&str> = params_arr
        .iter()
        .filter_map(|p| p.get("name").and_then(Value::as_str))
        .collect();
    assert!(
        names.contains(&"a") || names.contains(&"b"),
        "add_numbers parameters should include a and/or b, got: {:?}",
        names
    );
}

#[tokio::test]
#[ignore]
async fn parity_get_routine_definition() {
    require_pg!();
    let harness = ParityHarness::new().await;

    let result = harness
        .assert_parity(
            "get_routine_definition:add_numbers",
            |driver, params| async move {
                driver
                    .get_routine_definition(
                        &params,
                        "add_numbers",
                        "function",
                        Some("test_schema"),
                        None,
                    )
                    .await
            },
        )
        .await;

    let definition = result
        .as_str()
        .expect("routine definition should be a string");
    assert!(
        !definition.is_empty(),
        "add_numbers definition should not be empty"
    );
    // The function body should reference addition
    assert!(
        definition.contains('+') || definition.to_lowercase().contains("return"),
        "add_numbers definition should contain arithmetic or RETURN"
    );
}

#[tokio::test]
#[ignore]
async fn parity_get_trigger_definition() {
    require_pg!();
    let harness = ParityHarness::new().await;

    let result = harness
        .assert_parity(
            "get_trigger_definition:trg_audit",
            |driver, params| async move {
                driver
                    .get_trigger_definition(&params, "trg_audit", "all_types", Some("test_schema"))
                    .await
            },
        )
        .await;

    let definition = result
        .as_str()
        .expect("trigger definition should be a string");
    assert!(
        !definition.is_empty(),
        "trg_audit definition should not be empty"
    );
    assert!(
        definition.to_lowercase().contains("trigger")
            || definition.to_lowercase().contains("execute"),
        "trigger definition should reference TRIGGER or EXECUTE"
    );
}
