//! Declarative SQL syntax for driver plugins (`capabilities.sql_syntax`).
//!
//! A plugin whose engine lexes SQL differently from every built-in preset
//! declares how in its manifest: it names a preset to `extends` and overrides
//! individual rules (quotes, comments, triple-quoted strings, procedural
//! blocks, how generated string literals are escaped, ...). It is data only,
//! never code. The same descriptor is resolved by the frontend
//! (`src/utils/sqlSyntax.ts`), so the limits here mirror the ones there.
//!
//! Parsing never fails the manifest: an invalid field is logged and ignored,
//! so the plugin keeps the preset's rule for it. A manifest without
//! `sql_syntax` resolves to exactly the preset of its `sql_dialect`, which is
//! what every Rust consumer used before the descriptor existed.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

use crate::drivers::driver_trait::{DriverCapabilities, SqlDialect};

/// Most quote rules a descriptor may declare.
pub const MAX_QUOTES: usize = 8;
/// Most string prefixes a descriptor may declare.
pub const MAX_STRING_PREFIXES: usize = 8;
/// Longest string prefix, in ASCII letters.
pub const MAX_STRING_PREFIX_LEN: usize = 2;
/// Most entries in `keywords` and in `functions`.
pub const MAX_WORDS: usize = 1000;
/// Longest `keywords` / `functions` entry, in bytes.
pub const MAX_WORD_LEN: usize = 64;
/// `sql-formatter` languages a descriptor may pick for Format SQL.
pub const FORMATTER_LANGUAGES: &[&str] = &[
    "bigquery",
    "clickhouse",
    "db2",
    "db2i",
    "duckdb",
    "hive",
    "mariadb",
    "mysql",
    "n1ql",
    "plsql",
    "postgresql",
    "redshift",
    "singlestoredb",
    "snowflake",
    "spark",
    "sql",
    "sqlite",
    "tidb",
    "transactsql",
    "trino",
];

/// What a quoted run delimits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QuoteKind {
    String,
    Identifier,
}

/// How a closing quote is written inside a quoted run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QuoteEscape {
    /// Doubling the closing quote (`'it''s'`).
    #[default]
    Double,
    /// A backslash escapes the next character (`'it\'s'`); no doubling.
    Backslash,
    /// Both of the above (MySQL strings).
    Both,
    /// Neither: the first closing quote ends the run.
    None,
}

impl QuoteEscape {
    pub fn backslash(self) -> bool {
        matches!(self, QuoteEscape::Backslash | QuoteEscape::Both)
    }
}

/// One quote rule: `'…'`, `"…"`, `` `…` `` or `[…]`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuoteRule {
    pub open: String,
    pub close: String,
    pub kind: QuoteKind,
    pub escape: QuoteEscape,
}

impl QuoteRule {
    fn new(open: &str, kind: QuoteKind, escape: QuoteEscape) -> Self {
        let close = if open == "[" { "]" } else { open };
        Self {
            open: open.to_string(),
            close: close.to_string(),
            kind,
            escape,
        }
    }
}

/// How generated string literals are escaped, as declared by a plugin.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StringEscape {
    /// A quote is doubled; a backslash is plain text.
    Standard,
    /// Quote, backslash, NUL and line breaks are backslash-escaped; no doubling.
    Backslash,
}

/// The validated `capabilities.sql_syntax` object. Every field is optional;
/// `None` keeps the extended preset's rule. Serialized back to the frontend
/// as sanitized, so it only ever sees fields that passed validation.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct SqlSyntaxDescriptor {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extends: Option<SqlDialect>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quotes: Option<Vec<QuoteRule>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub triple_quoted_strings: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub string_prefixes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash_comments: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nested_block_comments: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_comment_requires_space: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub script_blocks: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dollar_quoting: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub string_escape: Option<StringEscape>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub like_escape: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formatter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keywords: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub functions: Option<Vec<String>>,
}

impl SqlSyntaxDescriptor {
    /// Parses a manifest's `sql_syntax` value. Returns `None` (with a warning)
    /// when it is not an object; an invalid field is warned about and left
    /// unset. Unknown fields are ignored, so newer descriptors still load.
    pub fn from_value(value: &Value) -> Option<Self> {
        let Value::Object(map) = value else {
            log::warn!("Ignoring sql_syntax in plugin manifest: expected an object");
            return None;
        };
        Some(Self {
            extends: field(map, "extends", parse_extends),
            quotes: field(map, "quotes", parse_quotes),
            triple_quoted_strings: field(map, "triple_quoted_strings", parse_bool),
            string_prefixes: field(map, "string_prefixes", parse_string_prefixes),
            hash_comments: field(map, "hash_comments", parse_bool),
            nested_block_comments: field(map, "nested_block_comments", parse_bool),
            line_comment_requires_space: field(map, "line_comment_requires_space", parse_bool),
            script_blocks: field(map, "script_blocks", parse_bool),
            dollar_quoting: field(map, "dollar_quoting", parse_bool),
            string_escape: field(map, "string_escape", parse_string_escape),
            like_escape: field(map, "like_escape", parse_bool),
            formatter: field(map, "formatter", parse_formatter),
            keywords: field(map, "keywords", parse_words),
            functions: field(map, "functions", parse_words),
        })
    }
}

