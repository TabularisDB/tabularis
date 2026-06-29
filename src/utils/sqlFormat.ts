import { format, type FormatOptionsWithLanguage, type SqlLanguage } from 'sql-formatter';
import type { SqlDialect } from './sql';

/**
 * Maps Tabularis' internal SQL dialect to the matching `sql-formatter`
 * language. Unknown or generic dialects fall back to standard `sql`.
 */
export function toFormatterLanguage(dialect: SqlDialect | undefined): SqlLanguage {
  switch (dialect) {
    case 'postgres':
      return 'postgresql';
    case 'mysql':
      return 'mysql';
    case 'mssql':
      return 'transactsql';
    case 'sqlite':
      return 'sqlite';
    case 'oracle':
      return 'plsql';
    default:
      return 'sql';
  }
}

/**
 * Beautifies a SQL string for the given dialect. Returns the input
 * unchanged when it is empty or when the formatter throws (e.g. on
 * syntactically incomplete SQL), so callers never lose the user's text.
 */
export function formatSql(
  sql: string,
  dialect?: SqlDialect,
  options?: Partial<FormatOptionsWithLanguage>,
): string {
  if (!sql.trim()) {
    return sql;
  }

  try {
    return format(sql, {
      language: toFormatterLanguage(dialect),
      keywordCase: 'upper',
      ...options,
    });
  } catch {
    return sql;
  }
}
