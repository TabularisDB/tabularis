//! MySQL-dialect SQL builders and grant parsing for server account
//! management.
//!
//! Pure string builders; the async functions in `mod.rs` delegate here so
//! the generation logic stays unit-testable without a live server. Account
//! names, hosts and passwords are embedded as escaped string literals —
//! account-management statements cannot use bind parameters.

use super::helpers::{escape_identifier, mysql_string_literal};
use crate::models::DbUserGrantSet;

/// Privileges the UI may grant or revoke at the table (`db.table`) level.
const TABLE_PRIVILEGES: &[&str] = &[
    "ALL PRIVILEGES",
    "ALTER",
    "CREATE",
    "CREATE VIEW",
    "DELETE",
    "DROP",
    "GRANT OPTION",
    "INDEX",
    "INSERT",
    "REFERENCES",
    "SELECT",
    "SHOW VIEW",
    "TRIGGER",
    "UPDATE",
];

/// Additional privileges that exist at the database (`db.*`) level and above.
const DB_ONLY_PRIVILEGES: &[&str] = &[
    "ALTER ROUTINE",
    "CREATE ROUTINE",
    "CREATE TEMPORARY TABLES",
    "EVENT",
    "EXECUTE",
    "LOCK TABLES",
];

/// Additional privileges that only exist at the global (`*.*`) level.
const GLOBAL_ONLY_PRIVILEGES: &[&str] = &[
    "CREATE USER",
    "FILE",
    "PROCESS",
    "RELOAD",
    "REPLICATION CLIENT",
    "REPLICATION SLAVE",
    "SHOW DATABASES",
    "SHUTDOWN",
    "SUPER",
];

/// The scope a GRANT/REVOKE statement targets.
#[derive(Clone, Copy, PartialEq)]
pub(super) enum Scope {
    Global,
    Database,
    Table,
}

/// The catalog sent to the frontend privilege editor. Single source of
/// truth with the validation in [`canonical_privilege`].
pub(super) fn privilege_catalog() -> crate::models::DbPrivilegeCatalog {
    let to_vec = |s: &[&str]| s.iter().map(|p| p.to_string()).collect::<Vec<_>>();
    let mut database = to_vec(TABLE_PRIVILEGES);
    database.extend(to_vec(DB_ONLY_PRIVILEGES));
    database.sort();
    crate::models::DbPrivilegeCatalog {
        database,
        global: to_vec(GLOBAL_ONLY_PRIVILEGES),
        table: to_vec(TABLE_PRIVILEGES),
    }
}

/// Renders `'user'@'host'`, escaping both parts as string literals.
fn account(user: &str, host: &str, no_backslash_escapes: bool) -> String {
    format!(
        "{}@{}",
        mysql_string_literal(user, no_backslash_escapes),
        mysql_string_literal(host, no_backslash_escapes)
    )
}

fn validate_account(user: &str, host: &str) -> Result<(), String> {
    if user.trim().is_empty() {
        return Err("User name cannot be empty".to_string());
    }
    if host.trim().is_empty() {
        return Err("Host cannot be empty".to_string());
    }
    Ok(())
}

/// Validates one privilege keyword against the allowlist for the given scope
/// and returns its canonical (uppercased) form. Rejecting unknown keywords
/// keeps arbitrary SQL out of GRANT/REVOKE statements, where privilege names
/// cannot be quoted.
fn canonical_privilege(privilege: &str, scope: Scope) -> Result<String, String> {
    let canon = privilege.trim().to_uppercase();
    let p = canon.as_str();
    let allowed = match scope {
        Scope::Table => TABLE_PRIVILEGES.contains(&p),
        Scope::Database => TABLE_PRIVILEGES.contains(&p) || DB_ONLY_PRIVILEGES.contains(&p),
        Scope::Global => {
            TABLE_PRIVILEGES.contains(&p)
                || DB_ONLY_PRIVILEGES.contains(&p)
                || GLOBAL_ONLY_PRIVILEGES.contains(&p)
        }
    };
    if allowed {
        Ok(canon)
    } else {
        Err(format!("Unsupported privilege: {privilege}"))
    }
}

pub(super) fn create_user_sql(
    user: &str,
    host: &str,
    password: &str,
    no_backslash_escapes: bool,
) -> Result<String, String> {
    validate_account(user, host)?;
    Ok(format!(
        "CREATE USER {} IDENTIFIED BY {}",
        account(user, host, no_backslash_escapes),
        mysql_string_literal(password, no_backslash_escapes)
    ))
}

pub(super) fn drop_user_sql(
    user: &str,
    host: &str,
    no_backslash_escapes: bool,
) -> Result<String, String> {
    validate_account(user, host)?;
    Ok(format!(
        "DROP USER {}",
        account(user, host, no_backslash_escapes)
    ))
}

