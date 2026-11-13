//! "Preview changes" for PostgreSQL UPDATE and DELETE (issue #1404): each
//! test previews a statement in its own schema and checks the table was not
//! written.

use crate::helpers::pg_params;
use std::sync::Arc;
use tabularis_lib::application::dml_preview::{
    preview_with_driver, DmlKind, DmlPreview, DmlPreviewRequest,
};
use tabularis_lib::drivers::driver_trait::DatabaseDriver;
use tabularis_lib::drivers::postgres::PostgresDriver;
use tabularis_lib::models::ConnectionParams;
use uuid::Uuid;

fn ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

struct LiveHarness {
    driver: Arc<dyn DatabaseDriver>,
    params: ConnectionParams,
    schema: String,
}

impl LiveHarness {
    async fn setup() -> Option<Self> {
        if !crate::helpers::wait_for_pg().await {
            eprintln!("SKIPPING: PostgreSQL not available on port 54320");
            return None;
        }
        let params = pg_params();
        let driver: Arc<dyn DatabaseDriver> = Arc::new(PostgresDriver::new());
        let schema = format!("dmlp_1404_{}", Uuid::new_v4().simple());
        let harness = Self {
            driver,
            params,
            schema,
        };
        harness
            .exec(&format!(
                "CREATE SCHEMA {} AUTHORIZATION CURRENT_USER",
                ident(&harness.schema)
            ))
            .await
            .expect("create test schema");
        Some(harness)
    }

    async fn exec(&self, sql: &str) -> Result<(), String> {
        self.driver
            .execute_query(&self.params, sql, None, 1, Some(self.schema.as_str()))
            .await
            .map(|_| ())
    }

    async fn query_scalar(&self, sql: &str) -> Result<String, String> {
        let result = self
            .driver
            .execute_query(&self.params, sql, None, 1, Some(self.schema.as_str()))
            .await?;
        let value = result
            .rows
            .first()
            .and_then(|row| row.first())
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        Ok(match value {
            serde_json::Value::String(s) => s,
            other => other.to_string(),
        })
    }

    async fn preview(&self, sql: &str, limit: Option<u32>) -> Result<DmlPreview, String> {
        preview_with_driver(
            self.driver.as_ref(),
            &self.params,
            DmlPreviewRequest {
                connection_id: "live-pg".into(),
                sql: sql.to_string(),
                schema: Some(self.schema.clone()),
                database: None,
                limit,
            },
        )
        .await
    }

    async fn teardown(&self) {
        let sql = format!("DROP SCHEMA IF EXISTS {} CASCADE", ident(&self.schema));
        if let Err(error) = self
            .driver
            .execute_query(&self.params, &sql, None, 1, None)
            .await
        {
            eprintln!("failed to drop test schema {}: {error}", self.schema);
        }
    }
}

macro_rules! live_test {
    ($name:ident, $h:ident, $($body:tt)*) => {
        #[tokio::test]
        #[ignore]
        async fn $name() {
            let Some($h) = LiveHarness::setup().await else {
                return;
            };
            let body = async {
                $($body)*
            };
            body.await;
            $h.teardown().await;
        }
    };
}

