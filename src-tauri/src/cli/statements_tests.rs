use super::statements::split_sql_statements;

fn split(sql: &str) -> Vec<String> {
    split_sql_statements(sql)
}

// --- basic splitting ----------------------------------------------------------

#[test]
fn splits_on_semicolons_and_trims() {
    assert_eq!(
        split("SELECT 1;  SELECT 2 ;\nSELECT 3"),
        vec!["SELECT 1", "SELECT 2", "SELECT 3"]
    );
}

#[test]
fn single_statement_without_trailing_semicolon_is_kept() {
    assert_eq!(split("SELECT 1"), vec!["SELECT 1"]);
}

#[test]
fn empty_and_whitespace_fragments_are_dropped() {
    assert_eq!(split(";;  ;\n;SELECT 1;;"), vec!["SELECT 1"]);
    assert!(split("").is_empty());
    assert!(split("  \n\t ").is_empty());
}

#[test]
fn multiline_statements_keep_their_internal_newlines() {
    assert_eq!(
        split("SELECT a\nFROM t;\nSELECT 2;"),
        vec!["SELECT a\nFROM t", "SELECT 2"]
    );
}

// --- quoting ------------------------------------------------------------------

#[test]
fn semicolon_inside_single_quotes_does_not_split() {
    assert_eq!(
        split("INSERT INTO t VALUES ('a;b'); SELECT 1;"),
        vec!["INSERT INTO t VALUES ('a;b')", "SELECT 1"]
    );
}

#[test]
fn semicolon_inside_double_quotes_and_backticks_does_not_split() {
    assert_eq!(
        split(r#"SELECT "col;umn" FROM t; SELECT `we;ird` FROM u;"#),
        vec![r#"SELECT "col;umn" FROM t"#, "SELECT `we;ird` FROM u"]
    );
}

#[test]
fn doubled_quote_escape_stays_inside_the_string() {
    assert_eq!(
        split("SELECT 'it''s; fine'; SELECT 2;"),
        vec!["SELECT 'it''s; fine'", "SELECT 2"]
    );
}

#[test]
fn backslash_escaped_quote_stays_inside_the_string() {
    assert_eq!(
        split(r"SELECT 'it\'s; fine'; SELECT 2;"),
        vec![r"SELECT 'it\'s; fine'", "SELECT 2"]
    );
}

#[test]
fn unterminated_quote_consumes_the_rest() {
    assert_eq!(
        split("SELECT 'open; SELECT 2;"),
        vec!["SELECT 'open; SELECT 2;"]
    );
}

// --- comments -----------------------------------------------------------------

#[test]
fn semicolon_in_line_comment_does_not_split() {
    assert_eq!(
        split("SELECT 1 -- not; here\n; SELECT 2;"),
        vec!["SELECT 1 -- not; here", "SELECT 2"]
    );
}

#[test]
fn semicolon_in_block_comment_does_not_split() {
    assert_eq!(
        split("SELECT /* a;b */ 1; SELECT 2;"),
        vec!["SELECT /* a;b */ 1", "SELECT 2"]
    );
}

#[test]
fn nested_block_comments_are_handled() {
    assert_eq!(
        split("SELECT /* outer /* inner; */ still; */ 1; SELECT 2;"),
        vec!["SELECT /* outer /* inner; */ still; */ 1", "SELECT 2"]
    );
}

#[test]
fn comment_only_fragments_are_dropped() {
    // A leading comment stays attached to its statement (servers accept
    // comments); what gets dropped is a fragment with *only* comments in it.
    assert_eq!(
        split("-- header comment\nSELECT 1;\n-- trailing comment\n/* done */"),
        vec!["-- header comment\nSELECT 1"]
    );
}

#[test]
fn double_dash_inside_string_is_not_a_comment() {
    assert_eq!(
        split("SELECT '--not a comment;'; SELECT 2;"),
        vec!["SELECT '--not a comment;'", "SELECT 2"]
    );
}

// --- dollar quoting -----------------------------------------------------------

#[test]
fn semicolons_inside_dollar_quoted_bodies_do_not_split() {
    let body = "CREATE FUNCTION f() RETURNS void AS $$\nBEGIN\n  SELECT 1;\n  SELECT 2;\nEND;\n$$ LANGUAGE plpgsql";
    let script = format!("{};\nSELECT 3;", body);
    assert_eq!(
        split(&script),
        vec![body.to_string(), "SELECT 3".to_string()]
    );
}

#[test]
fn tagged_dollar_quotes_must_match_the_same_tag() {
    let body = "DO $tag$ inner; $other$ still inside; $tag$";
    let script = format!("{}; SELECT 1;", body);
    assert_eq!(
        split(&script),
        vec![body.to_string(), "SELECT 1".to_string()]
    );
}

#[test]
fn dollar_placeholders_are_not_dollar_quotes() {
    assert_eq!(
        split("SELECT * FROM t WHERE id = $1; SELECT 2;"),
        vec!["SELECT * FROM t WHERE id = $1", "SELECT 2"]
    );
}

#[test]
fn dollar_tag_starting_with_digit_is_not_a_delimiter() {
    // `$1$` is not a valid Postgres dollar-quote tag.
    assert_eq!(
        split("SELECT '$' || $1; SELECT 2;"),
        vec!["SELECT '$' || $1", "SELECT 2"]
    );
}
