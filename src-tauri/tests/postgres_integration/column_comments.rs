use crate::helpers::pg_params;
use futures::FutureExt;
use tabularis_lib::drivers::driver_trait::DatabaseDriver;
use tabularis_lib::drivers::postgres::{self, PostgresDriver};
use tabularis_lib::models::ColumnDefinition;

#[tokio::test]
#[ignore]
async fn column_comments_round_trip_without_changing_defaults_or_constraints() {
    require_pg!();
    let params = pg_params();
    let driver = PostgresDriver::new();
    let schema = format!("comment_test_{}", uuid::Uuid::new_v4().simple());
    postgres::execute_query(
        &params,
        &format!("CREATE SCHEMA \"{schema}\""),
        None,
        1,
        None,
    )
    .await
    .unwrap();
    let outcome = std::panic::AssertUnwindSafe(async {
        postgres::execute_query(
            &params,
            &format!("CREATE TABLE \"{schema}\".customers (id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL DEFAULT 'unknown', UNIQUE (email))"),
            None, 1, None,
        ).await.unwrap();

        let old = ColumnDefinition {
            name: "email".into(),
            data_type: "VARCHAR(255)".into(),
            is_nullable: false,
            is_pk: false,
            is_auto_increment: false,
            default_value: Some("'unknown'::character varying".into()),
            comment: None,
            on_update: None,
        };
        let before_columns = postgres::get_columns(&params, "customers", &schema)
            .await
            .unwrap();
        let before_indexes = postgres::get_indexes(&params, "customers", &schema)
            .await
            .unwrap();
        let mut previous = old.clone();
        for text in [
            Some("  Customer's email\\path\n日本語  "),
            Some("replacement"),
            None,
        ] {
            let new = ColumnDefinition {
                comment: text.map(str::to_string),
                ..old.clone()
            };
            let statements = driver
                .get_alter_column_sql("customers", previous, new.clone(), Some(&schema))
                .await
                .unwrap();
            assert_eq!(statements.len(), 1);
            for sql in statements {
                postgres::execute_query(&params, &sql, None, 1, Some(&schema))
                    .await
                    .unwrap();
            }
            let mut after = postgres::get_columns(&params, "customers", &schema)
                .await
                .unwrap();
            assert_eq!(
                after
                    .iter()
                    .find(|c| c.name == "email")
                    .unwrap()
                    .comment
                    .as_deref(),
                text
            );
            // Compare all other metadata with the original, using the same serialization.
            after.iter_mut().find(|c| c.name == "email").unwrap().comment = None;
            assert_eq!(
                serde_json::to_value(&after).unwrap(),
                serde_json::to_value(&before_columns).unwrap()
            );
            assert_eq!(
                serde_json::to_value(
                    postgres::get_indexes(&params, "customers", &schema)
                        .await
                        .unwrap()
                )
                .unwrap(),
                serde_json::to_value(&before_indexes).unwrap()
            );
            previous = new;
        }

        let added = ColumnDefinition {
            name: "notes".into(),
            data_type: "TEXT".into(),
            is_nullable: true,
            default_value: None,
            comment: Some("New column's note".into()),
            ..old
        };
        for sql in driver
            .get_add_column_sql("customers", added, Some(&schema))
            .await
            .unwrap()
        {
            postgres::execute_query(&params, &sql, None, 1, Some(&schema))
                .await
                .unwrap();
        }
        let columns = postgres::get_columns(&params, "customers", &schema)
            .await
            .unwrap();
        assert_eq!(
            columns
                .iter()
                .find(|c| c.name == "notes")
                .unwrap()
                .comment
                .as_deref(),
            Some("New column's note")
        );
    })
    .catch_unwind()
    .await;

    // A failed assertion must not leave a schema that breaks later golden tests.
    postgres::execute_query(
        &params,
        &format!("DROP SCHEMA \"{schema}\" CASCADE"),
        None,
        1,
        None,
    )
    .await
    .unwrap();
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}
