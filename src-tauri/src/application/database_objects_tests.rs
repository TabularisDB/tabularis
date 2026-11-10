use super::*;
use crate::runtime::events::NoopRuntimeEvents;
use crate::runtime::paths::FixedRuntimePaths;
use crate::runtime::secrets::RuntimeSecrets;

struct UnavailableSecrets;

impl RuntimeSecrets for UnavailableSecrets {
    fn get(&self, _: &str) -> Result<Option<String>, String> {
        panic!("offline SQL preview must not read credentials");
    }
    fn set(&self, _: &str, _: &str) -> Result<(), String> {
        panic!("offline SQL preview must not write credentials");
    }
    fn delete(&self, _: &str) -> Result<(), String> {
        panic!("offline SQL preview must not delete credentials");
    }
}

#[tokio::test]
async fn mysql_column_previews_without_comment_text_stay_offline() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().into(),
            temp.path().into(),
        )),
        Arc::new(NoopRuntimeEvents),
        Arc::new(UnavailableSecrets),
    );
    crate::drivers::registry::register_driver(crate::drivers::mysql::MysqlDriver::new()).await;
    let params = ConnectionParams {
        driver: "mysql".into(),
        host: Some("unreachable.invalid".into()),
        ssh_enabled: Some(true),
        ..Default::default()
    };
    std::fs::write(
        runtime.paths.connections_file(),
        serde_json::to_vec(&serde_json::json!([
            {"id": "offline", "name": "Offline MySQL", "params": params}
        ]))
        .unwrap(),
    )
    .unwrap();
    let column = ColumnDefinition {
        name: "label".into(),
        data_type: "VARCHAR(20)".into(),
        is_nullable: false,
        is_pk: false,
        is_auto_increment: false,
        default_value: Some("'new'".into()),
        comment: None,
        on_update: None,
    };
    let added = get_add_column_sql(&runtime, "offline", "t".into(), column.clone(), None, None)
        .await
        .unwrap();
    assert_eq!(
        added,
        ["ALTER TABLE `t` ADD COLUMN `label` VARCHAR(20) NOT NULL DEFAULT 'new'"]
    );
    let mut old = column.clone();
    old.comment = Some("old comment".into());
    let changed = get_alter_column_sql(&runtime, "offline", "t".into(), old, column, None, None)
        .await
        .unwrap();
    assert!(changed[0].ends_with(" COMMENT ''"));
}
