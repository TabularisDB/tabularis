//! Routine (function/procedure) management tests.

use crate::helpers::pg_params;
use tabularis_lib::drivers::postgres;

#[tokio::test]
#[ignore]
async fn test_get_routines_lists_functions() {
    require_pg!();
    let params = pg_params();

    let routines = postgres::get_routines(&params, "test_schema")
        .await
        .expect("get_routines should succeed");

    let routine_names: Vec<&str> = routines.iter().map(|r| r.name.as_str()).collect();
    assert!(
        routine_names.contains(&"add_numbers"),
        "Expected add_numbers function, got: {:?}",
        routine_names
    );
    assert!(
        routine_names.contains(&"get_user"),
        "Expected get_user function"
    );
}

#[tokio::test]
#[ignore]
async fn test_get_routines_lists_procedures() {
    require_pg!();
    let params = pg_params();

    let routines = postgres::get_routines(&params, "test_schema")
        .await
        .expect("get_routines should succeed");

    let proc_names: Vec<&str> = routines
        .iter()
        .filter(|r| r.routine_type == "PROCEDURE")
        .map(|r| r.name.as_str())
        .collect();

    assert!(
        proc_names.contains(&"reset_orders"),
        "Expected reset_orders procedure, got: {:?}",
        proc_names
    );
}

#[tokio::test]
#[ignore]
async fn test_get_routines_overloaded_functions() {
    require_pg!();
    let params = pg_params();

    let routines = postgres::get_routines(&params, "test_schema")
        .await
        .expect("get_routines should succeed");

    // add_numbers is overloaded: (int, int) and (int, int, int)
    let add_numbers_count = routines.iter().filter(|r| r.name == "add_numbers").count();
    assert_eq!(
        add_numbers_count, 2,
        "Expected 2 overloaded add_numbers functions"
    );
}

#[tokio::test]
#[ignore]
async fn test_get_routine_parameters() {
    require_pg!();
    let params = pg_params();

    // Signature-less: still the pre-#893 read, whose list may carry the
    // parameters of every overload at once. That is what this assertion has
    // always tolerated, and the arm below is the one that does not.
    let routine_params =
        postgres::get_routine_parameters(&params, "add_numbers", "test_schema", None)
            .await
            .expect("get_routine_parameters should succeed");

    assert!(
        routine_params.len() >= 2,
        "add_numbers should have at least 2 parameters, got: {}",
        routine_params.len()
    );

    // Asked for one overload by its signature, the list is that overload's own.
    // `add_numbers` is seeded with a two-argument and a three-argument version,
    // so without the filter this came back with every overload's parameters in
    // one list, two of them at ordinal_position 1 (#893).
    let two_arg = postgres::get_routine_parameters(
        &params,
        "add_numbers",
        "test_schema",
        Some("a integer, b integer"),
    )
    .await
    .expect("get_routine_parameters for the two-argument overload");

    let named: Vec<&str> = two_arg
        .iter()
        .filter(|p| !p.name.is_empty())
        .map(|p| p.name.as_str())
        .collect();
    assert_eq!(
        named,
        vec!["a", "b"],
        "the two-argument overload takes exactly a and b, got: {named:?}"
    );
}

#[tokio::test]
#[ignore]
async fn test_get_routine_definition() {
    require_pg!();
    let params = pg_params();

    let def = postgres::get_routine_definition(&params, "get_user", "FUNCTION", "test_schema", None)
        .await
        .expect("get_routine_definition should succeed");

    assert!(
        def.to_lowercase().contains("select") || def.to_lowercase().contains("function"),
        "Function definition should contain SQL, got: {}",
        def
    );
}

#[tokio::test]
#[ignore]
async fn test_drop_routine() {
    require_pg!();
    let params = pg_params();

    // Create a temporary function to test drop
    postgres::execute_query(
        &params,
        "CREATE OR REPLACE FUNCTION test_schema.temp_drop_test(a INT) RETURNS INT LANGUAGE SQL AS $$ SELECT a $$",
        None,
        1,
        None,
    )
    .await
    .expect("create function");

    // Drop it
    let drop_result =
        postgres::drop_routine(&params, "temp_drop_test", "FUNCTION", "test_schema", None).await;

    assert!(
        drop_result.is_ok(),
        "drop_routine should succeed: {:?}",
        drop_result.err()
    );
}
