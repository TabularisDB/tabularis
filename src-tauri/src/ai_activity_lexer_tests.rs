//! Tests for the dialect-aware lexing behind the AI / MCP read-only
//! classifier (`classify_query_kind_for_dialect`, `has_multiple_statements`).
//!
//! Each "bypass" case is a payload whose real engine sees a second statement
//! (or a write) that a single, dialect-agnostic tokenization would hide inside
//! a string, comment or quoted identifier. Each "legit" case is an ordinary
//! read that must stay a read for the dialect it is written in.

#[cfg(test)]
mod tests {
    use crate::ai_activity::{
        classify_query_kind, classify_query_kind_for_dialect, has_multiple_statements,
        strip_strings_and_comments,
    };
    use crate::drivers::driver_trait::SqlDialect;

    const PG: Option<SqlDialect> = Some(SqlDialect::Postgres);
    const MYSQL: Option<SqlDialect> = Some(SqlDialect::Mysql);
    const MSSQL: Option<SqlDialect> = Some(SqlDialect::Mssql);
    const SQLITE: Option<SqlDialect> = Some(SqlDialect::Sqlite);
    const GENERIC: Option<SqlDialect> = Some(SqlDialect::Generic);

    fn assert_not_read(sql: &str, dialects: &[Option<SqlDialect>]) {
        for dialect in dialects {
            assert_ne!(
                classify_query_kind_for_dialect(sql, *dialect),
                "select",
                "dialect {dialect:?} classified a non-read as a read: {sql:?}"
            );
        }
    }

    fn assert_read(sql: &str, dialect: Option<SqlDialect>) {
        assert_eq!(
            classify_query_kind_for_dialect(sql, dialect),
            "select",
            "dialect {dialect:?} rejected a plain read: {sql:?}"
        );
    }

    // -----------------------------------------------------------------------
    // MySQL / MariaDB
    // -----------------------------------------------------------------------

    #[test]
    fn hash_comment_cannot_hide_a_second_statement() {
        // MySQL: `#` comments out the `'`, so `; DROP TABLE t` runs. Read as
        // plain text, the `'` opened a string that swallowed the separator.
        let q = "SELECT 1 # '\n; DROP TABLE t";
        assert_not_read(q, &[None, MYSQL, GENERIC]);
        assert_eq!(classify_query_kind(q), "unknown");
        assert!(has_multiple_statements(q, None));
        assert!(has_multiple_statements(q, MYSQL));
    }

    #[test]
    fn hash_comment_cannot_hide_a_write_keyword_either_way() {
        // Text after `#` is code on PostgreSQL (XOR operator), so a keyword
        // there still counts when the dialect is unknown.
        assert_not_read("SELECT a # b INTO t2 FROM t", &[None, PG]);
    }

    #[test]
    fn backslash_escaped_double_quote_cannot_hide_a_second_statement() {
        // MySQL (no ANSI_QUOTES): `"\""` is a one-character string, so the
        // `;` is a separator. Read as an identifier, `"\"` closed early and
        // the next `"` swallowed the rest.
        assert_not_read("SELECT \"\\\"\"; DROP TABLE t", &[None, MYSQL, GENERIC]);
    }

    #[test]
    fn backslash_escaped_backtick_cannot_hide_a_second_statement() {
        // Engines that honour backslash escapes in backtick identifiers read
        // `` `\`` `` as one identifier and run the DROP.
        let q = "SELECT `\\``; DROP TABLE t";
        assert_not_read(q, &[None, GENERIC]);
        assert!(has_multiple_statements(q, None));
    }

    #[test]
    fn mysql_dash_without_space_is_not_a_comment() {
        // MySQL: `--1` is `- -1`, not a comment, so the `;` is a separator.
        assert_not_read("SELECT 1 --1; DROP TABLE t", &[None, MYSQL]);
        // On PostgreSQL it is a comment, so the statement is a plain read.
        assert_read("SELECT 1 --1; DROP TABLE t", PG);
    }

