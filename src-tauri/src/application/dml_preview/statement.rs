//! Strict parser for the PostgreSQL `UPDATE` / `DELETE` subset that
//! "Preview changes" supports (issue #1404).
//!
//! The grammar is the allowlist: anything this parser does not model is
//! rejected with a named reason instead of being passed through. The preview
//! SQL is rendered from the parsed tree (see `render.rs`), never spliced from
//! the source text.

use std::fmt;

/// Why a statement cannot be previewed. Shown to the user as is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Rejection {
    Empty,
    MultipleStatements,
    NotUpdateOrDelete,
    /// Syntax the first milestone does not support, named for the user.
    Unsupported(&'static str),
    /// A function outside the allowlist.
    Function(String),
    /// A cast target outside the allowlist.
    CastType(String),
    /// A column qualified by something other than the target table.
    ForeignQualifier(String),
    Syntax(String),
}

impl fmt::Display for Rejection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Rejection::Empty => write!(f, "There is no statement to preview."),
            Rejection::MultipleStatements => {
                write!(f, "Preview works on one statement at a time.")
            }
            Rejection::NotUpdateOrDelete => {
                write!(f, "Only UPDATE and DELETE statements can be previewed.")
            }
            Rejection::Unsupported(what) => write!(f, "Preview does not support {what}."),
            Rejection::Function(name) => write!(
                f,
                "Preview does not evaluate the function {name}(). Only a fixed list of built-in functions is allowed."
            ),
            Rejection::CastType(name) => write!(
                f,
                "Preview does not support casts to {name}. Only built-in types are allowed."
            ),
            Rejection::ForeignQualifier(name) => write!(
                f,
                "The column reference {name} does not belong to the target table."
            ),
            Rejection::Syntax(detail) => write!(f, "Could not parse the statement: {detail}"),
        }
    }
}

