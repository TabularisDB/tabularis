//! SQL formatting for database dump files, driven by the driver's declared
//! capabilities (`identifier_quote`, `schemas`, `sql_dialect`, `sql_syntax`)
//! rather than its id, so a plugin driver gets statements its engine can read
//! back.

use crate::drivers::driver_trait::{DriverCapabilities, SqlDialect};
use crate::drivers::sql_syntax::{quote_string_literal, BooleanLiterals, LiteralStyle, SqlSyntax};

#[cfg(test)]
mod tests;

/// How a dump writes identifiers and literals for one driver.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DumpDialect {
    /// Identifier quote from the `identifier_quote` capability (`"` if empty).
    pub identifier_quote: String,
    /// Table references are schema-qualified (`schemas` capability).
    pub schema_qualified: bool,
    /// PostgreSQL-flavoured: a missing schema defaults to `public`.
    pub postgres: bool,
    /// How string literals are escaped: the driver's resolved syntax
    /// (`sql_syntax.string_escape`, else the `sql_dialect` preset).
    pub string_escape: LiteralStyle,
    /// Booleans are written as `TRUE`/`FALSE` rather than `1`/`0`: the
    /// declared `sql_syntax.boolean_literals`, else PostgreSQL only.
    pub boolean_keywords: bool,
}

impl DumpDialect {
    /// Builds the dump dialect for a driver from its manifest capabilities.
    ///
    /// `driver_id` is only consulted to keep the historical Postgres handling
    /// for the builtin `postgres` driver and the `postgresql` plugin when a
    /// manifest predates `sql_dialect`; every other decision comes from the
    /// capabilities.
    pub fn from_capabilities(driver_id: &str, caps: &DriverCapabilities) -> Self {
        let postgres = caps.sql_dialect == Some(SqlDialect::Postgres)
            || matches!(driver_id, "postgres" | "postgresql");
        let identifier_quote = if caps.identifier_quote.is_empty() {
            "\"".to_string()
        } else {
            caps.identifier_quote.clone()
        };
        let syntax = SqlSyntax::resolve(caps);
        // A declared `boolean_literals` wins (GoogleSQL has no implicit
        // INT64 -> BOOL coercion, so it declares keywords). Otherwise only
        // PostgreSQL needs TRUE/FALSE (it rejects 1/0 with SQLSTATE 42804).
        // Every other engine, including plugins with no or a generic
        // dialect, keeps the 1/0 the dump has always written, since an engine
        // we have not verified may not accept the keywords.
        let boolean_keywords = match syntax.boolean_literals {
            Some(style) => style == BooleanLiterals::Keywords,
            None => postgres,
        };
        Self {
            identifier_quote,
            schema_qualified: caps.schemas,
            postgres,
            string_escape: syntax.string_escape,
            boolean_keywords,
        }
    }

    /// The schema a dump of this driver works in: the requested one, else
    /// `public` on PostgreSQL, else none (the driver's own default).
    pub fn resolve_schema(&self, requested: Option<&str>) -> Option<String> {
        match requested.filter(|s| !s.is_empty()) {
            Some(s) => Some(s.to_string()),
            None if self.postgres => Some("public".to_string()),
            None => None,
        }
    }

    /// The schema to pass to driver calls (`get_tables`, `get_table_ddl`,
    /// `execute_query`). Drivers without schemas get `None`: their schema
    /// argument may mean something else (e.g. a database selector), so a
    /// stray value could retarget the call.
    pub fn scoped_schema<'a>(&self, schema: Option<&'a str>) -> Option<&'a str> {
        if self.schema_qualified || self.postgres {
            schema
        } else {
            None
        }
    }

    /// Quotes one identifier, doubling any embedded quote character.
    pub fn quote_identifier(&self, name: &str) -> String {
        let q = &self.identifier_quote;
        format!("{q}{}{q}", name.replace(q.as_str(), &q.repeat(2)))
    }

    /// A quoted table reference, schema-qualified when the driver has
    /// schemas (or is PostgreSQL-flavoured) and a schema is known:
    /// `"public"."users"`, `` `users` ``, `` `dataset`.`events` ``.
    pub fn table_ref(&self, schema: Option<&str>, table: &str) -> String {
        let qualify = self.schema_qualified || self.postgres;
        match schema.filter(|s| qualify && !s.is_empty()) {
            Some(schema) => format!(
                "{}.{}",
                self.quote_identifier(schema),
                self.quote_identifier(table)
            ),
            None => self.quote_identifier(table),
        }
    }

    /// `DROP TABLE IF EXISTS <table>;`
    pub fn drop_table_if_exists(&self, schema: Option<&str>, table: &str) -> String {
        format!("DROP TABLE IF EXISTS {};", self.table_ref(schema, table))
    }

    /// `INSERT INTO <table> VALUES <values>;`
    pub fn insert_into_statement(&self, schema: Option<&str>, table: &str, values: &str) -> String {
        format!(
            "INSERT INTO {} VALUES {};",
            self.table_ref(schema, table),
            values
        )
    }

    /// Quotes `s` as a string literal.
    ///
    /// MySQL treats backslashes inside string literals as escape sequences
    /// (unless `NO_BACKSLASH_ESCAPES` is set), so a literal backslash must be
    /// doubled and a NUL byte written as `\0` — otherwise a `中` escape
    /// inside JSON silently re-imports as `u4e2d` and `\"` breaks the JSON
    /// altogether. PostgreSQL (with the default
    /// `standard_conforming_strings = on`) and SQLite take backslashes
    /// literally, so doubling them there would corrupt the data instead; only
    /// the single quote needs escaping. A driver declaring
    /// `string_escape: "backslash"` (GoogleSQL) has no doubled-quote escape,
    /// so quote, backslash, NUL and line breaks are backslash-escaped.
    pub fn escape_string(&self, s: &str) -> String {
        quote_string_literal(s, self.string_escape)
    }

    /// Formats a value from a non-JSON column as a SQL literal.
    pub fn escape_value(&self, val: serde_json::Value) -> String {
        match val {
            serde_json::Value::Null => "NULL".to_string(),
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::Bool(b) => {
                let style = if self.boolean_keywords {
                    BooleanLiterals::Keywords
                } else {
                    BooleanLiterals::Numeric
                };
                style.literal(b).to_string()
            }
            serde_json::Value::String(s) => self.escape_string(&s),
            // Arrays/objects only reach here from non-JSON columns (e.g.
            // hstore); serialize them and escape the text like any string.
            other => self.escape_string(&other.to_string()),
        }
    }

    /// Formats a value read from a JSON-typed column (`JSON` on MySQL,
    /// `json`/`jsonb` on PostgreSQL).
    ///
    /// Such columns are extracted as parsed `serde_json::Value`s, so they must
    /// be written back as JSON *literals*: a JSON string keeps its surrounding
    /// quotes (`"\"[1, 2]\""`, not `[1, 2]`), booleans stay `true`/`false`,
    /// and the resulting text is escaped like any other string literal. SQL
    /// `NULL` and a JSON `null` are indistinguishable at this point; both are
    /// written as `NULL`.
    pub fn escape_json_value(&self, val: serde_json::Value) -> String {
        match val {
            serde_json::Value::Null => "NULL".to_string(),
            other => self.escape_string(&other.to_string()),
        }
    }
}
