use super::*;

#[test]
fn import_identifiers_use_the_connection_quote_and_escape_delimiters() {
    assert_eq!(quote_identifier("some\"table", "\""), "\"some\"\"table\"");
    assert_eq!(quote_identifier("some`table", "`"), "`some``table`");
    assert_eq!(table_ref("table", Some("schema"), "`"), "`schema`.`table`");
    assert_eq!(table_ref("table", None, "\""), "\"table\"");
}
