use super::render::{build, PreviewQuery};
use super::statement::{parse, Rejection};

fn preview(sql: &str) -> PreviewQuery {
    let statement = parse(sql).unwrap_or_else(|e| panic!("{sql}: {e}"));
    build(&statement, 100).unwrap_or_else(|e| panic!("{sql}: {e}"))
}

fn rejection(sql: &str) -> Rejection {
    match parse(sql).and_then(|statement| build(&statement, 100)) {
        Ok(query) => panic!("{sql} was accepted as {}", query.sql),
        Err(e) => e,
    }
}

#[test]
fn update_shows_current_and_proposed_values_side_by_side() {
    let query = preview("UPDATE public.orders SET status = 'paid' WHERE id = 42");
    assert_eq!(
        query.sql,
        "SELECT \"status\" AS \"status (current)\", 'paid' AS \"status (proposed)\", \
         \"orders\".* FROM \"public\".\"orders\" \
         WHERE (\"id\" OPERATOR(pg_catalog.=) 42) LIMIT 101"
    );
    assert_eq!(query.assigned_columns, vec!["status"]);
    assert!(query.has_filter);
}

#[test]
fn delete_selects_the_targeted_rows() {
    let query = preview("delete from orders where status = 'void';");
    assert_eq!(
        query.sql,
        "SELECT \"orders\".* FROM \"orders\" \
         WHERE (\"status\" OPERATOR(pg_catalog.=) 'void') LIMIT 101"
    );
    assert!(query.assigned_columns.is_empty());
}

#[test]
fn a_statement_without_where_is_flagged() {
    assert!(!preview("DELETE FROM orders").has_filter);
    assert!(!preview("UPDATE orders SET n = 0").has_filter);
}

#[test]
fn the_limit_fetches_one_extra_row_to_detect_truncation() {
    let statement = parse("DELETE FROM t").unwrap();
    assert!(build(&statement, 5).unwrap().sql.ends_with(" LIMIT 6"));
}

#[test]
fn several_assignments_keep_their_order() {
    let query = preview("UPDATE t SET b = b + 1, a = NULL");
    assert_eq!(query.assigned_columns, vec!["b", "a"]);
    assert!(query.sql.starts_with(
        "SELECT \"b\" AS \"b (current)\", (\"b\" OPERATOR(pg_catalog.+) 1) AS \"b (proposed)\", \
         \"a\" AS \"a (current)\", NULL AS \"a (proposed)\", \"t\".*"
    ));
}

