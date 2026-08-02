use super::build_mysql_pk_where;
use super::{is_text_protocol_stmt, MysqlDriver};
use super::helpers::{inline_str_placeholders, mysql_bytes_literal, mysql_string_literal};
use crate::drivers::driver_trait::DatabaseDriver;
use crate::models::{ConnectionParams, DatabaseSelection};

#[test]
fn build_connection_url_includes_disabled_ssl_mode() {
    let driver = MysqlDriver::new();
    let params = ConnectionParams {
        driver: "mysql".to_string(),
        host: Some("127.0.0.1".to_string()),
        port: Some(3306),
        username: Some("root".to_string()),
        password: Some("secret".to_string()),
        database: DatabaseSelection::Single("dec".to_string()),
        ssl_mode: Some("disabled".to_string()),
        ssl_ca: None,
        ssl_cert: None,
        ssl_key: None,
        ssh_enabled: None,
        ssh_connection_id: None,
        ssh_host: None,
        ssh_port: None,
        ssh_user: None,
        ssh_password: None,
        ssh_key_file: None,
        ssh_key_passphrase: None,
        save_in_keychain: None,
        connection_id: None,
        ..Default::default()
    };

    let url = driver.build_connection_url(&params).unwrap();

    assert!(url.contains("ssl-mode=disabled"), "url was: {url}");
}

// -- Text-protocol literal helpers (Warpgate / cleartext bastion path) -----

#[test]
fn mysql_string_literal_quotes_and_escapes() {
    // Default sql_mode: backslash escapes enabled.
    assert_eq!(mysql_string_literal("public", false), "'public'");
    assert_eq!(mysql_string_literal("o'brien", false), "'o\\'brien'");
    assert_eq!(mysql_string_literal("a\\b", false), "'a\\\\b'");
    assert_eq!(mysql_string_literal("line\nbreak", false), "'line\\nbreak'");
    assert_eq!(mysql_string_literal("", false), "''");
}

#[test]
fn mysql_string_literal_no_backslash_escapes_mode() {
    // Under NO_BACKSLASH_ESCAPES the backslash is literal, so quotes are
    // doubled and backslashes are left untouched. Escaping a single quote as
    // `\'` (the default-mode form) would be mis-parsed here and is an
    // injection vector — verify we use `''` instead.
    assert_eq!(mysql_string_literal("public", true), "'public'");
    assert_eq!(mysql_string_literal("o'brien", true), "'o''brien'");
    assert_eq!(mysql_string_literal("a\\b", true), "'a\\b'");
    // A trailing backslash must not escape the closing quote.
    assert_eq!(mysql_string_literal("ends\\", true), "'ends\\'");
    assert_eq!(
        mysql_string_literal("' OR '1'='1", true),
        "''' OR ''1''=''1'"
    );
}

#[test]
fn mysql_bytes_literal_hex_encodes() {
    assert_eq!(mysql_bytes_literal(&[]), "x''");
    assert_eq!(mysql_bytes_literal(&[0x00, 0x0f, 0xff]), "x'000fff'");
    assert_eq!(mysql_bytes_literal(b"AB"), "x'4142'");
}

#[test]
fn inline_str_placeholders_substitutes_in_order() {
    let sql = "WHERE table_schema = ? AND table_name = ?";
    assert_eq!(
        inline_str_placeholders(sql, &["mydb", "users"], false),
        "WHERE table_schema = 'mydb' AND table_name = 'users'"
    );
}

#[test]
fn inline_str_placeholders_escapes_injection_attempt() {
    let sql = "WHERE table_schema = ?";
    assert_eq!(
        inline_str_placeholders(sql, &["x' OR '1'='1"], false),
        "WHERE table_schema = 'x\\' OR \\'1\\'=\\'1'"
    );
    // Same payload under NO_BACKSLASH_ESCAPES: quotes are doubled.
    assert_eq!(
        inline_str_placeholders(sql, &["x' OR '1'='1"], true),
        "WHERE table_schema = 'x'' OR ''1''=''1'"
    );
}

