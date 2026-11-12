use super::build_mysql_pk_where;
use super::helpers::{
    inline_str_placeholders, mysql_bytes_literal, mysql_column_types, mysql_string_literal,
};
use super::{is_text_protocol_stmt, push_mysql_update_value, MysqlDriver, TextProto};
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
fn mysql_json_update_value_binds_without_json_cast() {
    let mut qb = sqlx::QueryBuilder::<sqlx::MySql>::new("SET `payload` = ");

    push_mysql_update_value(
        &mut qb,
        &serde_json::json!({ "ok": true }),
        TextProto::PREPARED,
        1024,
    )
    .unwrap();

    assert_eq!(qb.sql(), "SET `payload` = ?");
}

#[test]
fn mysql_json_update_value_inlines_without_json_cast_in_text_protocol() {
    let mut qb = sqlx::QueryBuilder::<sqlx::MySql>::new("SET `payload` = ");

    push_mysql_update_value(
        &mut qb,
        &serde_json::json!({ "ok": true }),
        TextProto::protocol_only(true),
        1024,
    )
    .unwrap();

    assert_eq!(qb.sql(), "SET `payload` = '{\\\"ok\\\":true}'");
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

mod column_default_sql_tests {
    use super::super::helpers::{mysql_default_sql, mysql_on_update, mysql_server_flags};

    fn mysql(raw: Option<&str>, extra: &str, data_type: &str) -> Option<String> {
        mysql_default_sql(raw, extra, data_type, false, false)
    }

    #[test]
    fn quotes_mysql_literals_like_show_create_table() {
        assert_eq!(mysql(Some("new"), "", "varchar").as_deref(), Some("'new'"));
        assert_eq!(mysql(Some("5"), "", "int").as_deref(), Some("'5'"));
        assert_eq!(
            mysql(Some("1.50"), "", "decimal").as_deref(),
            Some("'1.50'")
        );
        assert_eq!(
            mysql(Some("2020-01-02"), "", "date").as_deref(),
            Some("'2020-01-02'")
        );
        assert_eq!(mysql(Some("y"), "", "enum").as_deref(), Some("'y'"));
        assert_eq!(mysql(Some(""), "", "varchar").as_deref(), Some("''"));
    }

    #[test]
    fn escapes_quotes_and_backslashes_for_the_sql_mode() {
        assert_eq!(
            mysql(Some("it's \\ x"), "", "varchar").as_deref(),
            Some("'it\\'s \\\\ x'")
        );
        assert_eq!(
            mysql_default_sql(Some("it's \\ x"), "", "varchar", false, true).as_deref(),
            Some("'it''s \\ x'")
        );
    }

    #[test]
    fn a_string_that_reads_current_timestamp_stays_a_string() {
        assert_eq!(
            mysql(Some("CURRENT_TIMESTAMP"), "", "varchar").as_deref(),
            Some("'CURRENT_TIMESTAMP'")
        );
    }

    #[test]
    fn keeps_expression_defaults_as_expressions() {
        assert_eq!(
            mysql(Some("CURRENT_TIMESTAMP"), "DEFAULT_GENERATED", "timestamp").as_deref(),
            Some("CURRENT_TIMESTAMP")
        );
        assert_eq!(
            mysql(
                Some("CURRENT_TIMESTAMP(3)"),
                "DEFAULT_GENERATED",
                "datetime"
            )
            .as_deref(),
            Some("CURRENT_TIMESTAMP(3)")
        );
        assert_eq!(
            mysql(Some("uuid()"), "DEFAULT_GENERATED", "varchar").as_deref(),
            Some("(uuid())")
        );
        assert_eq!(
            mysql(Some("json_array()"), "DEFAULT_GENERATED", "json").as_deref(),
            Some("(json_array())")
        );
    }

    #[test]
    fn unescapes_expression_defaults_with_string_literals() {
        // COLUMN_DEFAULT escapes quotes and backslashes once more than
        // SHOW CREATE TABLE prints them (bytes checked with HEX() on 8.4).
        assert_eq!(
            mysql(
                Some(r"concat(_latin1\'a\',_latin1\'b\')"),
                "DEFAULT_GENERATED",
                "varchar"
            )
            .as_deref(),
            Some("(concat(_latin1'a',_latin1'b'))")
        );
        assert_eq!(
            mysql(
                Some(r"json_object(_latin1\'a\',_latin1\'it\\\'s\')"),
                "DEFAULT_GENERATED",
                "json"
            )
            .as_deref(),
            Some(r"(json_object(_latin1'a',_latin1'it\'s'))")
        );
        assert_eq!(
            mysql(
                Some(r"json_array(_latin1\'x\\\\y\')"),
                "DEFAULT_GENERATED",
                "json"
            )
            .as_deref(),
            Some(r"(json_array(_latin1'x\\y'))")
        );
    }

    #[test]
    fn expression_literals_follow_no_backslash_escapes() {
        let nbe =
            |raw: &str| mysql_default_sql(Some(raw), "DEFAULT_GENERATED", "json", false, true);
        assert_eq!(
            nbe(r"concat(_latin1\'a\',_latin1\'b\')").as_deref(),
            Some("(concat(_latin1'a',_latin1'b'))")
        );
        assert_eq!(
            nbe(r"json_object(_latin1\'a\',_latin1\'it\\\'s\')").as_deref(),
            Some("(json_object(_latin1'a',_latin1'it''s'))")
        );
        assert_eq!(
            nbe(r"json_array(_latin1\'x\\\\y\')").as_deref(),
            Some(r"(json_array(_latin1'x\y'))")
        );
        assert_eq!(
            nbe(r"concat(_utf8mb4\'a\\nb\',`col`)").as_deref(),
            Some("(concat(_utf8mb4'a\nb',`col`))")
        );
    }

    #[test]
    fn mysql_57_current_timestamp_has_no_marker_but_stays_bare() {
        assert_eq!(
            mysql(
                Some("CURRENT_TIMESTAMP"),
                "on update CURRENT_TIMESTAMP",
                "timestamp"
            )
            .as_deref(),
            Some("CURRENT_TIMESTAMP")
        );
    }

    #[test]
    fn keeps_bit_literals() {
        assert_eq!(mysql(Some("b'1'"), "", "bit").as_deref(), Some("b'1'"));
    }

    #[test]
    fn no_default_stays_none() {
        assert_eq!(mysql(None, "", "varchar"), None);
    }

    #[test]
    fn mariadb_defaults_are_already_sql() {
        let maria = |raw| mysql_default_sql(Some(raw), "", "varchar", true, false);
        assert_eq!(maria("'new'").as_deref(), Some("'new'"));
        assert_eq!(
            maria("current_timestamp()").as_deref(),
            Some("current_timestamp()")
        );
        assert_eq!(maria("5").as_deref(), Some("5"));
        assert_eq!(maria("NULL"), None);
    }

    #[test]
    fn reads_on_update_from_extra() {
        assert_eq!(
            mysql_on_update("DEFAULT_GENERATED on update CURRENT_TIMESTAMP").as_deref(),
            Some("CURRENT_TIMESTAMP")
        );
        assert_eq!(
            mysql_on_update("on update current_timestamp(3)").as_deref(),
            Some("current_timestamp(3)")
        );
        assert_eq!(mysql_on_update("auto_increment"), None);
        assert_eq!(mysql_on_update(""), None);
    }

    #[test]
    fn reads_server_flags() {
        assert_eq!(
            mysql_server_flags("8.4.6", "STRICT_TRANS_TABLES"),
            (false, false)
        );
        assert_eq!(
            mysql_server_flags(
                "10.11.8-MariaDB-ubu2204",
                "NO_BACKSLASH_ESCAPES,ANSI_QUOTES"
            ),
            (true, true)
        );
    }
}

mod alter_column_keeps_default_tests {
    use super::*;
    use crate::models::ColumnDefinition;

    fn column(name: &str, default: Option<&str>, on_update: Option<&str>) -> ColumnDefinition {
        ColumnDefinition {
            name: name.into(),
            data_type: "TIMESTAMP".into(),
            is_nullable: false,
            is_pk: false,
            is_auto_increment: false,
            default_value: default.map(Into::into),
            comment: None,
            on_update: on_update.map(Into::into),
        }
    }

    #[tokio::test]
    async fn rename_restates_default_and_on_update() {
        let old = column(
            "updated",
            Some("CURRENT_TIMESTAMP"),
            Some("CURRENT_TIMESTAMP"),
        );
        let new = column(
            "modified_at",
            Some("CURRENT_TIMESTAMP"),
            Some("CURRENT_TIMESTAMP"),
        );
        let sql = MysqlDriver::new()
            .get_alter_column_sql("t", old, new, None)
            .await
            .unwrap();
        assert_eq!(
            sql,
            vec![
                "ALTER TABLE `t` CHANGE `updated` `modified_at` TIMESTAMP NOT NULL \
                 DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
                    .to_string()
            ]
        );
    }

    #[tokio::test]
    async fn no_on_update_without_one() {
        let sql = MysqlDriver::new()
            .get_alter_column_sql("t", column("a", None, None), column("b", None, None), None)
            .await
            .unwrap();
        assert_eq!(
            sql,
            vec!["ALTER TABLE `t` CHANGE `a` `b` TIMESTAMP NOT NULL".to_string()]
        );
    }
}

mod mysql_column_types_tests {
    use super::*;

    fn types(data_type: &str, column_type: &str) -> (String, Option<String>) {
        mysql_column_types(data_type.to_string(), column_type.to_string())
    }

    #[test]
    fn keeps_the_base_name_and_moves_the_column_type_to_full_type() {
        assert_eq!(
            types("varchar", "varchar(255)"),
            ("varchar".to_string(), Some("varchar(255)".to_string()))
        );
        assert_eq!(
            types("decimal", "decimal(10,2)"),
            ("decimal".to_string(), Some("decimal(10,2)".to_string()))
        );
        assert_eq!(
            types("tinyint", "tinyint(1)"),
            ("tinyint".to_string(), Some("tinyint(1)".to_string()))
        );
        assert_eq!(
            types("int", "int unsigned"),
            ("int".to_string(), Some("int unsigned".to_string()))
        );
        assert_eq!(
            types("int", "int(11)"),
            ("int".to_string(), Some("int(11)".to_string()))
        );
        assert_eq!(
            types("datetime", "datetime(3)"),
            ("datetime".to_string(), Some("datetime(3)".to_string()))
        );
    }

    #[test]
    fn omits_full_type_when_the_column_type_adds_nothing() {
        assert_eq!(types("text", "text"), ("text".to_string(), None));
        assert_eq!(types("json", "json"), ("json".to_string(), None));
        assert_eq!(types("int", ""), ("int".to_string(), None));
    }

    #[test]
    fn enum_and_set_keep_their_values_in_data_type() {
        assert_eq!(
            types("enum", "enum('pending','approved')"),
            ("enum('pending','approved')".to_string(), None)
        );
        assert_eq!(
            types("SET", "set('a','b')"),
            ("set('a','b')".to_string(), None)
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
        let pairs = build_mysql_pk_where(&pk_map, &Default::default()).unwrap();
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].0, "id");
        assert_eq!(pairs[0].1, serde_json::json!(42));
    }

    #[test]
    fn composite_pk_columns_are_sorted_alphabetically() {
        let mut pk_map = HashMap::new();
        pk_map.insert("z_col".to_string(), serde_json::json!(1));
        pk_map.insert("a_col".to_string(), serde_json::json!(2));
        let pairs = build_mysql_pk_where(&pk_map, &Default::default()).unwrap();
        assert_eq!(pairs[0].0, "a_col");
        assert_eq!(pairs[1].0, "z_col");
    }

    #[test]
    fn float_identities_widen_without_changing_other_column_values() {
        let float_columns = std::collections::HashSet::from(["price".to_string()]);
        for (shown, widened) in [
            (89.9, 89.9000015258789),
            (59.99, 59.9900016784668),
            (29.5, 29.5),
        ] {
            let pk_map = HashMap::from([
                ("price".to_string(), serde_json::json!(shown)),
                ("double_price".to_string(), serde_json::json!(shown)),
                ("id".to_string(), serde_json::json!(9007199254740993u64)),
            ]);
            let pairs = build_mysql_pk_where(&pk_map, &float_columns).unwrap();
            assert_eq!(
                pairs,
                vec![
                    ("double_price".to_string(), serde_json::json!(shown)),
                    ("id".to_string(), serde_json::json!(9007199254740993u64)),
                    ("price".to_string(), serde_json::json!(widened)),
                ]
            );
        }
        for value in [
            serde_json::Value::Null,
            serde_json::json!("89.9"),
            serde_json::json!(true),
            serde_json::json!(1e100),
        ] {
            let pk_map = HashMap::from([("price".to_string(), value.clone())]);
            assert_eq!(
                build_mysql_pk_where(&pk_map, &float_columns).unwrap()[0].1,
                value
            );
        }
    }

    #[test]
    fn empty_pk_map_is_rejected() {
        let pk_map: HashMap<String, serde_json::Value> = HashMap::new();
        assert!(build_mysql_pk_where(&pk_map, &Default::default()).is_err());
    }
}

