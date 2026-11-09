use super::MysqlDriver;
use crate::drivers::driver_trait::DatabaseDriver;
use crate::models::ColumnDefinition;

fn column(comment: Option<&str>) -> ColumnDefinition {
    ColumnDefinition {
        name: "updated".into(),
        data_type: "TIMESTAMP".into(),
        is_nullable: false,
        is_pk: false,
        is_auto_increment: false,
        default_value: Some("CURRENT_TIMESTAMP".into()),
        on_update: Some("CURRENT_TIMESTAMP".into()),
        comment: comment.map(str::to_string),
    }
}

#[tokio::test]
async fn add_and_alter_comments_use_the_server_literal_mode() {
    for (no_backslash_escapes, literal) in [
        (false, "'O\\'Brien\\\\path\\n日本語'"),
        (true, "'O''Brien\\path\n日本語'"),
    ] {
        let mut driver = MysqlDriver::new();
        driver.no_backslash_escapes = no_backslash_escapes;
        assert!(driver.manifest().capabilities.column_comments);
        let new = column(Some("O'Brien\\path\n日本語"));
        let added = driver
            .get_add_column_sql("t`able", new.clone(), None)
            .await
            .unwrap();
        assert!(added[0].starts_with("ALTER TABLE `t``able` ADD COLUMN `updated` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"));
        assert!(added[0].ends_with(&format!(" COMMENT {literal}")));
        let updated = driver
            .get_alter_column_sql("t`able", column(None), new.clone(), None)
            .await
            .unwrap();
        assert_eq!(updated[0], format!("ALTER TABLE `t``able` MODIFY COLUMN `updated` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT {literal}"));
        let unchanged = driver
            .get_alter_column_sql("t", new.clone(), new.clone(), None)
            .await
            .unwrap();
        assert!(unchanged[0].ends_with(&format!(" COMMENT {literal}")));
        let mut renamed = new.clone();
        renamed.name = "renamed".into();
        let sql = driver
            .get_alter_column_sql("t", new.clone(), renamed, None)
            .await
            .unwrap();
        assert!(sql[0].contains("CHANGE `updated` `renamed`"));
        assert!(sql[0].ends_with(&format!(" COMMENT {literal}")));
        let cleared = driver
            .get_alter_column_sql("t", new, column(None), None)
            .await
            .unwrap();
        assert!(cleared[0].ends_with(" COMMENT ''"));
    }
}