#[test]
fn inline_str_placeholders_leaves_extra_placeholders() {
    // Fewer binds than placeholders: the surplus `?` stays untouched.
    assert_eq!(
        inline_str_placeholders("a = ? AND b = ?", &["1"], false),
        "a = '1' AND b = ?"
    );
    assert_eq!(
        inline_str_placeholders("no params here", &[], false),
        "no params here"
    );
}

#[test]
fn routes_mysql_routine_ddl_through_text_protocol() {
    for sql in [
        "DROP PROCEDURE IF EXISTS sociedades_close;",
        "CREATE PROCEDURE sociedades_close() SELECT 1;",
        "CREATE DEFINER=`root`@`localhost` PROCEDURE sociedades_close() SELECT 1;",
        "CREATE  DEFINER=`root`@`localhost` PROCEDURE sociedades_close() SELECT 1;",
        "CREATE DEFINER=`root`@`localhost`   PROCEDURE sociedades_close() SELECT 1;",
        "CREATE OR REPLACE PROCEDURE sociedades_close() SELECT 1;",
        "CREATE OR  REPLACE PROCEDURE sociedades_close() SELECT 1;",
        "CREATE OR  REPLACE DEFINER=`root`@`localhost` PROCEDURE sociedades_close() SELECT 1;",
        "CREATE OR REPLACE  DEFINER=`root`@`localhost` PROCEDURE sociedades_close() SELECT 1;",
        "CREATE OR REPLACE DEFINER=`root`@`localhost` PROCEDURE sociedades_close() SELECT 1;",
        "CREATE OR REPLACE DEFINER=`root`@`localhost`   PROCEDURE sociedades_close() SELECT 1;",
        "ALTER PROCEDURE sociedades_close COMMENT 'patched';",
        "DROP FUNCTION IF EXISTS sociedades_total;",
        "CREATE FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "CREATE DEFINER=`root`@`localhost` FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "CREATE  DEFINER=`root`@`localhost` FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "CREATE DEFINER=`root`@`localhost`   FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "CREATE OR REPLACE FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "CREATE OR  REPLACE FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "CREATE OR  REPLACE DEFINER=`root`@`localhost` FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "CREATE OR REPLACE  DEFINER=`root`@`localhost` FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "CREATE OR REPLACE DEFINER=`root`@`localhost` FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "CREATE OR REPLACE DEFINER=`root`@`localhost`   FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "ALTER FUNCTION sociedades_total COMMENT 'patched';",
    ] {
        assert!(
            is_text_protocol_stmt(sql),
            "expected text protocol routing for {sql}"
        );
    }
}

#[test]
fn keeps_regular_dml_out_of_text_protocol_classifier() {
    for sql in [
        "SELECT * FROM routines",
        "INSERT INTO routines(name) VALUES ('sociedades_close')",
        "DROP TABLE IF EXISTS routines_backup",
        // `CREATE OR REPLACE` is also valid for non-routine objects such as
        // VIEW that are not part of this routing rule — must not match.
        "CREATE OR REPLACE VIEW routines_view AS SELECT 1",
    ] {
        assert!(
            !is_text_protocol_stmt(sql),
            "did not expect text protocol routing for {sql}"
        );
    }
}

#[test]
fn definer_view_with_routine_words_in_body_is_not_text_protocol() {
    // `CREATE [OR REPLACE] DEFINER … VIEW … AS SELECT …` must not be
    // classified as a routine even when the SELECT body mentions
    // `PROCEDURE`/`FUNCTION`. Regression for the loose `contains`-based
    // matching that searched the full statement.
    for sql in [
        "CREATE DEFINER=`root`@`localhost` VIEW v AS SELECT 'call PROCEDURE foo' AS col",
        "CREATE OR REPLACE DEFINER=`root`@`localhost` VIEW v AS SELECT name FROM routines WHERE note LIKE '%FUNCTION%'",
        "CREATE OR REPLACE DEFINER=CURRENT_USER() VIEW v AS SELECT 'PROCEDURE' AS word UNION SELECT 'FUNCTION' AS word",
    ] {
        assert!(
            !is_text_protocol_stmt(sql),
            "DEFINER … VIEW with routine words in body must not route through text protocol: {sql}"
        );
    }
}

