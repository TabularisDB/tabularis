use super::*;
use crate::models::DatabaseSelection;

fn make_params(host: Option<&str>, port: Option<u16>, db: &str) -> ConnectionParams {
    ConnectionParams {
        driver: "sqlserver".into(),
        host: host.map(String::from),
        port,
        username: Some("sa".into()),
        password: Some("Strong!Pass123".into()),
        database: DatabaseSelection::Single(db.into()),
        ssl_mode: None,
        ssl_ca: None,
        ssl_cert: None,
        ssl_key: None,
        ssh_enabled: None,
        ssh_connection_id: None,
        ssh_host: None,
        ssh_port: None,
        ssh_user: None,
        ssh_password: None,
        ssh_key_file: None,
        ssh_key_passphrase: None,
        save_in_keychain: None,
        connection_id: None,
        ..Default::default()
    }
}

#[test]
fn manifest_has_phase2_capabilities() {
    let drv = SqlServerDriver::new();
    let m = drv.manifest();
    assert_eq!(m.id, "sqlserver");
    assert_eq!(m.version, "0.2.0");
    assert_eq!(m.default_port, Some(1433));
    assert!(m.is_builtin);
    assert!(
        !m.capabilities.readonly,
        "SQL Server editing must be enabled"
    );
    assert!(
        m.capabilities.manage_tables,
        "SQL Server table creation must be enabled"
    );
    assert!(m.capabilities.alter_column);
    assert!(m.capabilities.create_foreign_keys);
    assert!(m.capabilities.triggers);
    assert!(m.capabilities.routine_management);
    assert!(m.capabilities.schemas);
    assert!(m.capabilities.views);
    assert!(m.capabilities.routines);
    assert_eq!(m.capabilities.auto_increment_keyword, "IDENTITY(1,1)");
    assert_eq!(m.capabilities.identifier_quote, "\"");
    assert!(!m.capabilities.alter_primary_key);
}

#[test]
fn build_connection_url_emits_url_format() {
    let drv = SqlServerDriver::new();
    let params = make_params(Some("db.internal"), Some(1445), "app");
    let url = drv.build_connection_url(&params).expect("builds");
    assert_eq!(url, "sqlserver://sa:Strong%21Pass123@db.internal:1445/app");
}

#[test]
fn build_connection_url_uses_defaults_when_missing() {
    let drv = SqlServerDriver::new();
    let mut params = make_params(None, None, "master");
    params.username = None;
    params.password = None;
    let url = drv.build_connection_url(&params).expect("builds");
    assert_eq!(url, "sqlserver://sa:@localhost:1433/master");
}

#[test]
fn map_inferred_type_covers_known_kinds() {
    let drv = SqlServerDriver::new();
    assert_eq!(drv.map_inferred_type("TEXT"), "NVARCHAR(MAX)");
    assert_eq!(drv.map_inferred_type("INTEGER"), "INT");
    assert_eq!(drv.map_inferred_type("REAL"), "FLOAT");
    assert_eq!(drv.map_inferred_type("BOOLEAN"), "BIT");
    assert_eq!(drv.map_inferred_type("DATE"), "DATE");
    assert_eq!(drv.map_inferred_type("DATETIME"), "DATETIME2");
    assert_eq!(drv.map_inferred_type("JSON"), "NVARCHAR(MAX)");
}

#[test]
fn map_inferred_type_passes_unknown_through() {
    let drv = SqlServerDriver::new();
    assert_eq!(drv.map_inferred_type("UUID"), "UUID");
    assert_eq!(drv.map_inferred_type("anything-custom"), "anything-custom");
}

#[test]
fn get_data_types_includes_core_types() {
    let drv = SqlServerDriver::new();
    let types = drv.get_data_types();
    assert!(!types.is_empty());
    assert!(types.iter().any(|t| t.name == "INT"));
    assert!(types.iter().any(|t| t.name == "NVARCHAR"));
    assert!(types.iter().any(|t| t.name == "DATETIME2"));
    assert!(types.iter().any(|t| t.name == "UNIQUEIDENTIFIER"));
}

#[tokio::test]
async fn ddl_generation_matches_sql_server_syntax() {
    let driver = SqlServerDriver::new();
    let column = ColumnDefinition {
        name: "display_name".into(),
        data_type: "NVARCHAR(100)".into(),
        is_nullable: false,
        is_pk: false,
        is_auto_increment: false,
        default_value: Some("N'unknown'".into()),
    };
    assert_eq!(
        driver
            .get_add_column_sql("users", column, Some("auth"))
            .await
            .unwrap(),
        vec!["ALTER TABLE [auth].[users] ADD [display_name] NVARCHAR(100) NOT NULL DEFAULT N'unknown'"]
    );
    assert_eq!(
        driver
            .get_create_index_sql(
                "users",
                "ix]users_name",
                vec!["display_name".into()],
                true,
                Some("auth"),
            )
            .await
            .unwrap(),
        vec!["CREATE UNIQUE INDEX [ix]]users_name] ON [auth].[users] ([display_name])"]
    );
    assert!(driver
        .get_create_index_sql("users", "empty", Vec::new(), false, None)
        .await
        .is_err());
}

#[tokio::test]
async fn write_operations_validate_before_connecting() {
    let drv = SqlServerDriver::new();
    let params = make_params(Some("localhost"), Some(1433), "master");

    let insert_error = drv
        .insert_record(&params, "t", HashMap::new(), None, 0)
        .await
        .expect_err("empty insert must be rejected");
    assert!(insert_error.contains("at least one column"));

    let delete_error = drv
        .delete_record(&params, "t", &HashMap::new(), None)
        .await
        .expect_err("empty primary key must be rejected");
    assert!(delete_error.contains("primary-key"));

    let update_error = drv
        .update_record(
            &params,
            "t",
            &HashMap::new(),
            "name",
            serde_json::json!("value"),
            None,
            1024,
        )
        .await
        .expect_err("empty primary key must be rejected");
    assert!(update_error.contains("primary-key"));
}
