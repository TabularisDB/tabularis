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

/// The columns the clipboard parser infers for the #904 sample.
fn new_arrivals_import(add_columns: Vec<ColumnDefinition>) -> ClipboardImportRequest {
    ClipboardImportRequest {
        connection_id: "c1".into(),
        table_name: "new_arrivals".into(),
        schema: Some("tabularis_demo".into()),
        columns: vec![
            column("sku", "TEXT"),
            column("name", "TEXT"),
            column("price", "REAL"),
            column("in_stock", "BOOLEAN"),
            column("added_on", "DATE"),
        ],
        rows: Vec::new(),
        create_table: true,
        if_exists: IfExistsStrategy::Fail,
        add_columns,
    }
}

#[test]
fn mysql_import_sends_booleans_in_created_columns_as_literals() {
    // MySQL creates `in_stock` as TINYINT(1) and, in strict mode, rejects 'true' (#904).
    let boolean_columns = boolean_literal_columns(&new_arrivals_import(Vec::new()), "mysql", true);
    assert_eq!(boolean_columns, [false, false, false, true, false]);
    let row = [
        "KB-101",
        "Mechanical Keyboard",
        "89.90",
        "true",
        "2026-09-02",
    ]
    .map(|v| Some(v.to_string()));
    assert_eq!(
        row_to_values_clause(&row, &boolean_columns),
        "('KB-101', 'Mechanical Keyboard', '89.90', TRUE, '2026-09-02')"
    );
}

#[test]
fn boolean_literals_cover_the_values_the_parser_accepts() {
    let row = [
        Some("No"),
        Some("YES"),
        Some("False"),
        Some(""),
        None,
        Some("maybe"),
    ]
    .map(|v| v.map(String::from));
    assert_eq!(
        row_to_values_clause(&row, &[true; 6]),
        "(FALSE, TRUE, FALSE, NULL, NULL, 'maybe')"
    );
}

#[test]
fn import_keeps_quoted_values_for_columns_it_did_not_create() {
    // Appending into existing columns: their real type is unknown, so 'true' stays a string.
    let existing = boolean_literal_columns(&new_arrivals_import(Vec::new()), "mysql", false);
    assert_eq!(existing, [false; 5]);
    // A BOOLEAN column this import adds gets literals, like one in a new table.
    let added = boolean_literal_columns(
        &new_arrivals_import(vec![column("in_stock", "BOOLEAN")]),
        "mysql",
        false,
    );
    assert_eq!(added, [false, false, false, true, false]);
    // Other drivers keep today's quoted values (PostgreSQL casts them to boolean).
    for driver in ["postgres", "sqlite"] {
        assert_eq!(
            boolean_literal_columns(&new_arrivals_import(Vec::new()), driver, true),
            [false; 5]
        );
    }
}
