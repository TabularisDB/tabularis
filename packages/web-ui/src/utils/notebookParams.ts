import type {NotebookParam} from '@/types/notebook';
import {maskNonCode} from './queryParameters';
import type {DialectInput} from './sqlSplitter';

/**
 * `@name` and `${name}` references. `@@name` is matched first so a server
 * variable (`@@version`, `@@identity`) is never read as the parameter `name`.
 */
const REFERENCE_PATTERN = /@@\w+|@(\w+)|\$\{(\w+)\}/g;

/**
 * Calls `onReference` for every parameter reference in `sql`. An `@name`
 * inside a string literal or comment is text (`'bob@example.com'`, `-- @id`),
 * so it is skipped when `dialect` is known; `${name}` is a template and is
 * reported wherever it appears, including inside quotes.
 */
function forEachReference(
    sql: string,
    dialect: DialectInput,
    onReference: (match: string, name: string, offset: number) => void,
): void {
    const masked = maskNonCode(sql, dialect);
    for (const m of sql.matchAll(REFERENCE_PATTERN)) {
        const [match, atName, templateName] = m;
        const offset = m.index;
        if (atName !== undefined && masked[offset] === '@') {
            onReference(match, atName, offset);
        } else if (templateName !== undefined) {
            onReference(match, templateName, offset);
        }
    }
}

export interface ParamReference {
    match: string;
    name: string;
}

export function extractParamReferences(sql: string, dialect?: DialectInput): ParamReference[] {
    const refs: ParamReference[] = [];
    forEachReference(sql, dialect, (match, name) => refs.push({match, name}));
    return refs;
}

export function hasParamReferences(sql: string, dialect?: DialectInput): boolean {
    return extractParamReferences(sql, dialect).length > 0;
}

/**
 * Replaces each parameter reference with its value in one pass, so a value
 * that itself contains `@name` or `${name}` is inserted as is. References
 * without a value are left in place and listed in `unresolvedParams`.
 */
export function resolveParams(
    sql: string,
    params: NotebookParam[],
    dialect?: DialectInput,
): {sql: string; unresolvedParams: string[]} {
    const paramMap = new Map(params.map((p) => [p.name, p.value]));
    const unresolved = new Set<string>();
    let resolvedSql = '';
    let cursor = 0;
    forEachReference(sql, dialect, (match, name, offset) => {
        const value = paramMap.get(name);
        if (value === undefined) {
            unresolved.add(name);
            return;
        }
        resolvedSql += sql.slice(cursor, offset) + value;
        cursor = offset + match.length;
    });
    resolvedSql += sql.slice(cursor);
    return {sql: resolvedSql, unresolvedParams: [...unresolved]};
}

export function validateParamName(name: string): boolean {
    return /^\w+$/.test(name) && name.length > 0;
}

export function createParam(name: string, value: string): NotebookParam {
    return {name, value};
}

export function updateParam(params: NotebookParam[], name: string, value: string): NotebookParam[] {
    return params.map((p) => (p.name === name ? {...p, value} : p));
}

export function removeParam(params: NotebookParam[], name: string): NotebookParam[] {
    return params.filter((p) => p.name !== name);
}

export function addParam(params: NotebookParam[], param: NotebookParam): NotebookParam[] {
    if (params.some((p) => p.name === param.name)) return params;
    return [...params, param];
}
