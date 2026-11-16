use super::comment_sql;

#[test]
fn quotes_identifiers_and_preserves_comment_text() {
    assert_eq!(
        comment_sql("\"s\".\"t\"", "col\"umn", Some("  O'Brien\\path\n日本語  ")),
        "COMMENT ON COLUMN \"s\".\"t\".\"col\"\"umn\" IS E'  O''Brien\\\\path\n日本語  '"
    );
}

#[test]
fn clearing_a_comment_uses_null() {
    for comment in [None, Some("")] {
        assert_eq!(
            comment_sql("\"public\".\"t\"", "c", comment),
            "COMMENT ON COLUMN \"public\".\"t\".\"c\" IS NULL"
        );
    }
}