pub(super) fn set_password_sql(
    user: &str,
    host: &str,
    password: &str,
    no_backslash_escapes: bool,
) -> Result<String, String> {
    validate_account(user, host)?;
    Ok(format!(
        "ALTER USER {} IDENTIFIED BY {}",
        account(user, host, no_backslash_escapes),
        mysql_string_literal(password, no_backslash_escapes)
    ))
}

pub(super) fn show_grants_sql(
    user: &str,
    host: &str,
    no_backslash_escapes: bool,
) -> Result<String, String> {
    validate_account(user, host)?;
    Ok(format!(
        "SHOW GRANTS FOR {}",
        account(user, host, no_backslash_escapes)
    ))
}

/// Renders the `ON` target and resolves the scope for a database/table pair.
fn grant_target(database: Option<&str>, table: Option<&str>) -> Result<(String, Scope), String> {
    match (database, table) {
        (None, None) => Ok(("*.*".to_string(), Scope::Global)),
        (Some(db), None) => Ok((format!("`{}`.*", escape_identifier(db)), Scope::Database)),
        (Some(db), Some(tbl)) => Ok((
            format!("`{}`.`{}`", escape_identifier(db), escape_identifier(tbl)),
            Scope::Table,
        )),
        (None, Some(_)) => Err("A table scope requires a database".to_string()),
    }
}

/// Builds a `GRANT`/`REVOKE` statement for the given privileges, scoped
/// globally (`*.*`), to one database (`db.*`) or to one table (`db.table`).
///
/// `GRANT OPTION` is special-cased: when granting it moves to the
/// `WITH GRANT OPTION` clause (with `USAGE` filling an otherwise-empty
/// privilege list); when revoking it is a regular list entry.
pub(super) fn apply_privileges_sql(
    user: &str,
    host: &str,
    database: Option<&str>,
    table: Option<&str>,
    privileges: &[String],
    grant: bool,
    no_backslash_escapes: bool,
) -> Result<String, String> {
    validate_account(user, host)?;
    if privileges.is_empty() {
        return Err("No privileges selected".to_string());
    }
    let (target, scope) = grant_target(database, table)?;
    let mut list = Vec::with_capacity(privileges.len());
    let mut with_grant_option = false;
    for p in privileges {
        let canon = canonical_privilege(p, scope)?;
        if grant && canon == "GRANT OPTION" {
            with_grant_option = true;
        } else if !list.contains(&canon) {
            list.push(canon);
        }
    }
    if list.is_empty() {
        // Only GRANT OPTION was selected: GRANT needs a privilege list.
        list.push("USAGE".to_string());
    }

    let acct = account(user, host, no_backslash_escapes);
    let list = list.join(", ");

    Ok(if grant {
        let suffix = if with_grant_option {
            " WITH GRANT OPTION"
        } else {
            ""
        };
        format!("GRANT {list} ON {target} TO {acct}{suffix}")
    } else {
        format!("REVOKE {list} ON {target} FROM {acct}")
    })
}

// ---------- SHOW GRANTS parsing ----------

/// Strips one backtick-quoted identifier (or a bare one) from the start of
/// `s`, returning `(identifier, rest)`. Doubled backticks are unescaped.
fn take_identifier(s: &str) -> Option<(String, &str)> {
    if let Some(rest) = s.strip_prefix('`') {
        let mut out = String::new();
        let mut chars = rest.char_indices();
        while let Some((i, c)) = chars.next() {
            if c == '`' {
                if rest[i + 1..].starts_with('`') {
                    out.push('`');
                    chars.next();
                } else {
                    return Some((out, &rest[i + 1..]));
                }
            } else {
                out.push(c);
            }
        }
        None // unterminated quote
    } else {
        let end = s.find(['.', ' ']).unwrap_or(s.len());
        if end == 0 {
            None
        } else {
            Some((s[..end].to_string(), &s[end..]))
        }
    }
}

/// Parses the `ON` target of a grant line: `*.*`, `` `db`.* `` or
/// `` `db`.`table` `` (bare identifiers accepted too). Returns
/// `(database, table)`, both `None` for the global scope.
fn parse_target(target: &str) -> Option<(Option<String>, Option<String>)> {
    let target = target.trim();
    if target == "*.*" {
        return Some((None, None));
    }
    let (db, rest) = take_identifier(target)?;
    let rest = rest.strip_prefix('.')?;
    if rest == "*" {
        Some((Some(db), None))
    } else {
        let (table, rest) = take_identifier(rest)?;
        rest.is_empty().then_some((Some(db), Some(table)))
    }
}

