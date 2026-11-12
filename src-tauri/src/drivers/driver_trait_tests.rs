use crate::drivers::driver_trait::{deprecation_for_builtin, DriverCapabilities, PluginManifest};

#[test]
fn manifest_accepts_both_connection_string_example_spellings() {
    for field in ["connection_string_examples", "connectionStringExamples"] {
        let mut capabilities = serde_json::to_value(DriverCapabilities::default()).unwrap();
        capabilities
            .as_object_mut()
            .unwrap()
            .remove("connection_string_examples");
        capabilities[field] = serde_json::json!([{
            "label": "Local",
            "value": "jdbc:h2:mem:test",
            "description": "In-memory database"
        }]);

        let manifest: PluginManifest = serde_json::from_value(serde_json::json!({
            "id": "jdbc",
            "name": "JDBC",
            "version": "1.0.0",
            "description": "JDBC driver",
            "default_port": null,
            "capabilities": capabilities
        }))
        .unwrap();

        assert_eq!(manifest.capabilities.connection_string_examples.len(), 1);
        assert_eq!(
            manifest.capabilities.connection_string_examples[0].label,
            "Local"
        );
        assert_eq!(
            manifest.capabilities.connection_string_examples[0].value,
            "jdbc:h2:mem:test"
        );
    }
}

#[test]
fn postgres_is_deprecated_in_favour_of_the_postgresql_plugin() {
    let info = deprecation_for_builtin("postgres").expect("postgres is deprecated");
    assert_eq!(info.replacement_id, Some("postgresql".to_string()));
    assert_eq!(info.removal_date, Some("2026-10-05".to_string()));
    assert_eq!(info.removal_version, None);
}

#[test]
fn drivers_without_a_wired_deprecation_return_none() {
    // mysql/sqlite are expected to follow the same path later, but aren't
    // deprecated yet — and an unknown id must not panic or default to some
    // other driver's entry.
    assert!(deprecation_for_builtin("mysql").is_none());
    assert!(deprecation_for_builtin("sqlite").is_none());
    assert!(deprecation_for_builtin("not-a-real-driver").is_none());
}

#[tokio::test]
async fn a_driver_that_does_not_implement_streaming_delivers_its_whole_execute_query_result_as_one_batch(
) {
    use crate::drivers::driver_trait::{DatabaseDriver, QueryChunk};
    use serde_json::json;
    let rows: Vec<_> = (0..1200).map(|i| vec![json!(i)]).collect();
    let response = json!({ "columns": ["x"], "rows": rows, "affected_rows": 0 });
    let driver = crate::plugins::driver::test_driver(move |request| {
        assert_eq!(request.method, "execute_query");
        response.clone()
    });
    let mut chunks = Vec::new();
    driver
        .execute_query_stream(&Default::default(), "SELECT x", None, None, &mut |chunk| {
            chunks.push(chunk)
        })
        .await
        .unwrap();
    assert_eq!(
        chunks,
        [
            QueryChunk::Columns(vec!["x".into()]),
            QueryChunk::Rows(rows)
        ]
    );
}