/// An identifier as PostgreSQL resolves it: unquoted names fold to lower case.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ident(pub String);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub schema: Option<Ident>,
    pub table: Ident,
    pub alias: Option<Ident>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Assignment {
    pub column: Ident,
    pub value: Expr,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Statement {
    Update {
        target: Target,
        assignments: Vec<Assignment>,
        filter: Option<Expr>,
    },
    Delete {
        target: Target,
        filter: Option<Expr>,
    },
}

impl Statement {
    pub fn target(&self) -> &Target {
        match self {
            Statement::Update { target, .. } | Statement::Delete { target, .. } => target,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinaryOp {
    Or,
    And,
    Eq,
    NotEq,
    Lt,
    LtEq,
    Gt,
    GtEq,
    Plus,
    Minus,
    Multiply,
    Divide,
    Modulo,
    Concat,
}

/// Built-in functions the preview may evaluate. All are immutable and are
/// rendered as `pg_catalog.<name>` so a same-named function earlier on the
/// search path cannot be picked instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Function {
    Lower,
    Upper,
    Btrim,
    Length,
    Abs,
    Round,
    Floor,
    Ceil,
}

impl Function {
    fn from_name(name: &str) -> Option<Self> {
        Some(match name {
            "lower" => Function::Lower,
            "upper" => Function::Upper,
            "btrim" => Function::Btrim,
            "length" | "char_length" => Function::Length,
            "abs" => Function::Abs,
            "round" => Function::Round,
            "floor" => Function::Floor,
            "ceil" | "ceiling" => Function::Ceil,
            _ => return None,
        })
    }

    pub fn catalog_name(self) -> &'static str {
        match self {
            Function::Lower => "lower",
            Function::Upper => "upper",
            Function::Btrim => "btrim",
            Function::Length => "length",
            Function::Abs => "abs",
            Function::Round => "round",
            Function::Floor => "floor",
            Function::Ceil => "ceil",
        }
    }
}

/// Built-in cast targets, by their `pg_catalog` type name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CastType {
    pub catalog_name: &'static str,
    /// Type modifiers such as `varchar(20)` or `numeric(10, 2)`.
    pub modifiers: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Expr {
    Column {
        qualifier: Option<Ident>,
        name: Ident,
    },
    Number(String),
    String(String),
    Bool(bool),
    Null,
    Negate(Box<Expr>),
    Not(Box<Expr>),
    Binary {
        op: BinaryOp,
        left: Box<Expr>,
        right: Box<Expr>,
    },
    IsNull {
        expr: Box<Expr>,
        negated: bool,
    },
    /// `IS [NOT] TRUE` / `IS [NOT] FALSE`.
    IsBool {
        expr: Box<Expr>,
        value: bool,
        negated: bool,
    },
    InList {
        expr: Box<Expr>,
        list: Vec<Expr>,
        negated: bool,
    },
    Between {
        expr: Box<Expr>,
        low: Box<Expr>,
        high: Box<Expr>,
        negated: bool,
    },
    Like {
        expr: Box<Expr>,
        pattern: Box<Expr>,
        negated: bool,
        case_insensitive: bool,
    },
    /// Only literals can be cast, so the conversion is always a built-in
    /// type's input function and never a cast function on a column's type.
    Cast {
        expr: Box<Expr>,
        to: CastType,
    },
    Call {
        function: Function,
        args: Vec<Expr>,
    },
    Coalesce(Vec<Expr>),
}

// ---------------------------------------------------------------- lexer

#[derive(Debug, Clone, PartialEq)]
enum Token {
    /// Unquoted word, already lower-cased.
    Word(String),
    Quoted(String),
    Number(String),
    String(String),
    Op(&'static str),
}

fn lex(sql: &str) -> Result<Vec<Token>, Rejection> {
    let chars: Vec<char> = sql.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
        } else if c == '-' && chars.get(i + 1) == Some(&'-') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if c == '/' && chars.get(i + 1) == Some(&'*') {
            // PostgreSQL block comments nest.
            let mut depth = 0;
            loop {
                if i >= chars.len() {
                    return Err(Rejection::Syntax("unterminated comment".into()));
                }
                if chars[i] == '/' && chars.get(i + 1) == Some(&'*') {
                    depth += 1;
                    i += 2;
                } else if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
                    depth -= 1;
                    i += 2;
                    if depth == 0 {
                        break;
                    }
                } else {
                    i += 1;
                }
            }
        } else if c == '\'' {
            let (text, next) = read_quoted(&chars, i, '\'')?;
            if text.contains('\\') {
                // Its meaning depends on standard_conforming_strings.
                return Err(Rejection::Unsupported("backslashes in string literals"));
            }
            tokens.push(Token::String(text));
            i = next;
        } else if c == '"' {
            let (text, next) = read_quoted(&chars, i, '"')?;
            if text.is_empty() {
                return Err(Rejection::Syntax("empty quoted identifier".into()));
            }
            tokens.push(Token::Quoted(text));
            i = next;
        } else if c == '$' {
            if chars.get(i + 1).is_some_and(|d| d.is_ascii_digit()) {
                return Err(Rejection::Unsupported("bind parameters ($1)"));
            }
            return Err(Rejection::Unsupported("dollar-quoted strings"));
        } else if c.is_ascii_digit()
            || (c == '.' && chars.get(i + 1).is_some_and(|d| d.is_ascii_digit()))
        {
            let start = i;
            while i < chars.len() && chars[i].is_ascii_digit() {
                i += 1;
            }
            if i < chars.len() && chars[i] == '.' {
                i += 1;
                while i < chars.len() && chars[i].is_ascii_digit() {
                    i += 1;
                }
            }
            if i < chars.len() && (chars[i] == 'e' || chars[i] == 'E') {
                let mut j = i + 1;
                if j < chars.len() && (chars[j] == '+' || chars[j] == '-') {
                    j += 1;
                }
                if j < chars.len() && chars[j].is_ascii_digit() {
                    i = j;
                    while i < chars.len() && chars[i].is_ascii_digit() {
                        i += 1;
                    }
                }
            }
            if i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                return Err(Rejection::Syntax("malformed number".into()));
            }
            tokens.push(Token::Number(chars[start..i].iter().collect()));
        } else if c.is_alphabetic() || c == '_' {
            let start = i;
            while i < chars.len()
                && (chars[i].is_alphanumeric() || chars[i] == '_' || chars[i] == '$')
            {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect::<String>().to_lowercase();
            if chars.get(i) == Some(&'\'') {
                // E'..', B'..', X'..', N'..', U&'..' have their own escaping rules.
                return Err(Rejection::Unsupported(
                    "prefixed string literals (E'', B'', X'')",
                ));
            }
            if word == "u" && chars.get(i) == Some(&'&') {
                return Err(Rejection::Unsupported("Unicode escape literals"));
            }
            tokens.push(Token::Word(word));
        } else {
            let two: String = chars[i..chars.len().min(i + 2)].iter().collect();
            let op = match two.as_str() {
                "<=" => Some("<="),
                ">=" => Some(">="),
                "<>" => Some("<>"),
                "!=" => Some("<>"),
                "||" => Some("||"),
                "::" => Some("::"),
                _ => None,
            };
            if let Some(op) = op {
                // `<=>`, `||/`, `!==` and friends are other operators.
                if chars.get(i + 2).is_some_and(|n| is_operator_char(*n)) {
                    return Err(Rejection::Unsupported("operators outside the allowlist"));
                }
                tokens.push(Token::Op(op));
                i += 2;
                continue;
            }
            let op = match c {
                '=' => "=",
                '<' => "<",
                '>' => ">",
                '+' => "+",
                '-' => "-",
                '*' => "*",
                '/' => "/",
                '%' => "%",
                '(' => "(",
                ')' => ")",
                ',' => ",",
                '.' => ".",
                ';' => ";",
                ':' => return Err(Rejection::Unsupported("unbound editor parameters (:name)")),
                '[' | ']' => return Err(Rejection::Unsupported("array subscripts")),
                _ => return Err(Rejection::Unsupported("operators outside the allowlist")),
            };
            // `=-1` lexes as `=` then `-1` in PostgreSQL, so a trailing sign is fine.
            if "=<>+-*/%".contains(c)
                && chars
                    .get(i + 1)
                    .is_some_and(|n| is_operator_char(*n) && *n != '+' && *n != '-')
            {
                return Err(Rejection::Unsupported("operators outside the allowlist"));
            }
            tokens.push(Token::Op(op));
            i += 1;
        }
    }
    Ok(tokens)
}