mod push_pk_condition_tests {
    use super::super::{push_pk_condition, TextProto};

    fn render(val: serde_json::Value) -> String {
        let mut qb = sqlx::QueryBuilder::<sqlx::MySql>::new("");
        push_pk_condition(&mut qb, "col", &val, TextProto::PREPARED).unwrap();
        qb.sql().to_string()
    }

    #[test]
    fn number_binds_with_equality() {
        assert_eq!(render(serde_json::json!(42)), "`col` = ?");
    }

    #[test]
    fn string_binds_with_equality() {
        assert_eq!(render(serde_json::json!("alice")), "`col` = ?");
    }

    #[test]
    fn binary_wire_value_binds_with_equality() {
        let wire_value = crate::drivers::common::encode_blob(&[
            0x55, 0x0e, 0x84, 0x00, 0xe2, 0x9b, 0x41, 0xd4, 0xa7, 0x16, 0x44, 0x66, 0x55, 0x44,
            0x00, 0x00,
        ]);
        assert_eq!(render(serde_json::json!(wire_value)), "`col` = ?");
    }

    #[test]
    fn binary_wire_value_inlines_hex_literal_in_text_protocol() {
        let wire_value = crate::drivers::common::encode_blob(&[0x00, 0x7f, 0xff]);
        let mut qb = sqlx::QueryBuilder::<sqlx::MySql>::new("");
        push_pk_condition(
            &mut qb,
            "col",
            &serde_json::json!(wire_value),
            TextProto::protocol_only(true),
        )
        .unwrap();
        assert_eq!(qb.sql(), "`col` = x'007fff'");
    }

