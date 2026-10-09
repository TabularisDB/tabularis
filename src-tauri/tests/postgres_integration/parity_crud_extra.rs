//! Extra parity tests for CRUD — composite PK, NULL update, insert_with_default,
//! enum column binding.

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::parity::ParityHarness;

#[tokio::test]
#[ignore]
async fn parity_real_primary_keys_round_trip_through_json() {
    require_pg!();
    let harness = ParityHarness::new().await;
    for (target, driver) in harness.targets() {
        for primary_key in ["price", "price, id"] {
            driver
                .execute_query(
                    &harness.params,
                    "DROP TABLE IF EXISTS test_schema.float4_pk_review",
                    None,
                    1,
                    Some("test_schema"),
                )
                .await
                .unwrap();
            driver
                .execute_query(
                    &harness.params,
                    &format!(
                        "CREATE TABLE test_schema.float4_pk_review \
                    (price real, id integer, label text, PRIMARY KEY ({primary_key}))"
                    ),
                    None,
                    1,
                    Some("test_schema"),
                )
                .await
                .unwrap();
            for price in [
                89.9f32,
                f32::from_bits(0x15ae43fd),
                -f32::from_bits(0x15ae43fd),
            ] {
                let data = HashMap::from([
                    ("price".to_string(), json!(price)),
                    ("id".to_string(), json!(1)),
                    ("label".to_string(), json!("before")),
                ]);
                driver
                    .insert_record(
                        &harness.params,
                        "float4_pk_review",
                        data,
                        Some("test_schema"),
                        0,
                    )
                    .await
                    .unwrap();
                let result = driver
                    .execute_query(
                        &harness.params,
                        "SELECT price FROM test_schema.float4_pk_review",
                        None,
                        1,
                        Some("test_schema"),
                    )
                    .await
                    .unwrap();
                let encoded = serde_json::to_string(&result.rows[0][0]).unwrap();
                let decoded: Value = serde_json::from_str(&encoded).unwrap();
                assert_eq!(
                    (decoded.as_f64().unwrap() as f32).to_bits(),
                    price.to_bits(),
                    "{target}"
                );
                let mut pk_map = HashMap::from([("price".to_string(), decoded)]);
                if primary_key == "price, id" {
                    pk_map.insert("id".to_string(), json!(1));
                }
                let updated = driver
                    .update_record(
                        &harness.params,
                        "float4_pk_review",
                        &pk_map,
                        "label",
                        json!("after"),
                        Some("test_schema"),
                        0,
                    )
                    .await
                    .unwrap();
                assert_eq!(updated, 1, "{target}: {primary_key}, {price}");
                let deleted = driver
                    .delete_record(
                        &harness.params,
                        "float4_pk_review",
                        &pk_map,
                        Some("test_schema"),
                    )
                    .await
                    .unwrap();
                assert_eq!(deleted, 1, "{target}: {primary_key}, {price}");
            }
            driver
                .execute_query(
                    &harness.params,
                    "DROP TABLE test_schema.float4_pk_review",
                    None,
                    1,
                    Some("test_schema"),
                )
                .await
                .unwrap();
        }
    }
}

#[tokio::test]
#[ignore]
async fn parity_update_composite_pk() {
    require_pg!();
    let harness = ParityHarness::new().await;

    // order_items has composite PK (order_id, item_no) and order_id has an FK
    // to orders(id). The seed only creates order id=1, so reuse it here with
    // a distinct item_no to avoid colliding with the seeded (1, 1) row.
    for (_target, driver) in harness.targets() {
        let _ = driver
            .execute_query(
                &harness.params,
                "INSERT INTO test_schema.order_items(order_id, item_no, product) \
                 VALUES (1, 99, 'Parity Widget') ON CONFLICT (order_id, item_no) DO NOTHING",
                None,
                1,
                Some("test_schema"),
            )
            .await;
    }

    // Update using composite PK
    let result = harness
        .assert_parity("update_record:composite_pk", |driver, params| async move {
            let mut pk_map = HashMap::new();
            pk_map.insert("order_id".to_string(), json!(1));
            pk_map.insert("item_no".to_string(), json!(99));
            driver
                .update_record(
                    &params,
                    "order_items",
                    &pk_map,
                    "product",
                    json!("Parity Updated Widget"),
                    Some("test_schema"),
                    0,
                )
                .await
        })
        .await;

    let affected = result.as_u64().expect("update should return affected rows");
    assert_eq!(
        affected, 1,
        "Composite PK update should affect exactly 1 row"
    );

    // Restore original value
    for (_target, driver) in harness.targets() {
        let mut pk_map = HashMap::new();
        pk_map.insert("order_id".to_string(), json!(1));
        pk_map.insert("item_no".to_string(), json!(99));
        let _ = driver
            .update_record(
                &harness.params,
                "order_items",
                &pk_map,
                "product",
                json!("Parity Widget"),
                Some("test_schema"),
                0,
            )
            .await;
    }
}