#[test]
fn identifiers_fold_like_postgres_and_quotes_survive() {
    let query = preview(r#"UPDATE "My Schema"."Order""s" SET "Status" = 'it''s' WHERE Id = 1"#);
    assert_eq!(
        query.sql,
        "SELECT \"Status\" AS \"Status (current)\", 'it''s' AS \"Status (proposed)\", \
         \"Order\"\"s\".* FROM \"My Schema\".\"Order\"\"s\" \
         WHERE (\"id\" OPERATOR(pg_catalog.=) 1) LIMIT 101"
    );
}

#[test]
fn an_alias_is_kept_and_may_qualify_columns() {
    let query = preview("UPDATE orders AS o SET total = o.total * 2 WHERE o.id = 1");
    assert_eq!(
        query.sql,
        "SELECT \"total\" AS \"total (current)\", \
         (\"o\".\"total\" OPERATOR(pg_catalog.*) 2) AS \"total (proposed)\", \
         \"o\".* FROM \"orders\" AS \"o\" \
         WHERE (\"o\".\"id\" OPERATOR(pg_catalog.=) 1) LIMIT 101"
    );
    assert!(preview("DELETE FROM orders o WHERE o.id = 1")
        .sql
        .contains("AS \"o\""));
}

#[test]
fn null_handling_is_preserved() {
    let query = preview("UPDATE t SET note = NULL WHERE note IS NOT NULL AND flag IS TRUE");
    assert!(query.sql.contains("NULL AS \"note (proposed)\""));
    assert!(query
        .sql
        .contains("WHERE ((\"note\" IS NOT NULL) AND (\"flag\" IS TRUE))"));
}

#[test]
fn in_between_and_like_expand_to_pinned_operators() {
    let query =
        preview("DELETE FROM t WHERE id IN (1, 2) AND n NOT BETWEEN 1 AND 5 AND name ILIKE 'a%'");
    assert!(query
        .sql
        .contains("(((\"id\" OPERATOR(pg_catalog.=) 1) OR (\"id\" OPERATOR(pg_catalog.=) 2))"));
    assert!(query.sql.contains(
        "(NOT ((\"n\" OPERATOR(pg_catalog.>=) 1) AND (\"n\" OPERATOR(pg_catalog.<=) 5)))"
    ));
    assert!(query
        .sql
        .contains("(\"name\" OPERATOR(pg_catalog.~~*) 'a%')"));
}

#[test]
fn allowed_functions_and_casts_are_schema_qualified() {
    let query = preview(
        "UPDATE t SET name = lower(btrim(name)), due = '2026-01-01'::date, \
         price = CAST('9.5' AS numeric(10, 2)), n = coalesce(n, 0)",
    );
    assert!(query
        .sql
        .contains("pg_catalog.lower(pg_catalog.btrim(\"name\")) AS \"name (proposed)\""));
    assert!(query
        .sql
        .contains("CAST('2026-01-01' AS pg_catalog.date) AS \"due (proposed)\""));
    assert!(query
        .sql
        .contains("CAST('9.5' AS pg_catalog.numeric(10, 2)) AS \"price (proposed)\""));
    assert!(query.sql.contains("COALESCE(\"n\", 0) AS \"n (proposed)\""));
}

#[test]
fn precedence_follows_postgres() {
    let query = preview("DELETE FROM t WHERE a = 1 OR b = 2 AND NOT c = -3 * 2 + 1");
    assert!(query.sql.ends_with(
        "WHERE ((\"a\" OPERATOR(pg_catalog.=) 1) OR ((\"b\" OPERATOR(pg_catalog.=) 2) AND \
         (NOT (\"c\" OPERATOR(pg_catalog.=) (((OPERATOR(pg_catalog.-) 3) OPERATOR(pg_catalog.*) 2) \
         OPERATOR(pg_catalog.+) 1))))) LIMIT 101"
    ));
}

#[test]
fn comments_are_ignored() {
    let query = preview("/* fix /* nested */ */ DELETE FROM t -- old rows\nWHERE id = 1");
    assert!(query
        .sql
        .ends_with("WHERE (\"id\" OPERATOR(pg_catalog.=) 1) LIMIT 101"));
}

#[test]
fn only_one_update_or_delete_is_accepted() {
    assert_eq!(rejection(""), Rejection::Empty);
    assert_eq!(rejection(" ; -- nothing"), Rejection::Empty);
    assert_eq!(
        rejection("DELETE FROM a; DELETE FROM b"),
        Rejection::MultipleStatements
    );
    assert_eq!(rejection("SELECT 1"), Rejection::NotUpdateOrDelete);
    assert_eq!(rejection("TRUNCATE t"), Rejection::NotUpdateOrDelete);
    assert_eq!(
        rejection("INSERT INTO t VALUES (1)"),
        Rejection::Unsupported("INSERT")
    );
}

#[test]
fn unsupported_clauses_are_named() {
    let cases = [
        (
            "UPDATE t SET a = 1 FROM u WHERE t.id = u.id",
            "UPDATE ... FROM (joins)",
        ),
        (
            "DELETE FROM t USING u WHERE t.id = u.id",
            "DELETE ... USING (joins)",
        ),
        ("UPDATE t SET a = 1 RETURNING *", "RETURNING"),
        ("DELETE FROM t WHERE id = 1 RETURNING id", "RETURNING"),
        (
            "WITH x AS (SELECT 1) DELETE FROM t",
            "WITH (common table expressions)",
        ),
        ("DELETE FROM t WHERE id IN (SELECT id FROM u)", "subqueries"),
        ("UPDATE t SET a = (SELECT 1)", "subqueries"),
        ("DELETE FROM t WHERE EXISTS (SELECT 1)", "subqueries"),
        ("UPDATE ONLY t SET a = 1", "ONLY"),
        ("UPDATE t SET (a, b) = (1, 2)", "multi-column assignments"),
        ("UPDATE t SET a = DEFAULT", "SET ... = DEFAULT"),
        ("DELETE FROM t WHERE CURRENT OF c", "WHERE CURRENT OF"),
        ("DELETE FROM db.s.t", "database-qualified table names"),
        (
            "UPDATE t SET a = CASE WHEN b THEN 1 END",
            "CASE expressions",
        ),
        ("DELETE FROM t WHERE id = $1", "bind parameters ($1)"),
        (
            "DELETE FROM t WHERE id = :id",
            "unbound editor parameters (:name)",
        ),
        ("UPDATE t SET a = $$x$$", "dollar-quoted strings"),
        (
            "UPDATE t SET a = E'x\\n'",
            "prefixed string literals (E'', B'', X'')",
        ),
        ("UPDATE t SET a = 'x\\'", "backslashes in string literals"),
        (
            "DELETE FROM t WHERE a @> b",
            "operators outside the allowlist",
        ),
        (
            "DELETE FROM t WHERE a ~ 'x'",
            "operators outside the allowlist",
        ),
        (
            "DELETE FROM t WHERE a IS DISTINCT FROM b",
            "IS DISTINCT FROM",
        ),
        ("DELETE FROM t WHERE a = ANY (b)", "ANY / SOME / ALL"),
        ("UPDATE t SET a = b[1]", "array subscripts"),
        (
            "UPDATE t SET a = b::text",
            "casts of anything but a literal (a column's type may define its own cast function)",
        ),
        ("DELETE FROM t ORDER BY id", "ORDER BY / LIMIT"),
    ];
    for (sql, reason) in cases {
        assert_eq!(rejection(sql), Rejection::Unsupported(reason), "{sql}");
    }
}

#[test]
fn functions_outside_the_allowlist_are_rejected() {
    for (sql, name) in [
        ("UPDATE t SET id = nextval('t_id_seq')", "nextval"),
        ("UPDATE t SET a = setval('s', 1)", "setval"),
        ("UPDATE t SET a = my_audit(a)", "my_audit"),
        ("UPDATE t SET a = public.lower(a)", "public.lower"),
        ("UPDATE t SET a = \"lower\"(a)", "lower"),
        ("UPDATE t SET a = random()", "random"),
        ("UPDATE t SET touched = now()", "now"),
        (
            "UPDATE t SET touched = current_timestamp",
            "current_timestamp",
        ),
        ("DELETE FROM t WHERE a = nullif(b, 1)", "nullif"),
        ("DELETE FROM t WHERE pg_sleep(1) IS NULL", "pg_sleep"),
    ] {
        assert_eq!(rejection(sql), Rejection::Function(name.into()), "{sql}");
    }
}

#[test]
fn casts_outside_the_allowlist_are_rejected() {
    assert_eq!(
        rejection("UPDATE t SET a = 'x'::mood"),
        Rejection::CastType("mood".into())
    );
    assert_eq!(
        rejection("UPDATE t SET a = 'x'::public.mood"),
        Rejection::CastType("public.mood".into())
    );
    assert_eq!(
        rejection("UPDATE t SET a = CAST('1' AS regclass)"),
        Rejection::CastType("regclass".into())
    );
    assert_eq!(
        rejection("UPDATE t SET a = '1'::int(4)"),
        Rejection::CastType("int(...)".into())
    );
}

#[test]
fn columns_of_other_relations_are_rejected() {
    assert_eq!(
        rejection("UPDATE orders o SET a = 1 WHERE orders.id = 1"),
        Rejection::ForeignQualifier("orders.id".into())
    );
    assert_eq!(
        rejection("DELETE FROM orders WHERE other.id = 1"),
        Rejection::ForeignQualifier("other.id".into())
    );
}

#[test]
fn malformed_text_is_a_syntax_error() {
    for sql in [
        "UPDATE t SET",
        "UPDATE t SET a = ",
        "UPDATE t SET a = 'open",
        "DELETE FROM t WHERE (a = 1",
        "DELETE FROM t WHERE a = 1 = 2",
        "DELETE t",
        "UPDATE t SET a == 1",
        "DELETE FROM t /* open",
    ] {
        assert!(
            matches!(
                parse(sql),
                Err(Rejection::Syntax(_)) | Err(Rejection::Unsupported(_))
            ),
            "{sql}: {:?}",
            parse(sql)
        );
    }
}

#[test]
fn a_negative_number_after_an_operator_still_lexes() {
    assert!(preview("UPDATE t SET a = -1 WHERE b=-2")
        .sql
        .contains("(\"b\" OPERATOR(pg_catalog.=) (OPERATOR(pg_catalog.-) 2))"));
}