    #[test]
    fn bool_binds_with_equality() {
        assert_eq!(render(serde_json::json!(true)), "`col` = ?");
    }

    // Keyless tables (#598) identify rows by all comparable columns, so a
    // pk_map entry may legitimately be NULL and must render as IS NULL.
    #[test]
    fn null_renders_is_null_without_binding() {
        assert_eq!(render(serde_json::Value::Null), "`col` IS NULL");
    }

    #[test]
    fn bool_inlines_literal_in_text_protocol() {
        let mut qb = sqlx::QueryBuilder::<sqlx::MySql>::new("");
        push_pk_condition(
            &mut qb,
            "col",
            &serde_json::json!(true),
            TextProto::protocol_only(true),
        )
        .unwrap();
        assert_eq!(qb.sql(), "`col` = TRUE");
    }

    #[test]
    fn array_value_is_rejected() {
        let mut qb = sqlx::QueryBuilder::<sqlx::MySql>::new("");
        assert!(push_pk_condition(
            &mut qb,
            "col",
            &serde_json::json!([1, 2]),
            TextProto::PREPARED
        )
        .is_err());
    }

    #[test]
    fn backtick_in_column_name_is_escaped() {
        let mut qb = sqlx::QueryBuilder::<sqlx::MySql>::new("");
        push_pk_condition(
            &mut qb,
            "a`b",
            &serde_json::Value::Null,
            TextProto::PREPARED,
        )
        .unwrap();
        assert_eq!(qb.sql(), "`a``b` IS NULL");
    }
}

