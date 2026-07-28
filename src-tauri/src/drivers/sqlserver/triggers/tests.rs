use super::*;

#[test]
fn drop_trigger_uses_schema_qualified_identifier() {
    assert_eq!(
        drop_trigger_sql("audit_orders", Some("sales")),
        "DROP TRIGGER [sales].[audit_orders]"
    );
    assert_eq!(
        drop_trigger_sql("audit_orders", None),
        "DROP TRIGGER [dbo].[audit_orders]"
    );
}