    #[test]
    fn mysql_executable_comments_are_scanned_as_code() {
        assert_not_read("SELECT 1 /*!; DROP TABLE t */", &[None, MYSQL]);
        assert_not_read("SELECT 1 /*!50000 ; DROP TABLE t */", &[None, MYSQL]);
        assert_not_read("SELECT 1 /*M!100100 ; DROP TABLE t */", &[None, MYSQL]);
        assert_not_read("SELECT 1 /*!50000 INTO OUTFILE '/tmp/x' */", &[None, MYSQL]);
        // Optimizer hints are ordinary comments.
        assert_read("SELECT /*+ MAX_EXECUTION_TIME(1000) */ * FROM t", MYSQL);
    }

    #[test]
    fn mysql_no_backslash_escapes_mode_is_covered() {
        // With NO_BACKSLASH_ESCAPES the string is `\`, so the `;` is real.
        assert_not_read("SELECT 'x\\'; DROP TABLE t; -- '", &[None, MYSQL]);
    }

    #[test]
    fn mysql_legit_reads_stay_reads() {
        for q in [
            "# leading comment\nSELECT 1",
            "SELECT 1 # trailing comment",
            "SELECT 1 -- trailing comment",
            "SELECT 'it\\'s' FROM t",
            "SELECT \"a\", `b``c` FROM `db`.`t` WHERE x = 'a;b'",
            "SELECT 1 - -1 FROM t",
            "SELECT /* ; */ 1",
            "SHOW TABLES",
        ] {
            assert_read(q, MYSQL);
        }
    }

    // -----------------------------------------------------------------------
    // PostgreSQL
    // -----------------------------------------------------------------------

    #[test]
    fn nested_block_comment_cannot_hide_a_second_statement() {
        // PostgreSQL nests block comments: the comment ends at the second
        // `*/`, so the `;` is a separator. A non-nesting reader ended it at
        // the first `*/` and took `' */ ; DROP …'` for a string.
        let q = "SELECT 1 /* /* */ ' */ ; DROP TABLE t; -- '";
        assert_not_read(q, &[None, PG, MSSQL, GENERIC]);
    }

    #[test]
    fn semicolon_after_an_inner_comment_close_fails_closed() {
        // Postgres-dialect plugins may not nest comments, so the postgres set
        // keeps a non-nesting pass: a `;` between the inner and outer `*/` is
        // treated as a possible separator.
        assert_eq!(
            classify_query_kind_for_dialect("SELECT 1 /* a /* b */ ; */ FROM t", PG),
            "unknown"
        );
    }

    #[test]
    fn carriage_return_ends_a_postgres_line_comment() {
        assert_not_read("SELECT 1 -- x\r; DROP TABLE t", &[None, PG]);
    }

    #[test]
    fn dollar_inside_an_identifier_does_not_open_a_dollar_quote() {
        assert_not_read("SELECT 1 AS a$b$; DROP TABLE t; --$b$", &[None, PG]);
        assert_eq!(
            strip_strings_and_comments("SELECT a$b$ FROM t"),
            "SELECT a$b$ FROM t"
        );
    }

    #[test]
    fn identifier_ending_in_e_does_not_open_an_escape_string() {
        // `xE'\'` and `éE'\'` are an identifier followed by the standard
        // string `'\'`; the `;` after it is a separator.
        assert_not_read("SELECT 1 AS xE'\\'; DROP TABLE t; --'", &[None, PG]);
        assert_not_read("SELECT 1 AS \u{e9}E'\\'; DROP TABLE t; --'", &[None, PG]);
    }

    #[test]
    fn non_ascii_dollar_quote_tag_is_recognised() {
        assert_not_read("SELECT $\u{e9}$ ' $\u{e9}$; DROP TABLE t; --'", &[None, PG]);
        assert_read("SELECT $\u{e9}$ ; ' $\u{e9}$ AS x", PG);
    }

    #[test]
    fn postgres_legit_reads_stay_reads() {
        for q in [
            "SELECT E'it\\'s; fine', E'\\\\' FROM t",
            "SELECT $$a ; b$$, $tag$ ' ; $tag$ FROM t",
            "SELECT $1::int, a$b FROM t",
            "SELECT data #>> '{a,b}', 5 # 3 FROM t",
            "SELECT 1 /* outer /* inner ; */ still comment */ FROM t",
            "SELECT \"we;ird\" FROM \"s\".\"t\"",
            "SELECT arr[1] FROM t -- note ; here",
            "SELECT U&'d\\0061t\\+000061' FROM t",
        ] {
            assert_read(q, PG);
        }
    }