#[tokio::test]
#[ignore]
async fn parity_update_to_null() {
    require_pg!();
    let harness = ParityHarness::new().await;

    // Setup: insert a row with a non-null value
    for (_target, driver) in harness.targets() {
        let _ = driver
            .execute_query(
                &harness.params,
                "INSERT INTO test_schema.crud_scratch(id, name, value) \
                 VALUES (9010, 'parity_null_update', 42) \
                 ON CONFLICT (id) DO UPDATE SET value = 42",
                None,
                1,
                Some("test_schema"),
            )
            .await;
    }

    // Update the value column to NULL
    let result = harness
        .assert_parity("update_record:set_null", |driver, params| async move {
            let mut pk_map = HashMap::new();
            pk_map.insert("id".to_string(), json!(9010));
            driver
                .update_record(
                    &params,
                    "crud_scratch",
                    &pk_map,
                    "value",
                    json!(null),
                    Some("test_schema"),
                    0,
                )
                .await
        })
        .await;

    let affected = result.as_u64().expect("update should return affected rows");
    assert_eq!(affected, 1, "NULL update should affect 1 row");

    // Verify the value is now NULL
    let verify = harness
        .assert_parity(
            "execute_query:verify_null_update",
            |driver, params| async move {
                driver
                    .execute_query(
                        &params,
                        "SELECT value FROM test_schema.crud_scratch WHERE id = 9010",
                        Some(100),
                        1,
                        Some("test_schema"),
                    )
                    .await
            },
        )
        .await;

    let rows = verify.get("rows").and_then(Value::as_array).unwrap();
    assert_eq!(rows.len(), 1);
    let value = rows[0]
        .as_array()
        .and_then(|arr| arr.first())
        .unwrap_or(&Value::Null);
    assert!(
        value.is_null(),
        "Value should be NULL after update, got: {:?}",
        value
    );
}

#[tokio::test]
#[ignore]
async fn parity_insert_with_default() {
    require_pg!();
    let harness = ParityHarness::new().await;

    // Insert only the name column — let `id` use its DEFAULT (serial/auto-increment)
    // and `value` default to NULL.
    let result = harness
        .assert_parity("insert_record:with_default", |driver, params| async move {
            let mut data = HashMap::new();
            data.insert("name".to_string(), json!("parity_default_test"));
            driver
                .insert_record(&params, "crud_scratch", data, Some("test_schema"), 0)
                .await
        })
        .await;

    let affected = result.as_u64().expect("insert should return affected rows");
    assert_eq!(
        affected, 1,
        "Insert with defaults should affect exactly 1 row"
    );

    // Verify the row was inserted (value should be NULL since we didn't set it)
    let verify = harness
        .assert_parity(
            "execute_query:verify_default_insert",
            |driver, params| async move {
                driver
                    .execute_query(
                        &params,
                        "SELECT name, value FROM test_schema.crud_scratch \
                         WHERE name = 'parity_default_test' LIMIT 1",
                        Some(100),
                        1,
                        Some("test_schema"),
                    )
                    .await
            },
        )
        .await;

    let rows = verify.get("rows").and_then(Value::as_array).unwrap();
    assert!(!rows.is_empty(), "Inserted row should be queryable");
}

#[tokio::test]
#[ignore]
async fn parity_insert_enum_value() {
    require_pg!();
    let harness = ParityHarness::new().await;

    // with_enum.current_mood is a PostgreSQL enum (test_schema.mood). Binding
    // an enum column requires a CAST($N AS <enum_type>) — without it, the
    // driver sends a plain TEXT parameter and PostgreSQL rejects it with
    // "column current_mood is of type mood but expression is of type text".
    // insert_record is destructive (adds a row neither target can attribute
    // to a stable id), so clean up per target inside the loop.
    for (target, driver) in harness.targets() {
        let mut data = HashMap::new();
        data.insert("current_mood".to_string(), json!("sad"));

        let affected = driver
            .insert_record(&harness.params, "with_enum", data, Some("test_schema"), 0)
            .await
            .unwrap_or_else(|e| {
                panic!("insert_record with enum value failed on {}: {}", target, e)
            });
        assert_eq!(
            affected, 1,
            "{}: inserting one enum row should affect 1 row",
            target
        );

        driver
            .execute_query(
                &harness.params,
                "DELETE FROM test_schema.with_enum WHERE current_mood = 'sad'",
                None,
                1,
                Some("test_schema"),
            )
            .await
            .unwrap_or_else(|e| panic!("cleanup delete failed on {}: {}", target, e));
    }
}

#[tokio::test]
#[ignore]
async fn parity_update_enum_value() {
    require_pg!();
    let harness = ParityHarness::new().await;

    // Same enum-CAST requirement as parity_insert_enum_value, exercised via
    // update_record instead. Seed row id=1 always exists (see
    // tests/fixtures/postgres_seed.sql) with current_mood = 'happy'.
    for (target, driver) in harness.targets() {
        let mut pk_map = HashMap::new();
        pk_map.insert("id".to_string(), json!(1));

        let affected = driver
            .update_record(
                &harness.params,
                "with_enum",
                &pk_map,
                "current_mood",
                json!("neutral"),
                Some("test_schema"),
                0,
            )
            .await
            .unwrap_or_else(|e| {
                panic!("update_record with enum value failed on {}: {}", target, e)
            });
        assert_eq!(
            affected, 1,
            "{}: updating the enum column should affect 1 row",
            target
        );

        // Restore the seeded value so later tests see the original state.
        driver
            .update_record(
                &harness.params,
                "with_enum",
                &pk_map,
                "current_mood",
                json!("happy"),
                Some("test_schema"),
                0,
            )
            .await
            .unwrap_or_else(|e| panic!("restore failed on {}: {}", target, e));
    }
}