#[test]
fn spaced_definer_routes_routines_through_text_protocol() {
    // MySQL accepts spaced definer forms such as `'root' @ 'localhost'`
    // where the value contains internal whitespace. The classifier must
    // skip past the whole definer value and find the real object keyword
    // instead of stopping at the first space inside the definer.
    for sql in [
        "CREATE DEFINER = 'root' @ 'localhost' PROCEDURE sociedades_close() SELECT 1;",
        "CREATE DEFINER = 'root' @ 'localhost'   PROCEDURE sociedades_close() SELECT 1;",
        "CREATE OR REPLACE DEFINER = 'root' @ 'localhost' FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "CREATE OR REPLACE DEFINER = 'root' @ 'localhost'   FUNCTION sociedades_total() RETURNS INT RETURN 1;",
    ] {
        assert!(
            is_text_protocol_stmt(sql),
            "expected text protocol routing for spaced definer routine: {sql}"
        );
    }
}

#[test]
fn spaced_definer_view_with_routine_words_in_body_is_not_text_protocol() {
    // A spaced definer must not let `PROCEDURE`/`FUNCTION` words that
    // appear inside a VIEW body route the statement through text
    // protocol — only the actual object-type keyword after the definer
    // clause counts, and the scan must stop at `VIEW` before reaching
    // the body.
    for sql in [
        "CREATE DEFINER = 'root' @ 'localhost' VIEW v AS SELECT 'call PROCEDURE foo' AS col",
        "CREATE OR REPLACE DEFINER = 'root' @ 'localhost' VIEW v AS SELECT name FROM routines WHERE note LIKE '%FUNCTION%'",
        "CREATE DEFINER = 'root' @ 'localhost' VIEW v AS SELECT 'PROCEDURE' AS word UNION SELECT 'FUNCTION' AS word",
    ] {
        assert!(
            !is_text_protocol_stmt(sql),
            "spaced definer VIEW with routine words in body must not route through text protocol: {sql}"
        );
    }
}

mod build_mysql_pk_where_tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn single_column_returns_correct_pair() {
        let mut pk_map = HashMap::new();
        pk_map.insert("id".to_string(), serde_json::json!(42));
        let pairs = build_mysql_pk_where(&pk_map).unwrap();
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].0, "id");
        assert_eq!(pairs[0].1, serde_json::json!(42));
    }

    #[test]
    fn composite_pk_columns_are_sorted_alphabetically() {
        let mut pk_map = HashMap::new();
        pk_map.insert("z_col".to_string(), serde_json::json!(1));
        pk_map.insert("a_col".to_string(), serde_json::json!(2));
        let pairs = build_mysql_pk_where(&pk_map).unwrap();
        assert_eq!(pairs[0].0, "a_col");
        assert_eq!(pairs[1].0, "z_col");
    }

    #[test]
    fn empty_pk_map_is_rejected() {
        let pk_map: HashMap<String, serde_json::Value> = HashMap::new();
        assert!(build_mysql_pk_where(&pk_map).is_err());
    }
}

mod multi_result_collector {
    use super::super::multi_result::ResultSetCollector;
    use serde_json::json;

    fn row(v: i64) -> Vec<serde_json::Value> {
        vec![json!(v)]
    }

    #[test]
    fn single_result_set_is_collected() {
        let mut c = ResultSetCollector::new(None);
        assert!(c.needs_columns());
        c.set_columns(vec!["id".to_string()]);
        assert!(!c.needs_columns());
        c.push_row(row(1));
        c.push_row(row(2));
        c.end_result_set();

        let sets = c.finish();
        assert_eq!(sets.len(), 1);
        assert_eq!(sets[0].columns, vec!["id".to_string()]);
        assert_eq!(sets[0].rows.len(), 2);
        assert!(!sets[0].truncated);
    }