fn is_operator_char(c: char) -> bool {
    "+-*/<>=~!@#%^&|`?".contains(c)
}

fn read_quoted(chars: &[char], start: usize, quote: char) -> Result<(String, usize), Rejection> {
    let mut text = String::new();
    let mut i = start + 1;
    loop {
        match chars.get(i) {
            None => return Err(Rejection::Syntax("unterminated quoted text".into())),
            Some(c) if *c == quote => {
                if chars.get(i + 1) == Some(&quote) {
                    text.push(quote);
                    i += 2;
                } else {
                    return Ok((text, i + 1));
                }
            }
            Some(c) => {
                text.push(*c);
                i += 1;
            }
        }
    }
}

// --------------------------------------------------------------- parser

/// Words that end an alias position or cannot start an expression operand.
const RESERVED: &[&str] = &[
    "all",
    "and",
    "as",
    "between",
    "by",
    "case",
    "cast",
    "default",
    "delete",
    "distinct",
    "else",
    "end",
    "false",
    "from",
    "in",
    "inner",
    "is",
    "isnull",
    "join",
    "like",
    "ilike",
    "limit",
    "not",
    "notnull",
    "null",
    "only",
    "or",
    "order",
    "returning",
    "select",
    "set",
    "similar",
    "table",
    "then",
    "true",
    "union",
    "update",
    "using",
    "when",
    "where",
    "with",
];

