use super::*;

#[test]
fn recognises_a_plain_drop() {
    assert_eq!(dropped_database("DROP DATABASE foo"), Some("foo".into()));
}

#[test]
fn keyword_matching_is_case_insensitive() {
    assert_eq!(dropped_database("drop database foo"), Some("foo".into()));
    assert_eq!(dropped_database("Drop Database foo"), Some("foo".into()));
}

#[test]
fn accepts_schema_as_a_synonym() {
    assert_eq!(dropped_database("DROP SCHEMA foo"), Some("foo".into()));
}

#[test]
fn accepts_if_exists() {
    assert_eq!(
        dropped_database("DROP DATABASE IF EXISTS foo"),
        Some("foo".into())
    );
}

#[test]
fn if_exists_without_a_name_is_not_a_drop() {
    assert_eq!(dropped_database("DROP DATABASE IF EXISTS"), None);
    assert_eq!(dropped_database("DROP DATABASE IF"), None);
}

#[test]
fn a_name_starting_with_if_is_still_a_name() {
    assert_eq!(
        dropped_database("DROP DATABASE if_logs"),
        Some("if_logs".into())
    );
    assert_eq!(
        dropped_database("DROP DATABASE ifexists"),
        Some("ifexists".into())
    );
}

#[test]
fn tolerates_surrounding_whitespace_and_terminator() {
    assert_eq!(dropped_database("DROP DATABASE foo;"), Some("foo".into()));
    assert_eq!(
        dropped_database("  DROP DATABASE   foo  ;  "),
        Some("foo".into())
    );
}

#[test]
fn unquotes_every_dialect_quote() {
    assert_eq!(
        dropped_database("DROP DATABASE `my db`"),
        Some("my db".into())
    );
    assert_eq!(
        dropped_database("DROP DATABASE \"my db\""),
        Some("my db".into())
    );
    assert_eq!(
        dropped_database("DROP DATABASE [my db]"),
        Some("my db".into())
    );
}

#[test]
fn a_leading_comment_is_not_recognised() {
    // Documented limitation: the statement must start with DROP. Failing
    // closed here only costs a stale sidebar until the next refresh.
    assert_eq!(dropped_database("-- cleanup\nDROP DATABASE foo"), None);
    assert_eq!(dropped_database("/* cleanup */ DROP DATABASE foo"), None);
}

#[test]
fn keeps_a_non_ascii_name_intact() {
    assert_eq!(
        dropped_database("DROP DATABASE `groß`"),
        Some("groß".into())
    );
}

#[test]
fn other_statements_are_not_drops() {
    assert_eq!(dropped_database("DROP TABLE foo"), None);
    assert_eq!(dropped_database("CREATE DATABASE foo"), None);
    assert_eq!(dropped_database("SELECT 1"), None);
    assert_eq!(dropped_database(""), None);
}

#[test]
fn a_database_name_inside_a_string_is_not_a_drop() {
    assert_eq!(dropped_database("SELECT 'DROP DATABASE foo'"), None);
}

#[test]
fn requires_a_word_boundary_after_the_keyword() {
    assert_eq!(dropped_database("DROP DATABASEX foo"), None);
    assert_eq!(dropped_database("DROPX DATABASE foo"), None);
}

#[test]
fn refuses_to_guess_in_a_multi_statement_payload() {
    assert_eq!(dropped_database("DROP DATABASE foo; SELECT 1"), None);
    assert_eq!(dropped_database("SELECT 1; DROP DATABASE foo"), None);
}

#[test]
fn refuses_anything_trailing_the_identifier() {
    assert_eq!(dropped_database("DROP DATABASE foo bar"), None);
    assert_eq!(dropped_database("DROP DATABASE foo;;"), None);
}

#[test]
fn an_unclosed_quote_is_not_a_drop() {
    assert_eq!(dropped_database("DROP DATABASE `foo"), None);
    assert_eq!(dropped_database("DROP DATABASE [foo"), None);
}