    #[test]
    fn multiple_result_sets_are_split_at_terminators() {
        let mut c = ResultSetCollector::new(None);
        for set in 0..3 {
            assert!(c.needs_columns());
            c.set_columns(vec![format!("col{set}")]);
            c.push_row(row(set));
            c.end_result_set();
        }

        let sets = c.finish();
        assert_eq!(sets.len(), 3);
        assert_eq!(sets[1].columns, vec!["col1".to_string()]);
        assert_eq!(sets[2].rows, vec![row(2)]);
    }

    #[test]
    fn empty_result_sets_are_dropped() {
        // A CALL emits a trailing OK packet that surfaces as an empty set;
        // rowless SELECTs are indistinguishable from it and dropped too.
        let mut c = ResultSetCollector::new(None);
        c.set_columns(vec!["id".to_string()]);
        c.push_row(row(1));
        c.end_result_set();
        c.end_result_set();
        c.end_result_set();

        let sets = c.finish();
        assert_eq!(sets.len(), 1);
    }

    #[test]
    fn no_rows_at_all_yields_no_sets() {
        let mut c = ResultSetCollector::new(None);
        c.end_result_set();
        assert!(c.finish().is_empty());
    }

    #[test]
    fn per_set_limit_truncates_each_set_independently() {
        let mut c = ResultSetCollector::new(Some(2));
        c.set_columns(vec!["id".to_string()]);
        c.push_row(row(1));
        assert!(!c.at_limit());
        c.push_row(row(2));
        assert!(c.at_limit());
        c.note_overflow_row();
        c.end_result_set();

        // The cap applies per result set: the next set starts fresh.
        c.set_columns(vec!["id".to_string()]);
        c.push_row(row(3));
        assert!(!c.at_limit());
        c.end_result_set();

        let sets = c.finish();
        assert_eq!(sets.len(), 2);
        assert_eq!(sets[0].rows.len(), 2);
        assert!(sets[0].truncated);
        assert_eq!(sets[1].rows.len(), 1);
        assert!(!sets[1].truncated);
    }

    #[test]
    fn push_row_beyond_limit_drops_row_and_marks_truncated() {
        let mut c = ResultSetCollector::new(Some(1));
        c.set_columns(vec!["id".to_string()]);
        c.push_row(row(1));
        c.push_row(row(2));
        c.end_result_set();

        let sets = c.finish();
        assert_eq!(sets[0].rows, vec![row(1)]);
        assert!(sets[0].truncated);
    }

    #[test]
    fn finish_flushes_an_unterminated_set() {
        // Defensive: a stream that ends without a final terminator must not
        // lose the in-flight rows.
        let mut c = ResultSetCollector::new(None);
        c.set_columns(vec!["id".to_string()]);
        c.push_row(row(1));

        let sets = c.finish();
        assert_eq!(sets.len(), 1);
        assert_eq!(sets[0].rows.len(), 1);
    }
}

mod routine_management {
    use super::super::routines::{
        drop_routine_sql, routine_call_sql, routine_create_template, routine_edit_script,
    };
    use crate::models::RoutineCallArg;

    fn arg(name: &str, mode: &str, value: Option<&str>, is_raw: bool) -> RoutineCallArg {
        RoutineCallArg {
            name: name.to_string(),
            mode: mode.to_string(),
            value: value.map(|v| v.to_string()),
            is_raw,
        }
    }

    #[test]
    fn call_procedure_with_in_params_quotes_strings() {
        let sql = routine_call_sql(
            "sp_test",
            "PROCEDURE",
            &[arg("p_name", "IN", Some("O'Brien"), false)],
        );
        assert_eq!(sql, "CALL `sp_test`('O\\'Brien');");
    }

    #[test]
    fn call_procedure_raw_and_null_values() {
        let sql = routine_call_sql(
            "sp_test",
            "PROCEDURE",
            &[
                arg("p_id", "IN", Some("42"), true),
                arg("p_note", "IN", None, false),
            ],
        );
        assert_eq!(sql, "CALL `sp_test`(42, NULL);");
    }