/// Parses one `SHOW GRANTS` line into a structured grant set. Returns `None`
/// for lines the checkbox editor does not model (PROXY grants, MySQL 8 roles,
/// column-level privileges, or `USAGE`-only lines that carry no privilege).
pub(super) fn parse_grant_line(line: &str) -> Option<DbUserGrantSet> {
    let rest = line.trim().strip_prefix("GRANT ")?;
    // ` ON ` cannot appear inside a privilege keyword; column-level grants
    // (`SELECT (col)`) are skipped below via the allowlist check.
    let on_pos = rest.find(" ON ")?;
    let (priv_part, after_on) = (&rest[..on_pos], &rest[on_pos + 4..]);
    let to_pos = after_on.find(" TO ")?;
    let (target_part, tail) = (&after_on[..to_pos], &after_on[to_pos..]);

    let (database, table) = parse_target(target_part)?;
    let scope = match (&database, &table) {
        (None, _) => Scope::Global,
        (Some(_), None) => Scope::Database,
        (Some(_), Some(_)) => Scope::Table,
    };

    let mut privileges: Vec<String> = Vec::new();
    for p in priv_part.split(',') {
        let p = p.trim();
        if p.eq_ignore_ascii_case("USAGE") {
            continue;
        }
        // Unknown keywords (PROXY, role names, column-level grants) make the
        // whole line unrepresentable in the editor: show it raw only.
        let canon = canonical_privilege(p, scope).ok()?;
        if !privileges.contains(&canon) {
            privileges.push(canon);
        }
    }
    if tail.to_uppercase().contains("WITH GRANT OPTION") {
        privileges.push("GRANT OPTION".to_string());
    }
    if privileges.is_empty() {
        return None;
    }
    Some(DbUserGrantSet {
        database,
        table,
        privileges,
    })
}