live_test!(test_dml_preview_update_preview_shows_current_and_proposed_values, h,
    h.exec(&format!(
        "CREATE TABLE {}.orders (id int PRIMARY KEY, status text, total numeric(10,2), note text, \"My Col\" text)",
        ident(&h.schema)
    ))
    .await
    .unwrap();
    h.exec(&format!(
        "INSERT INTO {}.orders VALUES (1, 'open', 10.50, NULL, 'x'), (2, 'void', 3, 'n', 'y')",
        ident(&h.schema)
    ))
    .await
    .unwrap();

    let preview = h
        .preview(
            &format!(
                "UPDATE {}.orders SET status = 'paid', note = COALESCE(note, 'none') WHERE id = 1",
                ident(&h.schema)
            ),
            Some(10),
        )
        .await
        .expect("preview update");
    assert_eq!(preview.kind, DmlKind::Update);
    assert!(preview.has_filter);
    assert!(!preview.truncated);
    assert_eq!(
        preview.assigned_columns,
        vec!["status".to_string(), "note".to_string()]
    );
    assert_eq!(preview.result.rows.len(), 1);
    assert_eq!(preview.result.rows[0][0], serde_json::json!("open"));
    assert_eq!(preview.result.rows[0][1], serde_json::json!("paid"));
    assert_eq!(preview.result.rows[0][2], serde_json::Value::Null);
    assert_eq!(preview.result.rows[0][3], serde_json::json!("none"));

    let quoted = h
        .preview(
            &format!(
                "UPDATE {}.orders SET \"My Col\" = upper(\"My Col\") WHERE \"My Col\" LIKE 'x%'",
                ident(&h.schema)
            ),
            None,
        )
        .await
        .expect("preview quoted column");
    assert_eq!(quoted.assigned_columns, vec!["My Col".to_string()]);
    assert_eq!(quoted.result.rows[0][0], serde_json::json!("x"));
    assert_eq!(quoted.result.rows[0][1], serde_json::json!("X"));

    let rows = h
        .query_scalar(&format!(
            "SELECT status || ':' || coalesce(note, '') FROM {}.orders WHERE id = 1",
            ident(&h.schema)
        ))
        .await
        .unwrap();
    assert_eq!(rows, "open:", "preview must not write the table");
);

live_test!(test_dml_preview_delete_preview_and_truncation, h,
    h.exec(&format!(
        "CREATE TABLE {}.orders (id int PRIMARY KEY, status text)",
        ident(&h.schema)
    ))
    .await
    .unwrap();
    h.exec(&format!(
        "INSERT INTO {}.orders VALUES (1, 'open'), (2, 'open'), (3, 'void')",
        ident(&h.schema)
    ))
    .await
    .unwrap();

    let preview = h
        .preview(
            &format!(
                "DELETE FROM {}.orders WHERE status <> 'void'",
                ident(&h.schema)
            ),
            Some(1),
        )
        .await
        .expect("preview delete");
    assert_eq!(preview.kind, DmlKind::Delete);
    assert!(preview.has_filter);
    assert!(preview.truncated);
    assert_eq!(preview.result.rows.len(), 1);
    assert_eq!(preview.limit, 1);

    let unfiltered = h
        .preview(&format!("DELETE FROM {}.orders", ident(&h.schema)), Some(10))
        .await
        .expect("preview unfiltered delete");
    assert!(!unfiltered.has_filter);
    assert_eq!(unfiltered.result.rows.len(), 3);
);

live_test!(test_dml_preview_rejects_unsupported_syntax_and_side_effects, h,
    h.exec(&format!(
        "CREATE TABLE {}.orders (id int PRIMARY KEY, status text)",
        ident(&h.schema)
    ))
    .await
    .unwrap();
    h.exec(&format!(
        "CREATE TABLE {}.calls (n int)",
        ident(&h.schema)
    ))
    .await
    .unwrap();
    h.exec(&format!(
        "CREATE FUNCTION bump(a text, b text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN INSERT INTO {}.calls VALUES (1); RETURN a = b; END $$",
        ident(&h.schema)
    ))
    .await
    .unwrap();

    let err = h
        .preview(
            &format!(
                "UPDATE {}.orders SET status = nextval('seq')",
                ident(&h.schema)
            ),
            None,
        )
        .await
        .expect_err("nextval must be rejected");
    assert!(
        err.to_lowercase().contains("nextval"),
        "unexpected rejection: {err}"
    );

    let side = h
        .preview(
            &format!(
                "UPDATE {}.orders SET status = 'x' WHERE bump(status, 'open')",
                ident(&h.schema)
            ),
            None,
        )
        .await
        .expect_err("user function must be rejected");
    assert!(
        side.to_lowercase().contains("bump"),
        "unexpected rejection: {side}"
    );
    let count = h
        .query_scalar(&format!(
            "SELECT count(*)::text FROM {}.calls",
            ident(&h.schema)
        ))
        .await
        .unwrap();
    assert_eq!(count, "0", "rejected preview must not run the function");
);

