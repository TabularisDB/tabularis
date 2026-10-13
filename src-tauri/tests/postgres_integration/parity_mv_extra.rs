//! Extra parity tests for materialized views — MV definition retrieval.
//!
//! Both the built-in PostgreSQL driver and the plugin driver must return the
//! same materialized view definition. Earlier the built-in driver failed with
//! "error serializing parameter 0" on PG 16 because it bound a `String`
//! directly to `regclass`; the fix casts through `text` first, matching
//! `get_view_definition`.

use crate::parity::ParityHarness;

#[tokio::test]
#[ignore]
async fn parity_get_materialized_view_definition() {
    require_pg!();
    let harness = ParityHarness::new().await;

    harness
        .assert_parity(
            "get_materialized_view_definition:user_stats",
            |driver, params| async move {
                driver
                    .get_materialized_view_definition(&params, "user_stats", Some("test_schema"))
                    .await
            },
        )
        .await;
}