/// `deserialize_with` helper for `DriverCapabilities::sql_syntax`: never
/// rejects the manifest, see [`SqlSyntaxDescriptor::from_value`].
pub fn deserialize_lenient<'de, D>(deserializer: D) -> Result<Option<SqlSyntaxDescriptor>, D::Error>
where
    D: Deserializer<'de>,
{
    let raw = Option::<Value>::deserialize(deserializer)?;
    Ok(raw.as_ref().and_then(SqlSyntaxDescriptor::from_value))
}

fn field<T>(
    map: &Map<String, Value>,
    key: &str,
    parse: fn(&Value) -> Result<T, String>,
) -> Option<T> {
    match map.get(key) {
        None | Some(Value::Null) => None,
        Some(value) => match parse(value) {
            Ok(parsed) => Some(parsed),
            Err(reason) => {
                log::warn!("Ignoring sql_syntax.{key} in plugin manifest: {reason}");
                None
            }
        },
    }
}

fn parse_bool(value: &Value) -> Result<bool, String> {
    value
        .as_bool()
        .ok_or_else(|| "expected a boolean".to_string())
}

fn parse_extends(value: &Value) -> Result<SqlDialect, String> {
    let name = value.as_str().ok_or("expected a preset name")?;
    serde_json::from_value(Value::String(name.to_string()))
        .map_err(|_| format!("unknown preset '{name}'"))
}

fn parse_string_escape(value: &Value) -> Result<StringEscape, String> {
    serde_json::from_value(value.clone())
        .map_err(|_| "expected \"standard\" or \"backslash\"".to_string())
}

fn parse_formatter(value: &Value) -> Result<String, String> {
    let name = value.as_str().ok_or("expected a string")?;
    if FORMATTER_LANGUAGES.contains(&name) {
        Ok(name.to_string())
    } else {
        Err(format!("unsupported formatter '{name}'"))
    }
}

fn parse_quotes(value: &Value) -> Result<Vec<QuoteRule>, String> {
    let items = value.as_array().ok_or("expected an array")?;
    if items.is_empty() || items.len() > MAX_QUOTES {
        return Err(format!("expected 1 to {MAX_QUOTES} quote rules"));
    }
    let mut rules: Vec<QuoteRule> = Vec::with_capacity(items.len());
    for item in items {
        let rule = parse_quote(item)?;
        if rules.iter().any(|r| r.open == rule.open) {
            return Err(format!("quote '{}' declared twice", rule.open));
        }
        rules.push(rule);
    }
    Ok(rules)
}

fn parse_quote(value: &Value) -> Result<QuoteRule, String> {
    let obj = value.as_object().ok_or("expected quote objects")?;
    let open = obj
        .get("open")
        .and_then(Value::as_str)
        .ok_or("quote without an `open` string")?;
    let expected_close = match open {
        "'" | "\"" | "`" => open,
        "[" => "]",
        _ => return Err(format!("unsupported quote '{open}'")),
    };
    let close = match obj.get("close") {
        None | Some(Value::Null) => expected_close,
        Some(close) => close
            .as_str()
            .filter(|c| *c == expected_close)
            .ok_or_else(|| format!("quote '{open}' must close with '{expected_close}'"))?,
    };
    let kind: QuoteKind = obj
        .get("kind")
        .cloned()
        .and_then(|k| serde_json::from_value(k).ok())
        .ok_or_else(|| format!("quote '{open}' needs kind \"string\" or \"identifier\""))?;
    let escape: QuoteEscape = match obj.get("escape") {
        None | Some(Value::Null) => QuoteEscape::Double,
        Some(e) => serde_json::from_value(e.clone()).map_err(|_| {
            format!("quote '{open}' escape must be double, backslash, both or none")
        })?,
    };
    Ok(QuoteRule {
        open: open.to_string(),
        close: close.to_string(),
        kind,
        escape,
    })
}