live_test!(test_dml_preview_rejects_views_and_reports_triggers, h,
    h.exec(&format!(
        "CREATE TABLE {}.orders (id int PRIMARY KEY, status text)",
        ident(&h.schema)
    ))
    .await
    .unwrap();
    h.exec(&format!(
        "INSERT INTO {}.orders VALUES (1, 'open')",
        ident(&h.schema)
    ))
    .await
    .unwrap();
    h.exec(&format!(
        "CREATE VIEW {}.orders_v AS SELECT * FROM {}.orders",
        ident(&h.schema),
        ident(&h.schema)
    ))
    .await
    .unwrap();
    h.exec(&format!(
        "CREATE FUNCTION {}.touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$",
        ident(&h.schema)
    ))
    .await
    .unwrap();
    h.exec(&format!(
        "CREATE TRIGGER orders_touch BEFORE UPDATE ON {}.orders FOR EACH ROW EXECUTE PROCEDURE {}.touch()",
        ident(&h.schema),
        ident(&h.schema)
    ))
    .await
    .unwrap();

    let view_err = h
        .preview(
            &format!(
                "UPDATE {}.orders_v SET status = 'paid' WHERE id = 1",
                ident(&h.schema)
            ),
            None,
        )
        .await
        .expect_err("views must be rejected");
    assert!(
        view_err.to_lowercase().contains("view"),
        "unexpected rejection: {view_err}"
    );

    let preview = h
        .preview(
            &format!(
                "UPDATE {}.orders SET status = 'paid' WHERE id = 1",
                ident(&h.schema)
            ),
            None,
        )
        .await
        .expect("preview table with trigger");
    assert!(
        preview.triggers >= 1,
        "expected trigger count, got {}",
        preview.triggers
    );
);

live_test!(test_dml_preview_rejects_columns_whose_type_has_its_own_operators, h,
    h.exec("CREATE EXTENSION IF NOT EXISTS citext").await.unwrap();
    let ext = h
        .query_scalar("SELECT extnamespace::regnamespace::text FROM pg_extension WHERE extname = 'citext'")
        .await
        .unwrap();
    let s = ident(&h.schema);
    for sql in [
        "CREATE TYPE {s}.mood AS ENUM ('ok', 'sad')",
        "CREATE DOMAIN {s}.ci AS {ext}.citext",
        "CREATE DOMAIN {s}.pos AS int CHECK (VALUE > 0)",
        "CREATE TABLE {s}.users (id {s}.pos, email {ext}.citext, alias {s}.ci, tags {ext}.citext[], \
         mood {s}.mood, name text)",
        "INSERT INTO {s}.users VALUES (1, 'alice@example.com', 'a', '{x}', 'ok', 'n'), \
         (2, 'ALICE@EXAMPLE.COM', 'b', '{y}', 'sad', 'm')",
    ] {
        h.exec(&sql.replace("{s}", &s).replace("{ext}", &ext))
            .await
            .unwrap();
    }

    for (sql, column) in [
        ("DELETE FROM {s}.users WHERE email = 'Alice@Example.com'", "email ("),
        ("DELETE FROM {s}.users WHERE alias LIKE 'A%'", "alias ("),
        ("UPDATE {s}.users SET name = 'x' WHERE tags = '{X}'", "tags ("),
        ("UPDATE {s}.users SET email = 'x' WHERE id = 1", "email ("),
    ] {
        let error = h
            .preview(&sql.replace("{s}", &s), None)
            .await
            .expect_err(sql);
        assert!(error.contains(column), "{sql}: {error}");
    }

    let allowed = h
        .preview(
            &format!("DELETE FROM {s}.users WHERE mood = 'ok' AND id > 0 AND name = 'n'"),
            None,
        )
        .await
        .expect("enum, domain over int and text columns are previewed");
    assert_eq!(allowed.result.rows.len(), 1);
    let count = h
        .query_scalar(&format!("SELECT count(*) FROM {s}.users"))
        .await
        .unwrap();
    assert_eq!(count, "2", "preview must not write the table");
);
