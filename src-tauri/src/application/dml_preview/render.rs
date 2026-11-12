//! Builds the preview `SELECT` from a parsed statement.
//!
//! Every operator is written as `OPERATOR(pg_catalog.op)` and every function
//! as `pg_catalog.fn`, so resolution cannot reach a user-defined operator or
//! function, whatever the search path or the column types are. A column type
//! without a matching built-in operator makes the preview fail instead.

use super::statement::{BinaryOp, Expr, Rejection, Statement, Target};

/// Labels added to each assigned column in an `UPDATE` preview.
pub const CURRENT_SUFFIX: &str = " (current)";
pub const PROPOSED_SUFFIX: &str = " (proposed)";

/// The `SELECT` that shows the rows a statement targets, plus how its
/// leading columns pair up for an `UPDATE`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviewQuery {
    pub sql: String,
    /// Assigned column names, in `SET` order. Result columns `2i` and
    /// `2i + 1` hold the current and proposed value of column `i`.
    pub assigned_columns: Vec<String>,
    /// False when the statement has no `WHERE` and targets every row.
    pub has_filter: bool,
}

/// `limit` rows are shown; one more is fetched to detect truncation.
pub fn build(statement: &Statement, limit: u32) -> Result<PreviewQuery, Rejection> {
    let target = statement.target();
    let mut sql = String::from("SELECT ");
    let mut assigned_columns = Vec::new();
    let filter = match statement {
        Statement::Update {
            assignments,
            filter,
            ..
        } => {
            for assignment in assignments {
                let name = &assignment.column.0;
                sql.push_str(&quote(name));
                sql.push_str(" AS ");
                sql.push_str(&quote(&format!("{name}{CURRENT_SUFFIX}")));
                sql.push_str(", ");
                sql.push_str(&expr(&assignment.value, target)?);
                sql.push_str(" AS ");
                sql.push_str(&quote(&format!("{name}{PROPOSED_SUFFIX}")));
                sql.push_str(", ");
                assigned_columns.push(name.clone());
            }
            filter
        }
        Statement::Delete { filter, .. } => filter,
    };
    let range = target.alias.as_ref().unwrap_or(&target.table);
    sql.push_str(&quote(&range.0));
    sql.push_str(".* FROM ");
    if let Some(schema) = &target.schema {
        sql.push_str(&quote(&schema.0));
        sql.push('.');
    }
    sql.push_str(&quote(&target.table.0));
    if let Some(alias) = &target.alias {
        sql.push_str(" AS ");
        sql.push_str(&quote(&alias.0));
    }
    if let Some(filter) = filter {
        sql.push_str(" WHERE ");
        sql.push_str(&expr(filter, target)?);
    }
    sql.push_str(&format!(" LIMIT {}", u64::from(limit) + 1));
    Ok(PreviewQuery {
        sql,
        assigned_columns,
        has_filter: filter.is_some(),
    })
}

pub fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn op(symbol: &str) -> String {
    format!(" OPERATOR(pg_catalog.{symbol}) ")
}