/// Parses all `SHOW GRANTS` lines, merging duplicate scopes (a server can
/// emit several lines for the same target).
pub(super) fn parse_grants(lines: &[String]) -> Vec<DbUserGrantSet> {
    let mut sets: Vec<DbUserGrantSet> = Vec::new();
    for line in lines {
        let Some(parsed) = parse_grant_line(line) else {
            continue;
        };
        if let Some(existing) = sets
            .iter_mut()
            .find(|s| s.database == parsed.database && s.table == parsed.table)
        {
            for p in parsed.privileges {
                if !existing.privileges.contains(&p) {
                    existing.privileges.push(p);
                }
            }
        } else {
            sets.push(parsed);
        }
    }
    sets
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_literals_are_escaped() {
        let sql = create_user_sql("o'brien", "%", "p'wd\\x", false).unwrap();
        assert_eq!(
            sql,
            "CREATE USER 'o\\'brien'@'%' IDENTIFIED BY 'p\\'wd\\\\x'"
        );
        // NO_BACKSLASH_ESCAPES mode doubles quotes instead.
        let sql = create_user_sql("o'brien", "%", "pwd", true).unwrap();
        assert_eq!(sql, "CREATE USER 'o''brien'@'%' IDENTIFIED BY 'pwd'");
    }

    #[test]
    fn empty_user_or_host_is_rejected() {
        assert!(create_user_sql("", "%", "pwd", false).is_err());
        assert!(drop_user_sql("bob", " ", false).is_err());
    }

    #[test]
    fn drop_password_and_grants_sql() {
        assert_eq!(
            drop_user_sql("bob", "%", false).unwrap(),
            "DROP USER 'bob'@'%'"
        );
        assert_eq!(
            set_password_sql("bob", "localhost", "s3cret", false).unwrap(),
            "ALTER USER 'bob'@'localhost' IDENTIFIED BY 's3cret'"
        );
        assert_eq!(
            show_grants_sql("bob", "%", false).unwrap(),
            "SHOW GRANTS FOR 'bob'@'%'"
        );
    }

    #[test]
    fn grant_on_database_quotes_and_canonicalizes() {
        let sql = apply_privileges_sql(
            "bob",
            "%",
            Some("my`db"),
            None,
            &["select".to_string(), "Insert".to_string()],
            true,
            false,
        )
        .unwrap();
        assert_eq!(sql, "GRANT SELECT, INSERT ON `my``db`.* TO 'bob'@'%'");
    }

    #[test]
    fn grant_on_table_scope() {
        let sql = apply_privileges_sql(
            "bob",
            "%",
            Some("shop"),
            Some("orders"),
            &["SELECT".to_string(), "UPDATE".to_string()],
            true,
            false,
        )
        .unwrap();
        assert_eq!(sql, "GRANT SELECT, UPDATE ON `shop`.`orders` TO 'bob'@'%'");
        // DB-only privilege is invalid at table scope.
        assert!(apply_privileges_sql(
            "bob",
            "%",
            Some("shop"),
            Some("orders"),
            &["EVENT".to_string()],
            true,
            false,
        )
        .is_err());
        // Table without database is invalid.
        assert!(apply_privileges_sql(
            "bob",
            "%",
            None,
            Some("orders"),
            &["SELECT".to_string()],
            true,
            false,
        )
        .is_err());
    }

    #[test]
    fn grant_option_moves_to_with_clause_on_grant() {
        let sql = apply_privileges_sql(
            "bob",
            "%",
            None,
            None,
            &["GRANT OPTION".to_string()],
            true,
            false,
        )
        .unwrap();
        assert_eq!(sql, "GRANT USAGE ON *.* TO 'bob'@'%' WITH GRANT OPTION");

        let sql = apply_privileges_sql(
            "bob",
            "%",
            None,
            None,
            &["SELECT".to_string(), "GRANT OPTION".to_string()],
            false,
            false,
        )
        .unwrap();
        assert_eq!(sql, "REVOKE SELECT, GRANT OPTION ON *.* FROM 'bob'@'%'");
    }

    #[test]
    fn unknown_or_out_of_scope_privileges_are_rejected() {
        // Injection attempt.
        assert!(apply_privileges_sql(
            "bob",
            "%",
            None,
            None,
            &["SELECT ON *.* TO 'evil'@'%'; DROP TABLE x".to_string()],
            true,
            false,
        )
        .is_err());
        // Global-only privilege at database scope.
        assert!(apply_privileges_sql(
            "bob",
            "%",
            Some("db"),
            None,
            &["SUPER".to_string()],
            true,
            false,
        )
        .is_err());
        // But fine globally.
        assert!(apply_privileges_sql(
            "bob",
            "%",
            None,
            None,
            &["SUPER".to_string()],
            true,
            false
        )
        .is_ok());
        // Empty selection.
        assert!(apply_privileges_sql("bob", "%", None, None, &[], true, false).is_err());
    }

    #[test]
    fn parses_global_database_and_table_grants() {
        let lines = vec![
            "GRANT SELECT, INSERT ON *.* TO `bob`@`%` WITH GRANT OPTION".to_string(),
            "GRANT ALL PRIVILEGES ON `shop`.* TO `bob`@`%`".to_string(),
            "GRANT SELECT, UPDATE ON `shop`.`orders` TO `bob`@`%`".to_string(),
        ];
        let sets = parse_grants(&lines);
        assert_eq!(
            sets,
            vec![
                DbUserGrantSet {
                    database: None,
                    table: None,
                    privileges: vec![
                        "SELECT".to_string(),
                        "INSERT".to_string(),
                        "GRANT OPTION".to_string()
                    ],
                },
                DbUserGrantSet {
                    database: Some("shop".to_string()),
                    table: None,
                    privileges: vec!["ALL PRIVILEGES".to_string()],
                },
                DbUserGrantSet {
                    database: Some("shop".to_string()),
                    table: Some("orders".to_string()),
                    privileges: vec!["SELECT".to_string(), "UPDATE".to_string()],
                },
            ]
        );
    }

    #[test]
    fn usage_only_proxy_and_unquoted_lines() {
        // USAGE-only line (every account has one) carries no privilege.
        assert_eq!(
            parse_grant_line("GRANT USAGE ON *.* TO 'bob'@'%'"),
            None
        );
        // MariaDB PROXY grants are not representable in the editor.
        assert_eq!(
            parse_grant_line("GRANT PROXY ON ''@'%' TO 'root'@'localhost' WITH GRANT OPTION"),
            None
        );
        // Old servers may emit unquoted identifiers.
        assert_eq!(
            parse_grant_line("GRANT SELECT ON shop.* TO 'bob'@'%'"),
            Some(DbUserGrantSet {
                database: Some("shop".to_string()),
                table: None,
                privileges: vec!["SELECT".to_string()],
            })
        );
        // Escaped backtick in the database name.
        assert_eq!(
            parse_grant_line("GRANT SELECT ON `my``db`.* TO 'bob'@'%'"),
            Some(DbUserGrantSet {
                database: Some("my`db".to_string()),
                table: None,
                privileges: vec!["SELECT".to_string()],
            })
        );
        // Duplicate scopes merge.
        let sets = parse_grants(&[
            "GRANT SELECT ON `shop`.* TO 'bob'@'%'".to_string(),
            "GRANT INSERT ON `shop`.* TO 'bob'@'%'".to_string(),
        ]);
        assert_eq!(sets.len(), 1);
        assert_eq!(sets[0].privileges, vec!["SELECT", "INSERT"]);
    }
}
