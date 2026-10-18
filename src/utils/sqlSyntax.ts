import type { SqlLanguage } from "sql-formatter";
import type {
  DriverCapabilities,
  PluginManifest,
  SqlSyntaxDescriptor,
} from "../types/plugins";
import {
  dialectOptions,
  isDialect,
  normalizeDialect,
  type Dialect,
  type DialectOptions,
  type QuoteRule,
  type SqlSyntaxSource,
} from "./sqlSplitter";

/**
 * How generated string literals are escaped:
 *
 * - `standard`: a quote is doubled (`'O''Brien'`), backslash is plain text.
 * - `mysql`: a quote is doubled and backslash is an escape character, so a
 *   literal backslash is doubled too (the `mysql` preset: MySQL/MariaDB
 *   default sql_mode).
 * - `backslash`: no doubled-quote escape and no raw newline in a literal, so
 *   quote, backslash, NUL and line breaks are backslash-escaped (`'O\'Brien'`).
 *   Declared with `sql_syntax.string_escape: "backslash"` (GoogleSQL).
 */
export type StringEscapeStyle = "standard" | "mysql" | "backslash";

/**
 * The SQL syntax a driver follows: its preset plus any declared
 * `sql_syntax` overrides. The single source for every dialect-dependent
 * behaviour that is not about generated SQL shape: statement splitting,
 * literal escaping, `LIKE … ESCAPE`, formatter language and extra
 * autocomplete words. Pass it to the splitter helpers in place of a dialect.
 */
export interface SqlSyntax extends SqlSyntaxSource {
  readonly stringEscape: StringEscapeStyle;
  /** `LIKE … ESCAPE '\'` is supported. */
  readonly likeEscape: boolean;
  readonly formatter: SqlLanguage;
  /** Declared autocomplete keywords (empty without `sql_syntax`). */
  readonly keywords: readonly string[];
  /** Declared autocomplete functions (empty without `sql_syntax`). */
  readonly functions: readonly string[];
}

/** Limits of a declared `sql_syntax`, mirrored in `drivers/sql_syntax.rs`. */
export const SQL_SYNTAX_LIMITS = {
  maxQuotes: 8,
  maxStringPrefixes: 8,
  maxStringPrefixLength: 2,
  maxWords: 1000,
  maxWordLength: 64,
} as const;

/** `sql-formatter` languages a descriptor may pick. */
export const SQL_SYNTAX_FORMATTERS: readonly SqlLanguage[] = [
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

const PRESET_FORMATTERS: Readonly<Record<Dialect, SqlLanguage>> = {
  postgres: "postgresql",
  mysql: "mysql",
  mssql: "transactsql",
  sqlite: "sqlite",
  oracle: "plsql",
  generic: "sql",
};

/**
 * `sql-formatter` language for a dialect name. Unknown or generic dialects
 * fall back to standard `sql`.
 */
export function presetFormatter(dialect: string | undefined): SqlLanguage {
  return isDialect(dialect) ? PRESET_FORMATTERS[dialect] : "sql";
}

const NO_WORDS: readonly string[] = [];

function presetSyntax(name: string | undefined): SqlSyntax {
  const dialect = isDialect(name) ? name : undefined;
  return {
    dialect,
    declared: false,
    options: dialectOptions(normalizeDialect(name)),
    stringEscape: dialect === "mysql" ? "mysql" : "standard",
    likeEscape: true,
    formatter: presetFormatter(dialect),
    keywords: NO_WORDS,
    functions: NO_WORDS,
  };
}

// One shared object per preset, so a resolved syntax compares (and memoizes)
// like the dialect string it replaces.
const PRESETS = new Map<string | undefined, SqlSyntax>();

function cachedPreset(name: string | undefined): SqlSyntax {
  let syntax = PRESETS.get(name);
  if (!syntax) {
    syntax = presetSyntax(name);
    PRESETS.set(name, syntax);
  }
  return syntax;
}

// Declared syntaxes, keyed by the descriptor object and then by the
// `sql_dialect` its `extends` defaults to.
const DECLARED = new WeakMap<SqlSyntaxDescriptor, Map<string | undefined, SqlSyntax>>();

/**
 * Resolves a driver's SQL syntax from its capabilities (or manifest): the
 * preset of `sql_syntax.extends` (default `sql_dialect`) with the declared
 * overrides applied. Without `sql_syntax` this is exactly the preset of
 * `sql_dialect`, as it was before descriptors existed. Results are cached,
 * so the same capabilities always yield the same object.
 */
export function resolveSqlSyntax(
  driver: PluginManifest | DriverCapabilities | null | undefined,
): SqlSyntax {
  const caps = driver && "capabilities" in driver ? driver.capabilities : driver;
  const dialect = caps?.sql_dialect;
  const descriptor = caps?.sql_syntax;
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    return cachedPreset(dialect);
  }
  let byDialect = DECLARED.get(descriptor);
  if (!byDialect) {
    byDialect = new Map();
    DECLARED.set(descriptor, byDialect);
  }
  let syntax = byDialect.get(dialect);
  if (!syntax) {
    syntax = applyDescriptor(descriptor, dialect);
    byDialect.set(dialect, syntax);
  }
  return syntax;
}

/**
 * The literal style a descriptor's `string_escape` resolves to. A declared
 * style never weakens the base preset's: on a `mysql` base a backslash is an
 * escape character on the engine, so `"standard"` (backslashes left as is)
 * would let a value ending in `\` swallow its closing quote. That override
 * is ignored with a warning; `"backslash"` escapes backslashes too and is kept.
 */
