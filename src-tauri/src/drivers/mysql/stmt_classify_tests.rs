use super::stmt_classify::{find_first_top_level_object_keyword, is_text_protocol_stmt};

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