// --- Helpers, tested directly (rust.md rule 5) -------------------------------

#[test]
fn after_keyword_matches_case_insensitively_and_trims() {
    assert_eq!(after_keyword("DROP foo", "DROP"), Some("foo"));
    assert_eq!(after_keyword("drop foo", "DROP"), Some("foo"));
    assert_eq!(after_keyword("  DROP    foo", "DROP"), Some("foo"));
}

#[test]
fn after_keyword_accepts_a_quote_as_word_boundary() {
    // No space between keyword and a quoted identifier is still valid SQL.
    assert_eq!(after_keyword("DATABASE`db`", "DATABASE"), Some("`db`"));
    assert_eq!(after_keyword("DATABASE\"db\"", "DATABASE"), Some("\"db\""));
    assert_eq!(after_keyword("DATABASE[db]", "DATABASE"), Some("[db]"));
}

#[test]
fn after_keyword_returns_empty_when_the_keyword_ends_the_input() {
    assert_eq!(after_keyword("DROP", "DROP"), Some(""));
}

#[test]
fn after_keyword_requires_a_word_boundary() {
    assert_eq!(after_keyword("DROPX foo", "DROP"), None);
    assert_eq!(after_keyword("DROP_TABLE foo", "DROP"), None);
}

#[test]
fn after_keyword_rejects_a_shorter_input_and_a_mismatch() {
    assert_eq!(after_keyword("DRO", "DROP"), None);
    assert_eq!(after_keyword("", "DROP"), None);
    assert_eq!(after_keyword("SELECT foo", "DROP"), None);
}

#[test]
fn is_quote_covers_the_three_identifier_quotes_only() {
    assert!(is_quote('`'));
    assert!(is_quote('"'));
    assert!(is_quote('['));
    // A single quote opens a string literal, not an identifier.
    assert!(!is_quote('\''));
    assert!(!is_quote('a'));
}

#[test]
fn only_terminator_allows_blank_and_a_single_semicolon() {
    assert!(only_terminator(""));
    assert!(only_terminator("   "));
    assert!(only_terminator(";"));
    assert!(only_terminator("  ;  "));
    assert!(!only_terminator(";;"));
    assert!(!only_terminator("bar"));
}

#[test]
fn bare_reads_an_unquoted_identifier() {
    assert_eq!(bare("foo"), Some("foo"));
    assert_eq!(bare("foo;"), Some("foo"));
    assert_eq!(bare("my_db"), Some("my_db"));
    // `$` is accepted by MySQL and appears in some legacy schema names.
    assert_eq!(bare("foo$bar"), Some("foo$bar"));
}

#[test]
fn bare_rejects_trailing_content_and_empty_names() {
    assert_eq!(bare("foo bar"), None);
    assert_eq!(bare(""), None);
    assert_eq!(bare(";"), None);
    assert_eq!(bare("`foo`"), None);
}

#[test]
fn delimited_extracts_between_matching_quotes() {
    assert_eq!(delimited("`foo`", '`', '`'), Some("foo"));
    assert_eq!(delimited("`my db`", '`', '`'), Some("my db"));
    assert_eq!(delimited("[my db]", '[', ']'), Some("my db"));
    assert_eq!(delimited("`foo`;", '`', '`'), Some("foo"));
}

#[test]
fn delimited_fails_closed_on_unclosed_quotes_and_trailing_content() {
    assert_eq!(delimited("`foo", '`', '`'), None);
    assert_eq!(delimited("`foo` bar", '`', '`'), None);
    assert_eq!(delimited("foo", '`', '`'), None);
}

#[test]
fn identifier_dispatches_on_the_opening_character() {
    assert_eq!(identifier("foo"), Some("foo".into()));
    assert_eq!(identifier("`a b`"), Some("a b".into()));
    assert_eq!(identifier("\"a b\""), Some("a b".into()));
    assert_eq!(identifier("[a b]"), Some("a b".into()));
    assert_eq!(identifier(""), None);
}