    #[test]
    fn call_procedure_with_out_params_uses_session_vars() {
        let sql = routine_call_sql(
            "sp_out",
            "PROCEDURE",
            &[
                arg("p_in", "IN", Some("1"), true),
                arg("p_out", "OUT", None, false),
            ],
        );
        assert_eq!(
            sql,
            "CALL `sp_out`(1, @p_out);\nSELECT @p_out AS `p_out`;"
        );
    }

    #[test]
    fn call_procedure_inout_sets_variable_first() {
        let sql = routine_call_sql(
            "sp_inout",
            "PROCEDURE",
            &[arg("p_counter", "INOUT", Some("5"), true)],
        );
        assert_eq!(
            sql,
            "SET @p_counter = 5;\nCALL `sp_inout`(@p_counter);\nSELECT @p_counter AS `p_counter`;"
        );
    }

    #[test]
    fn call_function_uses_select() {
        let sql = routine_call_sql("fn_add", "FUNCTION", &[arg("a", "IN", Some("2"), true)]);
        assert_eq!(sql, "SELECT `fn_add`(2) AS result;");
    }

    #[test]
    fn out_param_with_hostile_name_is_sanitized() {
        let sql = routine_call_sql(
            "sp",
            "PROCEDURE",
            &[arg("evil; DROP--", "OUT", None, false)],
        );
        assert!(sql.contains("@evilDROP"), "got: {sql}");
    }

    #[test]
    fn create_templates_wrap_in_delimiter() {
        for kind in ["PROCEDURE", "FUNCTION"] {
            let tpl = routine_create_template(kind);
            assert!(tpl.starts_with("DELIMITER //"), "{kind}: {tpl}");
            assert!(tpl.contains(&format!("CREATE {kind}")), "{kind}");
            assert!(tpl.trim_end().ends_with("DELIMITER ;"), "{kind}");
        }
    }

    #[test]
    fn edit_script_drops_then_recreates_in_delimiter_block() {
        let script = routine_edit_script(
            "sp_test",
            "PROCEDURE",
            "CREATE PROCEDURE `sp_test`()\nBEGIN\n    SELECT 1;\nEND",
        );
        assert!(script.starts_with("DROP PROCEDURE IF EXISTS `sp_test`;"));
        assert!(script.contains("DELIMITER //\nCREATE PROCEDURE"));
        assert!(script.contains("END//\nDELIMITER ;"));
    }

    #[test]
    fn drop_sql_escapes_identifier() {
        assert_eq!(
            drop_routine_sql("weird`name", "FUNCTION"),
            "DROP FUNCTION `weird``name`"
        );
    }
}

/// Live coverage for `explain_query`'s fallback chain.
///
/// The parsers are unit-tested in `packages/explain/tests/parsers/`; what
/// needs a real server is the chain — which EXPLAIN variant a given version
/// accepts, and that each stage falls through to the next when its variant is
/// unavailable. MySQL 8.0.18+ takes the `EXPLAIN ANALYZE` text branch, MariaDB
/// 10.1+ the `ANALYZE FORMAT=JSON` branch, and both the `FORMAT=JSON` branch
/// when not analysing.
///
/// ```text
/// TABULARIS_TEST_MYSQL=1 cargo test live_mysql -- --ignored
/// TABULARIS_TEST_MYSQL=1 TABULARIS_TEST_MYSQL_PORT=3307 cargo test live_mysql -- --ignored
/// ```
#[cfg(test)]
mod live_explain_tests {
    use crate::drivers::mysql::explain::explain_query;
    use crate::models::{ConnectionParams, DatabaseSelection, ExplainQueryOutput, RawExplainOutput};

    fn unwrap_raw(output: ExplainQueryOutput) -> RawExplainOutput {
        match output {
            ExplainQueryOutput::Raw { raw } => raw,
            ExplainQueryOutput::Plan { .. } => {
                panic!("a built-in driver must hand over a raw payload")
            }
        }
    }

