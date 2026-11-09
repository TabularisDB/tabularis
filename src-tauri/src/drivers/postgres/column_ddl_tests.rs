use super::PostgresDriver;
use crate::drivers::driver_trait::DatabaseDriver;
use crate::models::ColumnDefinition;

fn column(comment: Option<&str>) -> ColumnDefinition {
    ColumnDefinition {
        name: "email".into(),
        data_type: "VARCHAR(255)".into(),
        is_nullable: false,
        is_pk: false,
        is_auto_increment: false,
        default_value: Some("'unknown'::character varying".into()),
        comment: comment.map(str::to_string),
        on_update: None,
    }
}

#[test]
fn advertises_column_comments() {
    assert!(
        PostgresDriver::new()
            .manifest()
            .capabilities
            .column_comments
    );
}

#[tokio::test]
async fn comment_only_edits_do_not_restate_the_column() {
    for (old, new, literal) in [
        (None, Some("new"), "E'new'"),
        (Some("old"), Some("new"), "E'new'"),
        (Some("old"), None, "NULL"),
        (Some("old"), Some(""), "NULL"),
    ] {
        let sql = PostgresDriver::new()
            .get_alter_column_sql("customers", column(old), column(new), Some("sales"))
            .await
            .unwrap();
        assert_eq!(
            sql,
            [format!(
                "COMMENT ON COLUMN \"sales\".\"customers\".\"email\" IS {literal}"
            )]
        );
    }
}

#[tokio::test]
async fn unchanged_comments_produce_no_comment_statement() {
    for comment in [None, Some(""), Some("existing")] {
        let old = column(comment);
        let mut new = old.clone();
        new.name = "renamed".into();
        let sql = PostgresDriver::new()
            .get_alter_column_sql("customers", old, new, None)
            .await
            .unwrap();
        assert_eq!(sql.len(), 1);
        assert!(sql[0].contains("RENAME COLUMN"));
    }
    assert!(PostgresDriver::new()
        .get_alter_column_sql(
            "customers",
            column(Some("same")),
            column(Some("same")),
            None
        )
        .await
        .is_err());
}

#[tokio::test]
async fn rename_and_comment_use_the_new_quoted_name() {
    let mut new = column(Some("O'Brien\n日本語"));
    new.name = "new\"name".into();
    let sql = PostgresDriver::new()
        .get_alter_column_sql("cust\"omers", column(None), new, Some("sa\"les"))
        .await
        .unwrap();
    assert_eq!(sql.len(), 2);
    assert_eq!(
        sql[1],
        "COMMENT ON COLUMN \"sa\"\"les\".\"cust\"\"omers\".\"new\"\"name\" IS E'O''Brien\n日本語'"
    );
}

#[tokio::test]
async fn add_column_emits_the_comment_after_adding_the_column() {
    let driver = PostgresDriver::new();
    let with_comment = driver
        .get_add_column_sql("customers", column(Some("note")), None)
        .await
        .unwrap();
    let without_comment = driver
        .get_add_column_sql("customers", column(None), None)
        .await
        .unwrap();
    assert_eq!(with_comment[0], without_comment[0]);
    assert_eq!(without_comment.len(), 1);
    assert_eq!(
        with_comment[1],
        "COMMENT ON COLUMN \"public\".\"customers\".\"email\" IS E'note'"
    );
}