    // -----------------------------------------------------------------------
    // SQL Server / SQLite
    // -----------------------------------------------------------------------

    #[test]
    fn bracket_identifier_cannot_hide_a_second_statement() {
        // SQL Server: `[x']` is an identifier, so the `;` is a separator. As
        // plain text, the `'` opened a string that swallowed it.
        let q = "SELECT 1 AS [x'] ; DROP TABLE t; --']";
        assert_not_read(q, &[None, MSSQL, SQLITE, GENERIC]);
    }

    #[test]
    fn bracket_identifiers_are_reads() {
        for dialect in [MSSQL, SQLITE] {
            assert_read("SELECT [a;b], [it's], [x]]y] FROM [dbo].[t]", dialect);
        }
        // A scalar function called through bracketed names is still a read.
        assert_read("SELECT [dbo].[fn](1)", MSSQL);
        assert_read("SELECT 1 /* a /* b */ c */ FROM t", MSSQL);
        assert_read("SELECT `a`, \"b\" FROM t", SQLITE);
    }

    #[test]
    fn sqlite_backslash_is_literal() {
        assert_not_read("SELECT 'x\\'; DROP TABLE t; -- '", &[SQLITE]);
    }

    // -----------------------------------------------------------------------
    // Triple-quoted strings and backslash-escaping engines
    // -----------------------------------------------------------------------

    #[test]
    fn triple_quoted_string_cannot_hide_a_second_statement() {
        // `'''a'b'''` is one string, so the `;` is a separator. Read as
        // doubled quotes, the closing `'''` opened a new string.
        assert_not_read("SELECT '''a'b''' ; DROP TABLE t", &[None, GENERIC]);
        assert_not_read("SELECT \"\"\"a\"b\"\"\" ; DROP TABLE t", &[None, GENERIC]);
    }

    #[test]
    fn triple_quoted_strings_without_separators_are_reads() {
        assert_read("SELECT '''multi\nline''' AS x", None);
        assert_read("SELECT \"\"\"multi\nline\"\"\" AS x", None);
    }

    // -----------------------------------------------------------------------
    // Fail-closed composition
    // -----------------------------------------------------------------------

    #[test]
    fn unknown_dialects_use_every_profile() {
        // Oracle, generic and undeclared dialects get the strictest reading.
        for dialect in [None, GENERIC, Some(SqlDialect::Oracle)] {
            assert_not_read("SELECT 1 # '\n; DROP TABLE t", &[dialect]);
            assert_not_read("SELECT $$ ; DELETE FROM t; $$", &[dialect]);
            assert_read("SELECT id, name FROM users WHERE id = 1", dialect);
        }
    }

    #[test]
    fn writes_keep_their_kind_under_every_dialect() {
        for dialect in [None, PG, MYSQL, MSSQL, SQLITE, GENERIC] {
            assert_eq!(
                classify_query_kind_for_dialect("DELETE FROM t", dialect),
                "write"
            );
            assert_eq!(
                classify_query_kind_for_dialect("DROP TABLE t", dialect),
                "ddl"
            );
            assert_eq!(
                classify_query_kind_for_dialect("SELECT 1; DROP TABLE t", dialect),
                "unknown"
            );
        }
    }

    #[test]
    fn has_multiple_statements_matches_the_classifier() {
        assert!(!has_multiple_statements("SELECT 1;", None));
        assert!(!has_multiple_statements("SELECT ';'", None));
        assert!(has_multiple_statements("SELECT 1; SELECT 2", PG));
        assert!(has_multiple_statements(
            "SELECT \"\\\"\"; DROP TABLE t",
            MYSQL
        ));
        assert!(!has_multiple_statements("SELECT $$;$$", PG));
        assert!(has_multiple_statements("SELECT $$;$$", MYSQL));
    }
}