function declaredStringEscape(
  declared: unknown,
  base: StringEscapeStyle,
): StringEscapeStyle {
  if (declared !== "standard" && declared !== "backslash") return base;
  if (declared === "standard" && base === "mysql") {
    console.warn(
      'Ignoring sql_syntax.string_escape "standard": the mysql preset needs backslashes escaped',
    );
    return base;
  }
  return declared;
}

// The backend validates the descriptor when it loads the manifest and logs
// what it drops; these checks keep the frontend safe on their own and drop
// an invalid field silently, keeping the preset's rule.
function applyDescriptor(
  descriptor: SqlSyntaxDescriptor,
  sqlDialect: string | undefined,
): SqlSyntax {
  const extendsPreset = isDialect(descriptor.extends) ? descriptor.extends : undefined;
  const base = presetSyntax(extendsPreset ?? sqlDialect);
  const flag = (value: unknown, fallback: boolean): boolean =>
    typeof value === "boolean" ? value : fallback;
  const preset = base.options;
  const options: DialectOptions = {
    ...preset,
    quotes: parseQuotes(descriptor.quotes) ?? preset.quotes,
    tripleQuotedStrings: flag(descriptor.triple_quoted_strings, preset.tripleQuotedStrings),
    stringPrefixes: parseStringPrefixes(descriptor.string_prefixes) ?? preset.stringPrefixes,
    hashComments: flag(descriptor.hash_comments, preset.hashComments),
    nestedBlockComments: flag(descriptor.nested_block_comments, preset.nestedBlockComments),
    lineCommentRequiresSpace: flag(
      descriptor.line_comment_requires_space,
      preset.lineCommentRequiresSpace,
    ),
    scriptBlocks: flag(descriptor.script_blocks, preset.scriptBlocks),
    dollarQuoting: flag(descriptor.dollar_quoting, preset.dollarQuoting),
  };
  const stringEscape = declaredStringEscape(descriptor.string_escape, base.stringEscape);
  const formatter = SQL_SYNTAX_FORMATTERS.find((f) => f === descriptor.formatter);
  return {
    dialect: base.dialect,
    declared: true,
    options,
    stringEscape,
    likeEscape: flag(descriptor.like_escape, base.likeEscape),
    formatter: formatter ?? base.formatter,
    keywords: parseWords(descriptor.keywords) ?? NO_WORDS,
    functions: parseWords(descriptor.functions) ?? NO_WORDS,
  };
}

const QUOTE_CLOSE: Readonly<Record<string, string>> = {
  "'": "'",
  '"': '"',
  "`": "`",
  "[": "]",
};

function parseQuotes(value: unknown): QuoteRule[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > SQL_SYNTAX_LIMITS.maxQuotes
  ) {
    return undefined;
  }
  const rules: QuoteRule[] = [];
  for (const item of value as unknown[]) {
    const rule = parseQuote(item);
    if (!rule || rules.some((r) => r.open === rule.open)) return undefined;
    rules.push(rule);
  }
  return rules;
}

function parseQuote(item: unknown): QuoteRule | undefined {
  if (typeof item !== "object" || item === null) return undefined;
  const { open, close, kind, escape } = item as Record<string, unknown>;
  if (typeof open !== "string" || !Object.hasOwn(QUOTE_CLOSE, open)) return undefined;
  const expectedClose = QUOTE_CLOSE[open];
  if (close !== undefined && close !== null && close !== expectedClose) return undefined;
  if (kind !== "string" && kind !== "identifier") return undefined;
  const style = escape ?? "double";
  if (style !== "double" && style !== "backslash" && style !== "both" && style !== "none") {
    return undefined;
  }
  return {
    open,
    close: expectedClose,
    kind,
    doubleClose: style === "double" || style === "both",
    ...(style === "backslash" || style === "both" ? { escape: "\\" } : {}),
  };
}

const PREFIX_RE = /^[A-Za-z]+$/;

function parseStringPrefixes(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > SQL_SYNTAX_LIMITS.maxStringPrefixes) {
    return undefined;
  }
  const prefixes: string[] = [];
  for (const item of value as unknown[]) {
    if (
      typeof item !== "string" ||
      item.length > SQL_SYNTAX_LIMITS.maxStringPrefixLength ||
      !PREFIX_RE.test(item)
    ) {
      return undefined;
    }
    const prefix = item.toLowerCase();
    if (!prefixes.includes(prefix)) prefixes.push(prefix);
  }
  return prefixes;
}

/**
 * An acceptable keyword or function name: an ASCII letter or `_`, then
 * letters, digits, `_`, `$`, `.` or single inner spaces
 * (`FOR SYSTEM_TIME AS OF`, `SAFE.`), at most 64 characters.
 */
const WORD_RE = /^[A-Za-z_](?:[A-Za-z0-9_$.]| (?! ))*$/;

export function isValidSyntaxWord(word: unknown): word is string {
  return (
    typeof word === "string" &&
    word.length <= SQL_SYNTAX_LIMITS.maxWordLength &&
    !word.endsWith(" ") &&
    WORD_RE.test(word)
  );
}

function parseWords(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > SQL_SYNTAX_LIMITS.maxWords) {
    return undefined;
  }
  if (!(value as unknown[]).every(isValidSyntaxWord)) return undefined;
  return [...new Set(value as string[])];
}

/**
 * Autocomplete keywords for a syntax: the shared `base` list followed by the
 * declared keywords and functions, without duplicates. Without declared
 * words this is `base` itself.
 */
export function syntaxKeywords(
  base: readonly string[],
  syntax: SqlSyntax,
): readonly string[] {
  if (syntax.keywords.length === 0 && syntax.functions.length === 0) return base;
  const seen = new Set(base);
  const extra = [...syntax.keywords, ...syntax.functions].filter((word) => {
    if (seen.has(word)) return false;
    seen.add(word);
    return true;
  });
  return [...base, ...extra];
}
