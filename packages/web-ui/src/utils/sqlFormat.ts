import {format, type FormatOptionsWithLanguage, type SqlLanguage} from 'sql-formatter';
import type {DialectInput} from './sqlSplitter';
import {presetFormatter, type SqlSyntax} from './sqlSyntax';

/**
 * Maps Tabularis' internal SQL dialect, or a resolved syntax (whose
 * declared `formatter` wins), to the matching `sql-formatter` language.
 * Unknown or generic dialects fall back to standard `sql`.
 */
export function toFormatterLanguage(dialect: DialectInput | SqlSyntax): SqlLanguage {
    if (typeof dialect === 'object') {
        return 'formatter' in dialect ? dialect.formatter : presetFormatter(dialect.dialect);
    }
    return presetFormatter(dialect);
}

/**
 * Beautifies a SQL string for the given dialect. Returns the input
 * unchanged when it is empty or when the formatter throws (e.g. on
 * syntactically incomplete SQL), so callers never lose the user's text.
 */
export function formatSql(
    sql: string,
    dialect?: DialectInput | SqlSyntax,
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
