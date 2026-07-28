use super::*;

fn column(name: &str, data_type: &str) -> ColumnDefinition {
    ColumnDefinition {
        name: name.into(),
        data_type: data_type.into(),
        is_nullable: false,
        is_pk: false,
        is_auto_increment: false,
        default_value: None,
    }
}

#[test]
fn alter_column_handles_rename_type_nullability_and_default() {
    let old = column("old_name", "INT");
    let mut new = column("new_name", "BIGINT");
    new.is_nullable = true;
    new.default_value = Some("0".into());

    let sql = alter_column_sql("items", &old, &new, Some("sales")).unwrap();
    assert_eq!(sql.len(), 4);
    assert!(sql[0].contains("sp_rename N'[sales].[items].[old_name]', N'new_name'"));
    assert_eq!(
        sql[1],
        "ALTER TABLE [sales].[items] ALTER COLUMN [new_name] BIGINT NULL"
    );
    assert!(sql[2].contains("sys.default_constraints"));
    assert_eq!(
        sql[3],
        "ALTER TABLE [sales].[items] ADD CONSTRAINT [DF_items_new_name] DEFAULT 0 FOR [new_name]"
    );
}

#[test]
fn alter_column_preserves_primary_key_shape_on_rename() {
    let mut old = column("id", "INT");
    old.is_pk = true;
    let mut new = old.clone();
    new.name = "item_id".into();

    let sql = alter_column_sql("items", &old, &new, None).unwrap();
    assert_eq!(sql.len(), 1);
    assert!(sql[0].contains("sp_rename"));

    new.is_pk = false;
    assert!(alter_column_sql("items", &old, &new, None).is_err());
}

#[test]
fn rename_quotes_each_multipart_identifier_and_constraint_names_fit_sysname() {
    let old = column("old.name", "INT");
    let mut new = old.clone();
    new.name = "new.name".into();
    let sql = alter_column_sql("items.with.dot", &old, &new, Some("odd.schema")).unwrap();
    assert!(sql[0].contains("[odd.schema].[items.with.dot].[old.name]"));
    assert!(
        drop_default_constraint_sql("odd.schema", "items.with.dot", "value")
            .contains("OBJECT_ID(N'[odd.schema].[items.with.dot]')")
    );

    let name = constraint_name("DF", &"t".repeat(100), &"c".repeat(100));
    assert_eq!(name.chars().count(), 128);
}

#[test]
fn alter_column_rejects_identity_changes() {
    let old = column("id", "INT");
    let mut new = old.clone();
    new.is_auto_increment = true;
    assert!(alter_column_sql("items", &old, &new, None)
        .unwrap_err()
        .contains("IDENTITY"));
}

#[test]
fn foreign_key_quotes_identifiers_and_validates_actions() {
    let sql = create_foreign_key_sql(
        "orders",
        "fk_orders_customer",
        "customer_id",
        "customers",
        "id",
        Some("cascade"),
        Some("NO ACTION"),
        Some("sales"),
    )
    .unwrap();
    assert_eq!(sql, vec!["ALTER TABLE [sales].[orders] ADD CONSTRAINT [fk_orders_customer] FOREIGN KEY ([customer_id]) REFERENCES [sales].[customers] ([id]) ON DELETE CASCADE ON UPDATE NO ACTION"]);
    assert!(create_foreign_key_sql(
        "orders",
        "fk",
        "id",
        "customers",
        "id",
        Some("DROP TABLE users"),
        None,
        None,
    )
    .is_err());
}
