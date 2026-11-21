use super::stmt_classify::{
    find_first_top_level_object_keyword, is_single_statement, is_text_protocol_stmt,
};

#[test]
fn find_first_top_level_object_keyword_skips_current_user_parentheses() {
    let stmt = "CURRENT_USER() FUNCTION sociedades_total() RETURNS INT RETURN 1";

    assert_eq!(
        find_first_top_level_object_keyword(stmt),
        Some("FUNCTION sociedades_total() RETURNS INT RETURN 1")
    );
}

#[test]
fn find_first_top_level_object_keyword_stops_at_view_before_body_keywords() {
    let stmt =
        "'root' @ 'localhost' VIEW v AS SELECT 'PROCEDURE' AS word UNION SELECT 'FUNCTION' AS word";

    assert_eq!(
        find_first_top_level_object_keyword(stmt),
        Some("VIEW v AS SELECT 'PROCEDURE' AS word UNION SELECT 'FUNCTION' AS word")
    );
}

#[test]
fn routes_repeated_whitespace_definer_routines_through_text_protocol() {
    for sql in [
        "CREATE  DEFINER=`root`@`localhost` PROCEDURE sociedades_close() SELECT 1;",
        "CREATE OR  REPLACE DEFINER=`root`@`localhost` FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "CREATE OR REPLACE  DEFINER=`root`@`localhost` FUNCTION sociedades_total() RETURNS INT RETURN 1;",
    ] {
        assert!(
            is_text_protocol_stmt(sql),
            "expected repeated-whitespace definer routine to route through text protocol: {sql}"
        );
    }
}

#[test]
fn keeps_repeated_whitespace_definer_views_out_of_text_protocol() {
    for sql in [
        "CREATE  DEFINER=`root`@`localhost` VIEW v AS SELECT 'PROCEDURE' AS word",
        "CREATE OR  REPLACE DEFINER=`root`@`localhost` VIEW v AS SELECT 'FUNCTION' AS word",
        "CREATE OR REPLACE  DEFINER=`root`@`localhost` VIEW v AS SELECT routine_name FROM routines",
    ] {
        assert!(
            !is_text_protocol_stmt(sql),
            "repeated-whitespace definer view must not route through text protocol: {sql}"
        );
    }
}

#[test]
fn leading_hash_comments_are_skipped() {
    assert!(is_text_protocol_stmt("# start\nSTART TRANSACTION"));
    assert!(is_text_protocol_stmt("#a\n-- b\nCOMMIT"));
    assert!(!is_text_protocol_stmt("# note\nSELECT 1"));
}

#[test]
fn is_single_statement_accepts_a_text_without_separators() {
    for sql in [
        "SELECT * FROM `items` LIMIT 501 OFFSET 0",
        "SELECT 1",
        "UPDATE t SET a = 'x' WHERE id = 1",
        "SHOW TABLES /* note */",
    ] {
        assert!(is_single_statement(sql), "{sql}");
    }
}

#[test]
fn is_single_statement_sets_trailing_terminators_aside() {
    for sql in ["SELECT 1;", "SELECT 1 ;\n", "SELECT 1;;  ", ""] {
        assert!(is_single_statement(sql), "{sql:?}");
    }
}

#[test]
fn is_single_statement_refuses_a_second_statement() {
    for sql in [
        "SELECT 1; DROP TABLE t",
        "SELECT 1; -- note",
        "SELECT 1;/* note */",
        "COMMIT; DELETE FROM t;",
    ] {
        assert!(!is_single_statement(sql), "{sql}");
    }
}

#[test]
fn is_single_statement_refuses_a_separator_it_cannot_place() {
    // Inside a string, a comment or an executable comment the `;` separates
    // nothing, or does: telling which depends on the server's sql_mode.
    for sql in [
        "SELECT 'a;b'",
        "SELECT 1 /* ; */",
        "SELECT 1 /*!50000 ; DROP TABLE t */",
        "SELECT `a;b` FROM t",
    ] {
        assert!(!is_single_statement(sql), "{sql}");
    }
}