pub fn parse(sql: &str) -> Result<Statement, Rejection> {
    let tokens = lex(sql)?;
    let mut statements = tokens
        .split(|t| *t == Token::Op(";"))
        .filter(|s| !s.is_empty());
    let Some(first) = statements.next() else {
        return Err(Rejection::Empty);
    };
    if statements.next().is_some() {
        return Err(Rejection::MultipleStatements);
    }
    let mut parser = Parser {
        tokens: first,
        pos: 0,
    };
    let statement = parser.statement()?;
    if let Some(token) = parser.peek() {
        return Err(parser.unexpected(token));
    }
    Ok(statement)
}

struct Parser<'a> {
    tokens: &'a [Token],
    pos: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    fn peek_word(&self) -> Option<&str> {
        match self.peek() {
            Some(Token::Word(w)) => Some(w),
            _ => None,
        }
    }

    fn eat_word(&mut self, word: &str) -> bool {
        if self.peek_word() == Some(word) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn eat_op(&mut self, op: &str) -> bool {
        if matches!(self.peek(), Some(Token::Op(o)) if *o == op) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn expect_op(&mut self, op: &str) -> Result<(), Rejection> {
        if self.eat_op(op) {
            Ok(())
        } else {
            Err(self.expected(&format!("\"{op}\"")))
        }
    }

    fn expect_word(&mut self, word: &str) -> Result<(), Rejection> {
        if self.eat_word(word) {
            Ok(())
        } else {
            Err(self.expected(&word.to_uppercase()))
        }
    }

    fn expected(&self, what: &str) -> Rejection {
        match self.peek() {
            Some(token) => Rejection::Syntax(format!("expected {what}, found {}", describe(token))),
            None => Rejection::Syntax(format!("expected {what} at the end of the statement")),
        }
    }

    fn unexpected(&self, token: &Token) -> Rejection {
        if let Token::Word(w) = token {
            if let Some(reason) = unsupported_clause(w) {
                return Rejection::Unsupported(reason);
            }
        }
        Rejection::Syntax(format!("unexpected {}", describe(token)))
    }

    fn statement(&mut self) -> Result<Statement, Rejection> {
        match self.peek_word() {
            Some("update") => {
                self.pos += 1;
                self.update()
            }
            Some("delete") => {
                self.pos += 1;
                self.delete()
            }
            Some("with") => Err(Rejection::Unsupported("WITH (common table expressions)")),
            Some("insert") => Err(Rejection::Unsupported("INSERT")),
            Some("merge") => Err(Rejection::Unsupported("MERGE")),
            _ => Err(Rejection::NotUpdateOrDelete),
        }
    }

    fn update(&mut self) -> Result<Statement, Rejection> {
        let target = self.target()?;
        self.expect_word("set")?;
        let mut assignments = Vec::new();
        loop {
            if self.eat_op("(") {
                return Err(Rejection::Unsupported("multi-column assignments"));
            }
            let column = self.ident("a column name")?;
            if self.eat_op(".") {
                return Err(Rejection::Unsupported("assignments to composite fields"));
            }
            self.expect_op("=")?;
            if self.eat_word("default") {
                return Err(Rejection::Unsupported("SET ... = DEFAULT"));
            }
            let value = self.expr()?;
            assignments.push(Assignment { column, value });
            if !self.eat_op(",") {
                break;
            }
        }
        let filter = self.where_clause()?;
        Ok(Statement::Update {
            target,
            assignments,
            filter,
        })
    }

    fn delete(&mut self) -> Result<Statement, Rejection> {
        self.expect_word("from")?;
        let target = self.target()?;
        let filter = self.where_clause()?;
        Ok(Statement::Delete { target, filter })
    }

    fn target(&mut self) -> Result<Target, Rejection> {
        if self.eat_word("only") {
            return Err(Rejection::Unsupported("ONLY"));
        }
        let first = self.ident("a table name")?;
        let (schema, table) = if self.eat_op(".") {
            let table = self.ident("a table name")?;
            if self.eat_op(".") {
                return Err(Rejection::Unsupported("database-qualified table names"));
            }
            (Some(first), table)
        } else {
            (None, first)
        };
        if self.eat_op("*") {
            return Err(Rejection::Unsupported("table inheritance markers (*)"));
        }
        let alias = if self.eat_word("as") {
            Some(self.ident("an alias")?)
        } else {
            match self.peek() {
                Some(Token::Quoted(_)) => Some(self.ident("an alias")?),
                Some(Token::Word(w)) if !RESERVED.contains(&w.as_str()) => {
                    Some(self.ident("an alias")?)
                }
                _ => None,
            }
        };
        Ok(Target {
            schema,
            table,
            alias,
        })
    }

    fn where_clause(&mut self) -> Result<Option<Expr>, Rejection> {
        if !self.eat_word("where") {
            return Ok(None);
        }
        if self.eat_word("current") {
            return Err(Rejection::Unsupported("WHERE CURRENT OF"));
        }
        Ok(Some(self.expr()?))
    }

    fn ident(&mut self, what: &str) -> Result<Ident, Rejection> {
        match self.peek() {
            Some(Token::Quoted(name)) => {
                let name = name.clone();
                self.pos += 1;
                Ok(Ident(name))
            }
            Some(Token::Word(w)) if !RESERVED.contains(&w.as_str()) => {
                let name = w.clone();
                self.pos += 1;
                Ok(Ident(name))
            }
            Some(Token::Word(w)) => match unsupported_clause(w) {
                Some(reason) => Err(Rejection::Unsupported(reason)),
                None => Err(self.expected(what)),
            },
            _ => Err(self.expected(what)),
        }
    }

    // Precedence follows the PostgreSQL manual, lowest first.
    fn expr(&mut self) -> Result<Expr, Rejection> {
        self.or()
    }

    fn or(&mut self) -> Result<Expr, Rejection> {
        let mut left = self.and()?;
        while self.eat_word("or") {
            let right = self.and()?;
            left = binary(BinaryOp::Or, left, right);
        }
        Ok(left)
    }

    fn and(&mut self) -> Result<Expr, Rejection> {
        let mut left = self.not()?;
        while self.eat_word("and") {
            let right = self.not()?;
            left = binary(BinaryOp::And, left, right);
        }
        Ok(left)
    }

    fn not(&mut self) -> Result<Expr, Rejection> {
        if self.eat_word("not") {
            return Ok(Expr::Not(Box::new(self.not()?)));
        }
        self.is()
    }

    fn is(&mut self) -> Result<Expr, Rejection> {
        let mut expr = self.comparison()?;
        loop {
            if self.eat_word("isnull") {
                expr = Expr::IsNull {
                    expr: Box::new(expr),
                    negated: false,
                };
            } else if self.eat_word("notnull") {
                expr = Expr::IsNull {
                    expr: Box::new(expr),
                    negated: true,
                };
            } else if self.eat_word("is") {
                let negated = self.eat_word("not");
                expr = if self.eat_word("null") {
                    Expr::IsNull {
                        expr: Box::new(expr),
                        negated,
                    }
                } else if self.eat_word("true") {
                    Expr::IsBool {
                        expr: Box::new(expr),
                        value: true,
                        negated,
                    }
                } else if self.eat_word("false") {
                    Expr::IsBool {
                        expr: Box::new(expr),
                        value: false,
                        negated,
                    }
                } else if self.eat_word("distinct") {
                    return Err(Rejection::Unsupported("IS DISTINCT FROM"));
                } else {
                    return Err(self.expected("NULL, TRUE or FALSE after IS"));
                };
            } else {
                return Ok(expr);
            }
        }
    }

    fn comparison(&mut self) -> Result<Expr, Rejection> {
        let left = self.pattern()?;
        let op = match self.peek() {
            Some(Token::Op("=")) => BinaryOp::Eq,
            Some(Token::Op("<>")) => BinaryOp::NotEq,
            Some(Token::Op("<")) => BinaryOp::Lt,
            Some(Token::Op("<=")) => BinaryOp::LtEq,
            Some(Token::Op(">")) => BinaryOp::Gt,
            Some(Token::Op(">=")) => BinaryOp::GtEq,
            _ => return Ok(left),
        };
        self.pos += 1;
        if matches!(self.peek_word(), Some("any" | "some" | "all")) {
            return Err(Rejection::Unsupported("ANY / SOME / ALL"));
        }
        let right = self.pattern()?;
        if matches!(
            self.peek(),
            Some(Token::Op("=" | "<>" | "<" | "<=" | ">" | ">="))
        ) {
            return Err(Rejection::Syntax(
                "chained comparisons need parentheses".into(),
            ));
        }
        Ok(binary(op, left, right))
    }

    fn pattern(&mut self) -> Result<Expr, Rejection> {
        let expr = self.concat()?;
        let save = self.pos;
        let negated = self.eat_word("not");
        if self.eat_word("in") {
            self.expect_op("(")?;
            if matches!(self.peek_word(), Some("select" | "with" | "values")) {
                return Err(Rejection::Unsupported("subqueries"));
            }
            let list = self.expr_list()?;
            return Ok(Expr::InList {
                expr: Box::new(expr),
                list,
                negated,
            });
        }
        if self.eat_word("between") {
            if self.eat_word("symmetric") {
                return Err(Rejection::Unsupported("BETWEEN SYMMETRIC"));
            }
            let low = self.concat()?;
            self.expect_word("and")?;
            let high = self.concat()?;
            return Ok(Expr::Between {
                expr: Box::new(expr),
                low: Box::new(low),
                high: Box::new(high),
                negated,
            });
        }
        let like = if self.eat_word("like") {
            Some(false)
        } else if self.eat_word("ilike") {
            Some(true)
        } else {
            None
        };
        if let Some(case_insensitive) = like {
            let pattern = self.concat()?;
            if self.eat_word("escape") {
                return Err(Rejection::Unsupported("LIKE ... ESCAPE"));
            }
            return Ok(Expr::Like {
                expr: Box::new(expr),
                pattern: Box::new(pattern),
                negated,
                case_insensitive,
            });
        }
        if self.eat_word("similar") {
            return Err(Rejection::Unsupported("SIMILAR TO"));
        }
        self.pos = save;
        Ok(expr)
    }

    fn concat(&mut self) -> Result<Expr, Rejection> {
        let mut left = self.additive()?;
        while self.eat_op("||") {
            let right = self.additive()?;
            left = binary(BinaryOp::Concat, left, right);
        }
        Ok(left)
    }

    fn additive(&mut self) -> Result<Expr, Rejection> {
        let mut left = self.multiplicative()?;
        loop {
            let op = if self.eat_op("+") {
                BinaryOp::Plus
            } else if self.eat_op("-") {
                BinaryOp::Minus
            } else {
                return Ok(left);
            };
            let right = self.multiplicative()?;
            left = binary(op, left, right);
        }
    }

    fn multiplicative(&mut self) -> Result<Expr, Rejection> {
        let mut left = self.unary()?;
        loop {
            let op = if self.eat_op("*") {
                BinaryOp::Multiply
            } else if self.eat_op("/") {
                BinaryOp::Divide
            } else if self.eat_op("%") {
                BinaryOp::Modulo
            } else {
                return Ok(left);
            };
            let right = self.unary()?;
            left = binary(op, left, right);
        }
    }

    fn unary(&mut self) -> Result<Expr, Rejection> {
        if self.eat_op("-") {
            return Ok(Expr::Negate(Box::new(self.unary()?)));
        }
        if self.eat_op("+") {
            return self.unary();
        }
        self.postfix_cast()
    }

    fn postfix_cast(&mut self) -> Result<Expr, Rejection> {
        let mut expr = self.primary()?;
        while self.eat_op("::") {
            let to = self.cast_type()?;
            expr = cast(expr, to)?;
        }
        if self.eat_word("collate") {
            return Err(Rejection::Unsupported("COLLATE"));
        }
        if self.eat_word("at") {
            return Err(Rejection::Unsupported("AT TIME ZONE"));
        }
        Ok(expr)
    }

    fn primary(&mut self) -> Result<Expr, Rejection> {
        let Some(token) = self.peek().cloned() else {
            return Err(self.expected("an expression"));
        };
        self.pos += 1;
        match token {
            Token::Number(n) => Ok(Expr::Number(n)),
            Token::String(s) => Ok(Expr::String(s)),
            Token::Op("(") => {
                if matches!(self.peek_word(), Some("select" | "with" | "values")) {
                    return Err(Rejection::Unsupported("subqueries"));
                }
                let inner = self.expr()?;
                if self.eat_op(",") {
                    return Err(Rejection::Unsupported("row constructors"));
                }
                self.expect_op(")")?;
                Ok(inner)
            }
            Token::Quoted(name) => self.column_or_call(name, true),
            Token::Word(word) => match word.as_str() {
                "null" => Ok(Expr::Null),
                "true" => Ok(Expr::Bool(true)),
                "false" => Ok(Expr::Bool(false)),
                "cast" => {
                    self.expect_op("(")?;
                    let expr = self.expr()?;
                    self.expect_word("as")?;
                    let to = self.cast_type()?;
                    self.expect_op(")")?;
                    cast(expr, to)
                }
                "coalesce" => {
                    self.expect_op("(")?;
                    Ok(Expr::Coalesce(self.expr_list()?))
                }
                "exists" | "select" | "array" | "row" => Err(Rejection::Unsupported("subqueries")),
                "case" => Err(Rejection::Unsupported("CASE expressions")),
                "current_date" | "current_time" | "current_timestamp" | "localtime"
                | "localtimestamp" | "current_user" | "session_user" | "user" | "current_role"
                | "current_schema" | "current_catalog" => Err(Rejection::Function(word)),
                "nullif" | "greatest" | "least" => Err(Rejection::Function(word)),
                "interval" | "date" | "timestamp" | "time"
                    if matches!(self.peek(), Some(Token::String(_))) =>
                {
                    Err(Rejection::Unsupported(
                        "typed literals (DATE '...'); use '...'::date",
                    ))
                }
                w if RESERVED.contains(&w) => Err(self.unexpected(&Token::Word(word.clone()))),
                _ => self.column_or_call(word, false),
            },
            other => Err(Rejection::Syntax(format!(
                "unexpected {}",
                describe(&other)
            ))),
        }
    }

    fn column_or_call(&mut self, first: String, quoted: bool) -> Result<Expr, Rejection> {
        if self.eat_op(".") {
            let name = self.ident("a column name")?;
            if self.eat_op("(") {
                return Err(Rejection::Function(format!("{first}.{}", name.0)));
            }
            if self.eat_op(".") {
                return Err(Rejection::Unsupported("schema-qualified column references"));
            }
            return Ok(Expr::Column {
                qualifier: Some(Ident(first)),
                name,
            });
        }
        if self.eat_op("(") {
            let function = if quoted {
                None
            } else {
                Function::from_name(&first)
            };
            let Some(function) = function else {
                return Err(Rejection::Function(first));
            };
            if self.eat_op(")") {
                return Err(Rejection::Syntax(format!("{first}() needs an argument")));
            }
            if matches!(self.peek_word(), Some("distinct" | "all"))
                || self.peek() == Some(&Token::Op("*"))
            {
                return Err(Rejection::Unsupported("aggregate syntax"));
            }
            let args = self.expr_list()?;
            return Ok(Expr::Call { function, args });
        }
        Ok(Expr::Column {
            qualifier: None,
            name: Ident(first),
        })
    }

    /// Comma-separated expressions up to and including the closing ")".
    fn expr_list(&mut self) -> Result<Vec<Expr>, Rejection> {
        let mut list = vec![self.expr()?];
        while self.eat_op(",") {
            list.push(self.expr()?);
        }
        self.expect_op(")")?;
        Ok(list)
    }

    fn cast_type(&mut self) -> Result<CastType, Rejection> {
        let name = match self.peek().cloned() {
            Some(Token::Word(w)) => {
                self.pos += 1;
                w
            }
            Some(Token::Quoted(q)) => return Err(Rejection::CastType(q)),
            _ => return Err(self.expected("a type name")),
        };
        if self.eat_op(".") {
            let rest = self.ident("a type name")?;
            return Err(Rejection::CastType(format!("{name}.{}", rest.0)));
        }
        let name = match name.as_str() {
            "double" => {
                self.expect_word("precision")?;
                "double precision".to_string()
            }
            "character" if self.eat_word("varying") => "character varying".to_string(),
            "timestamp" | "time" => {
                if self.eat_word("with") {
                    self.expect_word("time")?;
                    self.expect_word("zone")?;
                    format!("{name} with time zone")
                } else if self.eat_word("without") {
                    self.expect_word("time")?;
                    self.expect_word("zone")?;
                    name
                } else {
                    name
                }
            }
            _ => name,
        };
        let catalog_name = match name.as_str() {
            "smallint" | "int2" => "int2",
            "integer" | "int" | "int4" => "int4",
            "bigint" | "int8" => "int8",
            "numeric" | "decimal" => "numeric",
            "real" | "float4" => "float4",
            "double precision" | "float8" => "float8",
            "text" => "text",
            "varchar" | "character varying" => "varchar",
            "boolean" | "bool" => "bool",
            "date" => "date",
            "timestamp" => "timestamp",
            "timestamptz" | "timestamp with time zone" => "timestamptz",
            "time" => "time",
            "uuid" => "uuid",
            "json" => "json",
            "jsonb" => "jsonb",
            "interval" => "interval",
            _ => return Err(Rejection::CastType(name)),
        };
        let mut modifiers = Vec::new();
        if self.eat_op("(") {
            loop {
                match self.peek().cloned() {
                    Some(Token::Number(n)) if n.chars().all(|c| c.is_ascii_digit()) => {
                        self.pos += 1;
                        modifiers.push(
                            n.parse().map_err(|_| {
                                Rejection::Syntax("type modifier out of range".into())
                            })?,
                        );
                    }
                    _ => return Err(self.expected("a type modifier")),
                }
                if !self.eat_op(",") {
                    break;
                }
            }
            self.expect_op(")")?;
            let allowed = match catalog_name {
                "varchar" => modifiers.len() == 1,
                "numeric" => modifiers.len() <= 2,
                _ => false,
            };
            if !allowed {
                return Err(Rejection::CastType(format!("{name}(...)")));
            }
        }
        if self.peek() == Some(&Token::Op("[")) || self.peek_word() == Some("array") {
            return Err(Rejection::Unsupported("array types"));
        }
        Ok(CastType {
            catalog_name,
            modifiers,
        })
    }
}

fn binary(op: BinaryOp, left: Expr, right: Expr) -> Expr {
    Expr::Binary {
        op,
        left: Box::new(left),
        right: Box::new(right),
    }
}

fn cast(expr: Expr, to: CastType) -> Result<Expr, Rejection> {
    let literal = match &expr {
        Expr::Number(_) | Expr::String(_) | Expr::Bool(_) | Expr::Null => true,
        Expr::Negate(inner) => matches!(**inner, Expr::Number(_)),
        _ => false,
    };
    if !literal {
        return Err(Rejection::Unsupported(
            "casts of anything but a literal (a column's type may define its own cast function)",
        ));
    }
    Ok(Expr::Cast {
        expr: Box::new(expr),
        to,
    })
}

fn unsupported_clause(word: &str) -> Option<&'static str> {
    Some(match word {
        "from" => "UPDATE ... FROM (joins)",
        "using" => "DELETE ... USING (joins)",
        "returning" => "RETURNING",
        "join" | "inner" => "joins",
        "order" | "limit" => "ORDER BY / LIMIT",
        "with" => "WITH (common table expressions)",
        "select" => "subqueries",
        _ => return None,
    })
}

fn describe(token: &Token) -> String {
    match token {
        Token::Word(w) => format!("\"{}\"", w.to_uppercase()),
        Token::Quoted(q) => format!("identifier \"{q}\""),
        Token::Number(n) => format!("number {n}"),
        Token::String(_) => "a string literal".into(),
        Token::Op(op) => format!("\"{op}\""),
    }
}