fn expr(e: &Expr, target: &Target) -> Result<String, Rejection> {
    Ok(match e {
        Expr::Column { qualifier, name } => match qualifier {
            None => quote(&name.0),
            Some(q) => {
                let own = target.alias.as_ref().unwrap_or(&target.table);
                if q != own {
                    return Err(Rejection::ForeignQualifier(format!("{}.{}", q.0, name.0)));
                }
                format!("{}.{}", quote(&q.0), quote(&name.0))
            }
        },
        Expr::Number(n) => n.clone(),
        Expr::String(s) => format!("'{}'", s.replace('\'', "''")),
        Expr::Bool(true) => "TRUE".into(),
        Expr::Bool(false) => "FALSE".into(),
        Expr::Null => "NULL".into(),
        Expr::Negate(inner) => format!("(OPERATOR(pg_catalog.-) {})", expr(inner, target)?),
        Expr::Not(inner) => format!("(NOT {})", expr(inner, target)?),
        Expr::Binary { op: o, left, right } => {
            let l = expr(left, target)?;
            let r = expr(right, target)?;
            let joiner = match o {
                BinaryOp::Or => " OR ".to_string(),
                BinaryOp::And => " AND ".to_string(),
                BinaryOp::Eq => op("="),
                BinaryOp::NotEq => op("<>"),
                BinaryOp::Lt => op("<"),
                BinaryOp::LtEq => op("<="),
                BinaryOp::Gt => op(">"),
                BinaryOp::GtEq => op(">="),
                BinaryOp::Plus => op("+"),
                BinaryOp::Minus => op("-"),
                BinaryOp::Multiply => op("*"),
                BinaryOp::Divide => op("/"),
                BinaryOp::Modulo => op("%"),
                BinaryOp::Concat => op("||"),
            };
            format!("({l}{joiner}{r})")
        }
        Expr::IsNull {
            expr: inner,
            negated,
        } => format!(
            "({} IS {}NULL)",
            expr(inner, target)?,
            if *negated { "NOT " } else { "" }
        ),
        Expr::IsBool {
            expr: inner,
            value,
            negated,
        } => format!(
            "({} IS {}{})",
            expr(inner, target)?,
            if *negated { "NOT " } else { "" },
            if *value { "TRUE" } else { "FALSE" }
        ),
        // `x IN (a, b)` is defined as `x = a OR x = b`, NULL handling included.
        Expr::InList {
            expr: inner,
            list,
            negated,
        } => {
            let left = expr(inner, target)?;
            let mut parts = Vec::with_capacity(list.len());
            for item in list {
                parts.push(format!("({left}{}{})", op("="), expr(item, target)?));
            }
            let any = format!("({})", parts.join(" OR "));
            if *negated {
                format!("(NOT {any})")
            } else {
                any
            }
        }
        // `x BETWEEN a AND b` is defined as `x >= a AND x <= b`.
        Expr::Between {
            expr: inner,
            low,
            high,
            negated,
        } => {
            let x = expr(inner, target)?;
            let range = format!(
                "(({x}{}{}) AND ({x}{}{}))",
                op(">="),
                expr(low, target)?,
                op("<="),
                expr(high, target)?
            );
            if *negated {
                format!("(NOT {range})")
            } else {
                range
            }
        }
        Expr::Like {
            expr: inner,
            pattern,
            negated,
            case_insensitive,
        } => {
            let symbol = match (negated, case_insensitive) {
                (false, false) => "~~",
                (true, false) => "!~~",
                (false, true) => "~~*",
                (true, true) => "!~~*",
            };
            format!(
                "({}{}{})",
                expr(inner, target)?,
                op(symbol),
                expr(pattern, target)?
            )
        }
        Expr::Cast { expr: inner, to } => {
            let modifiers = if to.modifiers.is_empty() {
                String::new()
            } else {
                let list: Vec<String> = to.modifiers.iter().map(u32::to_string).collect();
                format!("({})", list.join(", "))
            };
            format!(
                "CAST({} AS pg_catalog.{}{modifiers})",
                expr(inner, target)?,
                to.catalog_name
            )
        }
        Expr::Call { function, args } => format!(
            "pg_catalog.{}({})",
            function.catalog_name(),
            list(args, target)?
        ),
        Expr::Coalesce(args) => format!("COALESCE({})", list(args, target)?),
    })
}

fn list(args: &[Expr], target: &Target) -> Result<String, Rejection> {
    let mut parts = Vec::with_capacity(args.len());
    for arg in args {
        parts.push(expr(arg, target)?);
    }
    Ok(parts.join(", "))
}

/// The statement's target, quoted as written.
pub fn target_name(target: &Target) -> String {
    match &target.schema {
        Some(schema) => format!("{}.{}", quote(&schema.0), quote(&target.table.0)),
        None => quote(&target.table.0),
    }
}

/// Relation kind plus user trigger and rule counts for `target`, resolved
/// with the session's search path like the statement itself.
pub fn target_facts_query(target: &str) -> String {
    format!(
        "SELECT c.relkind::text, \
         (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger t \
          WHERE t.tgrelid OPERATOR(pg_catalog.=) c.oid AND NOT t.tgisinternal)::int8, \
         (SELECT pg_catalog.count(*) FROM pg_catalog.pg_rewrite r \
          WHERE r.ev_class OPERATOR(pg_catalog.=) c.oid)::int8 \
         FROM pg_catalog.pg_class c \
         WHERE c.oid OPERATOR(pg_catalog.=) pg_catalog.to_regclass('{}')",
        target.replace('\'', "''")
    )
}
