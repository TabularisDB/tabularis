//! Extra parity tests for materialized views — MV definition retrieval.
//!
//! Both the built-in PostgreSQL driver and the plugin driver must return the
//! same materialized view definition. The built-in driver failed on PG 16
//! ("error serializing parameter 0") when it bound a `String` directly to
//! `regclass`. It now resolves the MV by a `pg_class`/`pg_namespace` join
//! with `relkind = 'm'`, binding schema/name as text — which also avoids
//! the regclass serialization failure. See `get_view_definition` for the
//! plain-view variant.

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