    fn test_params() -> Option<ConnectionParams> {
        if std::env::var("TABULARIS_TEST_MYSQL").is_err() {
            return None;
        }

        Some(ConnectionParams {
            driver: "mysql".to_string(),
            host: Some(
                std::env::var("TABULARIS_TEST_MYSQL_HOST")
                    .unwrap_or_else(|_| "127.0.0.1".to_string()),
            ),
            port: Some(
                std::env::var("TABULARIS_TEST_MYSQL_PORT")
                    .ok()
                    .and_then(|p| p.parse().ok())
                    .unwrap_or(3306),
            ),
            username: Some(
                std::env::var("TABULARIS_TEST_MYSQL_USER").unwrap_or_else(|_| "root".to_string()),
            ),
            password: Some(
                std::env::var("TABULARIS_TEST_MYSQL_PASSWORD")
                    .unwrap_or_else(|_| "Tabularis_Demo_2026!".to_string()),
            ),
            database: DatabaseSelection::Single(
                std::env::var("TABULARIS_TEST_MYSQL_DB")
                    .unwrap_or_else(|_| "information_schema".to_string()),
            ),
            ssl_mode: Some("disabled".to_string()),
            ..Default::default()
        })
    }

    /// A query every MySQL and MariaDB build can explain without a schema.
    const QUERY: &str = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'information_schema' ORDER BY table_name";

    #[tokio::test]
    #[ignore]
    async fn live_mysql_explain_without_analyze_returns_a_plan() {
        let Some(params) = test_params() else {
            eprintln!("skipping: set TABULARIS_TEST_MYSQL=1 to run this test");
            return;
        };

        let raw = unwrap_raw(
            explain_query(&params, QUERY, false, None)
                .await
                .expect("explain without analyze"),
        );

        assert_eq!(raw.engine, "mysql");
        assert_eq!(
            raw.original_query, QUERY,
            "every branch must stamp the statement it explained"
        );
        assert!(
            !raw.payload.trim().is_empty(),
            "the raw server output is what the frontend parses"
        );
        assert!(
            matches!(raw.format.as_str(), "mysql-json" | "mysql-tabular-rows"),
            "a non-analysing run takes a JSON or tabular branch, got {}",
            raw.format
        );
    }

    #[tokio::test]
    #[ignore]
    async fn live_mysql_explain_with_analyze_returns_actual_data() {
        let Some(params) = test_params() else {
            eprintln!("skipping: set TABULARIS_TEST_MYSQL=1 to run this test");
            return;
        };

        let raw = unwrap_raw(
            explain_query(&params, QUERY, true, None)
                .await
                .expect("explain with analyze"),
        );

        assert_eq!(raw.engine, "mysql");
        assert_eq!(raw.original_query, QUERY);

        // An analysing branch hands over either MySQL's `EXPLAIN ANALYZE`
        // text tree or MariaDB's `ANALYZE FORMAT=JSON` document; both carry
        // measured data the frontend parser surfaces as actual rows/time.
        match raw.format.as_str() {
            "mysql-analyze-text" => assert!(
                raw.payload.contains("actual time="),
                "the text tree must carry measured data — got {:?}",
                &raw.payload[..raw.payload.len().min(200)]
            ),
            "mysql-json" => assert!(
                raw.payload.contains("r_total_time_ms") || raw.payload.contains("r_rows"),
                "the MariaDB document must carry r_* actual fields — got {:?}",
                &raw.payload[..raw.payload.len().min(200)]
            ),
            other => panic!("an analysing run must take an analysing branch, got {other}"),
        }
    }

    #[tokio::test]
    #[ignore]
    async fn live_mysql_explain_falls_through_on_an_unexplainable_statement() {
        let Some(params) = test_params() else {
            eprintln!("skipping: set TABULARIS_TEST_MYSQL=1 to run this test");
            return;
        };

        // No branch can explain this; the chain must surface an error rather
        // than an empty plan.
        let result = explain_query(&params, "SELECT * FROM does_not_exist_xyz", false, None).await;

        assert!(result.is_err(), "unexplainable statement must error");
    }
}