mod routine_management {
    use super::super::routines::{
        drop_routine_sql, routine_call_sql, routine_create_template, routine_edit_script,
        show_create_routine_sql,
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
        assert_eq!(sql, "CALL `sp_out`(1, @p_out);\nSELECT @p_out AS `p_out`;");
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

    #[test]
    fn show_create_qualifies_routine_with_schema() {
        assert_eq!(
            show_create_routine_sql("ppi", "laporanTertusukJarum", "PROCEDURE"),
            "SHOW CREATE PROCEDURE `ppi`.`laporanTertusukJarum`"
        );
        assert_eq!(
            show_create_routine_sql("aplikasi", "fn_add", "FUNCTION"),
            "SHOW CREATE FUNCTION `aplikasi`.`fn_add`"
        );
    }

    #[test]
    fn show_create_escapes_schema_and_name() {
        assert_eq!(
            show_create_routine_sql("weird`db", "weird`name", "procedure"),
            "SHOW CREATE PROCEDURE `weird``db`.`weird``name`"
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
    use crate::models::{
        ConnectionParams, DatabaseSelection, ExplainQueryOutput, RawExplainOutput,
    };

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

/// Live checks that the query timeout and Stop end the statement on the
/// server, not just on the client. Each test looks for its own statement in
/// `information_schema.PROCESSLIST`.
///
/// ```text
/// TABULARIS_TEST_MYSQL=1 cargo test live_mysql_query_timeout -- --ignored
/// ```
#[cfg(test)]
mod live_mysql_query_timeout {
    use crate::models::{ConnectionParams, DatabaseSelection};
    use std::time::{Duration, Instant};

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

    /// Sleeps inside a `WHERE`, so both MySQL and MariaDB report error 1317
    /// when it is stopped. A bare `SELECT SLEEP(n)` returns 1 on MySQL instead.
    fn sleeping_query(marker: &str) -> String {
        format!("SELECT 1 FROM DUAL WHERE SLEEP(60) /* {marker} */")
    }

    /// Whether another connection is running a statement containing `marker`.
    async fn server_is_running(params: &ConnectionParams, marker: &str) -> bool {
        let pool = crate::pool_manager::get_mysql_pool_with_id(params, Some(marker))
            .await
            .expect("connect to test mysql");
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM information_schema.PROCESSLIST \
             WHERE ID <> CONNECTION_ID() AND COMMAND IN ('Query', 'Execute') \
             AND INSTR(INFO, ?) > 0",
        )
        .bind(marker)
        .fetch_one(&pool)
        .await
        .expect("read the process list");
        count > 0
    }

    async fn wait_until(params: &ConnectionParams, marker: &str, running: bool) -> bool {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if server_is_running(params, marker).await == running {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        false
    }

    #[tokio::test]
    #[ignore]
    async fn live_mysql_query_timeout_stops_the_statement_on_the_server() {
        let Some(mut params) = test_params() else {
            eprintln!("skipping: set TABULARIS_TEST_MYSQL=1 to run this test");
            return;
        };
        let marker = "tabularis_989_mysql_timeout";
        // Each test gets its own pool: a pool outlives the runtime that made it.
        params.connection_id = Some(format!("{marker}_run"));
        params.query_timeout_secs = Some(1);
        let queries = vec![
            sleeping_query(marker),
            "SELECT 1 AS still_usable".to_string(),
        ];

        let start = Instant::now();
        let results = super::super::execute_batch(&params, &queries, None, 1, None, None)
            .await
            .expect("the batch completes");

        let elapsed = start.elapsed();
        assert!(elapsed < Duration::from_secs(10), "took {elapsed:?}");
        let error = results[0].error.as_deref().unwrap_or_default();
        assert!(
            error.contains("stopped after 1 s"),
            "unexpected error: {error}"
        );
        assert!(
            results[1].result.is_some(),
            "the connection is usable after the kill: {:?}",
            results[1].error
        );
        assert!(
            wait_until(&params, marker, false).await,
            "the server is still running the timed-out statement"
        );
    }

    #[tokio::test]
    #[ignore]
    async fn live_mysql_dropped_run_stops_the_statement_on_the_server() {
        let Some(mut params) = test_params() else {
            eprintln!("skipping: set TABULARIS_TEST_MYSQL=1 to run this test");
            return;
        };
        let marker = "tabularis_989_mysql_stop";
        params.connection_id = Some(format!("{marker}_run"));
        let query = sleeping_query(marker);

        // What the Stop button does: abort the task running the query.
        let run = {
            let params = params.clone();
            tokio::spawn(async move {
                super::super::execute_query(&params, &query, None, 1, None).await
            })
        };
        assert!(
            wait_until(&params, marker, true).await,
            "the statement never started"
        );
        run.abort();

        assert!(
            wait_until(&params, marker, false).await,
            "the server is still running the stopped statement"
        );
    }
}
