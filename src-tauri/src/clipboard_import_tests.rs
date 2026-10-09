use super::*;

#[test]
fn import_identifiers_use_the_connection_quote_and_escape_delimiters() {
    assert_eq!(quote_identifier("some\"table", "\""), "\"some\"\"table\"");
    assert_eq!(quote_identifier("some`table", "`"), "`some``table`");
    assert_eq!(table_ref("table", Some("schema"), "`"), "`schema`.`table`");
    assert_eq!(table_ref("table", None, "\""), "\"table\"");
}

#[test]
fn import_uses_the_identifier_quote_each_builtin_driver_declares() {
    // Built-in drivers have no per-connection metadata; MySQL still needs backticks (#904).
    let mysql = crate::drivers::mysql::MysqlDriver::new();
    assert_eq!(import_identifier_quote(&mysql), "`");
    assert_eq!(
        table_ref(
            "new_arrivals",
            Some("tabularis_demo"),
            import_identifier_quote(&mysql)
        ),
        "`tabularis_demo`.`new_arrivals`"
    );
    assert_eq!(
        import_identifier_quote(&crate::drivers::postgres::PostgresDriver::new()),
        "\""
    );
    assert_eq!(
        import_identifier_quote(&crate::drivers::sqlite::SqliteDriver::new()),
        "\""
    );
}