fn parse_string_prefixes(value: &Value) -> Result<Vec<String>, String> {
    let items = value.as_array().ok_or("expected an array")?;
    if items.len() > MAX_STRING_PREFIXES {
        return Err(format!("at most {MAX_STRING_PREFIXES} prefixes"));
    }
    let mut prefixes: Vec<String> = Vec::with_capacity(items.len());
    for item in items {
        let prefix = item
            .as_str()
            .filter(|p| {
                (1..=MAX_STRING_PREFIX_LEN).contains(&p.len())
                    && p.bytes().all(|b| b.is_ascii_alphabetic())
            })
            .ok_or_else(|| format!("prefixes are 1 to {MAX_STRING_PREFIX_LEN} ASCII letters"))?
            .to_ascii_lowercase();
        if !prefixes.contains(&prefix) {
            prefixes.push(prefix);
        }
    }
    Ok(prefixes)
}

/// Whether `word` is an acceptable keyword or function name: an ASCII letter
/// or `_`, then letters, digits, `_`, `$`, `.` or single inner spaces
/// (`"FOR SYSTEM_TIME AS OF"`, `"SAFE."`), at most [`MAX_WORD_LEN`] bytes.
pub fn is_valid_word(word: &str) -> bool {
    let bytes = word.as_bytes();
    if bytes.is_empty() || bytes.len() > MAX_WORD_LEN {
        return false;
    }
    if !(bytes[0].is_ascii_alphabetic() || bytes[0] == b'_') {
        return false;
    }
    if bytes[bytes.len() - 1] == b' ' || word.contains("  ") {
        return false;
    }
    bytes
        .iter()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'$' | b'.' | b' '))
}

fn parse_words(value: &Value) -> Result<Vec<String>, String> {
    let items = value.as_array().ok_or("expected an array")?;
    if items.len() > MAX_WORDS {
        return Err(format!("at most {MAX_WORDS} entries"));
    }
    let mut words: Vec<String> = Vec::with_capacity(items.len());
    for item in items {
        let word = item
            .as_str()
            .filter(|w| is_valid_word(w))
            .ok_or_else(|| format!("invalid entry {item}"))?;
        if !words.iter().any(|w| w == word) {
            words.push(word.to_string());
        }
    }
    Ok(words)
}

/// How generated string literals are escaped once resolved. `Mysql` is only
/// reachable through the `mysql` preset (a plugin declares `standard` or
/// `backslash`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LiteralStyle {
    /// `'it''s'`; a backslash is plain text.
    Standard,
    /// `'it''s'` with backslashes doubled and NUL as `\0` (MySQL default
    /// `sql_mode`, where `\` is an escape character).
    Mysql,
    /// `'it\'s'`: quote, backslash, NUL (`\0`), CR and LF are backslash-escaped.
    Backslash,
}

/// The syntax a driver's SQL follows: its preset plus any declared
/// `sql_syntax` overrides. Built with [`SqlSyntax::resolve`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SqlSyntax {
    /// The preset in force: `sql_syntax.extends`, else `sql_dialect`.
    pub dialect: Option<SqlDialect>,
    /// The driver declared `sql_syntax`.
    pub declared: bool,
    pub quotes: Vec<QuoteRule>,
    pub triple_quoted_strings: bool,
    pub string_prefixes: Vec<String>,
    pub hash_comments: bool,
    pub nested_block_comments: bool,
    pub line_comment_requires_space: bool,
    pub script_blocks: bool,
    pub dollar_quoting: bool,
    /// PostgreSQL `E'…'` escape strings (preset only).
    pub e_strings: bool,
    /// MySQL `/*! … */` executable comments (preset only).
    pub executable_comments: bool,
    /// A carriage return also ends a `--` comment (preset only).
    pub line_comment_ends_at_cr: bool,
    pub string_escape: LiteralStyle,
    pub like_escape: bool,
}

impl SqlSyntax {
    /// The built-in rules for `dialect`. `None` (a manifest that declares no
    /// dialect) lexes like PostgreSQL, the frontend splitter's default, but
    /// keeps standard literals.
    pub fn preset(dialect: Option<SqlDialect>) -> Self {
        use QuoteEscape::{Both, Double, None as NoEscape};
        use QuoteKind::{Identifier, String as Str};
        let standard_quotes = vec![
            QuoteRule::new("'", Str, Double),
            QuoteRule::new("\"", Identifier, Double),
        ];
        let base = Self {
            dialect,
            declared: false,
            quotes: standard_quotes,
            triple_quoted_strings: false,
            string_prefixes: Vec::new(),
            hash_comments: false,
            nested_block_comments: false,
            line_comment_requires_space: false,
            script_blocks: false,
            dollar_quoting: false,
            e_strings: false,
            executable_comments: false,
            line_comment_ends_at_cr: false,
            string_escape: LiteralStyle::Standard,
            like_escape: true,
        };
        match dialect.unwrap_or(SqlDialect::Postgres) {
            SqlDialect::Postgres => Self {
                dollar_quoting: true,
                e_strings: true,
                nested_block_comments: true,
                line_comment_ends_at_cr: true,
                ..base
            },
            SqlDialect::Mysql => Self {
                quotes: vec![
                    QuoteRule::new("'", Str, Both),
                    QuoteRule::new("\"", Str, Both),
                    QuoteRule::new("`", Identifier, Double),
                ],
                hash_comments: true,
                line_comment_requires_space: true,
                executable_comments: true,
                string_escape: LiteralStyle::Mysql,
                ..base
            },
            SqlDialect::Mssql => Self {
                quotes: vec![
                    QuoteRule::new("'", Str, Double),
                    QuoteRule::new("[", Identifier, Double),
                    QuoteRule::new("\"", Identifier, Double),
                ],
                nested_block_comments: true,
                line_comment_ends_at_cr: true,
                ..base
            },
            SqlDialect::Sqlite => Self {
                quotes: vec![
                    QuoteRule::new("'", Str, Double),
                    QuoteRule::new("\"", Identifier, Double),
                    QuoteRule::new("`", Identifier, Double),
                    QuoteRule::new("[", Identifier, NoEscape),
                ],
                ..base
            },
            SqlDialect::Oracle | SqlDialect::Generic => base,
        }
    }

    /// Resolves the syntax of a driver from its capabilities: the preset of
    /// `sql_syntax.extends` (default: `sql_dialect`) with the declared
    /// overrides applied. Without `sql_syntax` this is `preset(sql_dialect)`.
    pub fn resolve(caps: &DriverCapabilities) -> Self {
        let Some(desc) = caps.sql_syntax.as_ref() else {
            return Self::preset(caps.sql_dialect);
        };
        let mut syntax = Self::preset(desc.extends.or(caps.sql_dialect));
        syntax.declared = true;
        if let Some(quotes) = &desc.quotes {
            syntax.quotes = quotes.clone();
        }
        if let Some(prefixes) = &desc.string_prefixes {
            syntax.string_prefixes = prefixes.clone();
        }
        let flags = [
            (
                desc.triple_quoted_strings,
                &mut syntax.triple_quoted_strings,
            ),
            (desc.hash_comments, &mut syntax.hash_comments),
            (
                desc.nested_block_comments,
                &mut syntax.nested_block_comments,
            ),
            (
                desc.line_comment_requires_space,
                &mut syntax.line_comment_requires_space,
            ),
            (desc.script_blocks, &mut syntax.script_blocks),
            (desc.dollar_quoting, &mut syntax.dollar_quoting),
            (desc.like_escape, &mut syntax.like_escape),
        ];
        for (declared, slot) in flags {
            if let Some(value) = declared {
                *slot = value;
            }
        }
        if let Some(escape) = desc.string_escape {
            syntax.string_escape = declared_string_escape(escape, syntax.string_escape);
        }
        syntax
    }

    /// The quote rule opening with `open`, if the syntax has one.
    pub fn quote(&self, open: &str) -> Option<&QuoteRule> {
        self.quotes.iter().find(|q| q.open == open)
    }

    /// Whether a backslash escapes inside the quote opening with `open`.
    pub fn backslash_in(&self, open: &str) -> bool {
        self.quote(open).is_some_and(|q| q.escape.backslash())
    }
}

/// The literal style a declared `string_escape` resolves to on top of the
/// preset's `base` style. A declaration never weakens the base: on the
/// `mysql` preset a backslash is an escape character on the engine, so
/// `standard` (backslashes left as is) would let a value ending in `\`
/// swallow its closing quote. That override is ignored with a warning;
/// `backslash` escapes backslashes too and is kept.
fn declared_string_escape(declared: StringEscape, base: LiteralStyle) -> LiteralStyle {
    match (declared, base) {
        (StringEscape::Standard, LiteralStyle::Mysql) => {
            log::warn!(
                "Ignoring sql_syntax.string_escape \"standard\": the mysql preset needs backslashes escaped"
            );
            base
        }
        (StringEscape::Standard, _) => LiteralStyle::Standard,
        (StringEscape::Backslash, _) => LiteralStyle::Backslash,
    }
}

/// Quotes `value` as a single-quoted SQL string literal in `style`.
pub fn quote_string_literal(value: &str, style: LiteralStyle) -> String {
    match style {
        LiteralStyle::Standard => format!("'{}'", value.replace('\'', "''")),
        LiteralStyle::Mysql => format!(
            "'{}'",
            value
                .replace('\\', "\\\\")
                .replace('\'', "''")
                .replace('\0', "\\0")
        ),
        LiteralStyle::Backslash => format!(
            "'{}'",
            value
                .replace('\\', "\\\\")
                .replace('\'', "\\'")
                .replace('\0', "\\0")
                .replace('\n', "\\n")
                .replace('\r', "\\r")
        ),
    }
}
