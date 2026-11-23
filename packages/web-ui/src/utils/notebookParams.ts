import type {NotebookParam, NotebookParamType} from '@/types/notebook';
import {daysInMonth} from './dateInput';
import {hasCellReferences} from './notebookVariables';
import {booleanLiteralWithStyle, quoteSqlStringWithStyle} from './sqlLiteral';
import {scanNonCodeSpans, type DialectInput} from './sqlSplitter';
import type {SqlSyntax} from './sqlSyntax';

/**
 * `@name` and `${name}` references. `@@name` is matched first so a server
 * variable (`@@version`, `@@identity`) is never read as the parameter `name`.
 */
const REFERENCE_PATTERN = /@@\w+|@(\w+)|\$\{(\w+)\}/g;

/** Where a reference sits: in SQL code, inside quotes, or inside a comment. */
type ReferenceContext = 'code' | 'quoted' | 'comment';

/**
 * Calls `onReference` for every parameter reference in `sql`. An `@name`
 * inside a string literal or comment is text (`'bob@example.com'`, `-- @id`),
 * so it is skipped when `dialect` is known; `${name}` is a template and is
 * reported wherever it appears, including inside quotes, with its context.
 */
function forEachReference(
    sql: string,
    dialect: DialectInput,
    onReference: (match: string, name: string, offset: number, context: ReferenceContext) => void,
): void {
    const spans = scanNonCodeSpans(sql, dialect);
    let spanIndex = 0;
    for (const m of sql.matchAll(REFERENCE_PATTERN)) {
        const [match, atName, templateName] = m;
        const offset = m.index;
        while (spanIndex < spans.length && spans[spanIndex].end <= offset) spanIndex++;
        const span = spans[spanIndex];
        let context: ReferenceContext = 'code';
        if (span && span.start <= offset) {
            // A span carries no kind, but only a comment opens with one of these.
            const isComment =
                sql.startsWith('--', span.start) ||
                sql.startsWith('/*', span.start) ||
                sql[span.start] === '#';
            context = isComment ? 'comment' : 'quoted';
        }
        if (atName !== undefined && context === 'code') {
            onReference(match, atName, offset, context);
        } else if (templateName !== undefined) {
            onReference(match, templateName, offset, context);
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

/** The types a parameter can opt into; a parameter without one is raw. */
export const PARAM_TYPES: readonly NotebookParamType[] = [
    'text',
    'number',
    'boolean',
    'date',
    'select',
];

export function isParamType(value: unknown): value is NotebookParamType {
    return PARAM_TYPES.some((type) => type === value);
}

/**
 * Dialects a typed parameter can be written for. The host writes the value
 * into the SQL as a literal, and these are the engines those literals were
 * run on. `mssql`, `oracle` and `generic` are left out: nothing was run there
 * (SQL Server may need `N'…'` for Unicode text), so they keep raw parameters.
 */
const TYPED_PARAM_DIALECTS: ReadonlySet<string> = new Set(['postgres', 'mysql', 'sqlite']);

/**
 * The driver's resolved syntax (`resolveSqlSyntax`) when typed parameters can
 * be written for it: it follows `sql_syntax.extends` or `sql_dialect` to one
 * of `TYPED_PARAM_DIALECTS` and says how its literals are escaped. A bare
 * dialect name or no dialect carries no literal rules, so it gives none.
 */
function typedParamSyntax(dialect: DialectInput): SqlSyntax | undefined {
    if (typeof dialect !== 'object' || !isResolvedSyntax(dialect)) return undefined;
    return dialect.dialect && TYPED_PARAM_DIALECTS.has(dialect.dialect) ? dialect : undefined;
}

function isResolvedSyntax(dialect: object): dialect is SqlSyntax {
    return 'stringEscape' in dialect;
}

/** Whether a connection with this resolved syntax takes typed parameters. */
export function supportsTypedParams(dialect: DialectInput): boolean {
    return typedParamSyntax(dialect) !== undefined;
}

/** Why a typed parameter's value is rejected. */
export type ParamIssue =
    | 'invalidNumber'
    | 'invalidDate'
    | 'invalidBoolean'
    | 'invalidOption'
    | 'noOptions'
    | 'required'
    | 'emptyNeedsNull'
    | 'cellReference';

/**
 * A number as it is stored and sent: digits with an optional sign and
 * fraction. Exponents, a bare `.5`, `+7` and locale separators are rejected
 * rather than rewritten, so what was typed is what reaches the database.
 */
const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidParamNumber(value: string): boolean {
    return NUMBER_PATTERN.test(value.trim());
}

/** A real calendar date written `YYYY-MM-DD`. */
export function isValidParamDate(value: string): boolean {
    const match = DATE_PATTERN.exec(value);
    if (!match) return false;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(month, year);
}

/** Options as stored: trimmed, without empty lines or duplicates. */
export function normalizeParamOptions(options: readonly string[]): string[] {
    return [...new Set(options.map((option) => option.trim()).filter((option) => option !== ''))];
}

/**
 * The stored form of a parameter: only the fields its mode uses, with a
 * number's surrounding whitespace removed.
 */
export function normalizeParam(param: NotebookParam): NotebookParam {
    const {name, value, type} = param;
    if (!type) return {name, value};
    return {
        name,
        value: type === 'number' ? value.trim() : value,
        type,
        ...(param.isNull ? {isNull: true} : {}),
        ...(param.required ? {required: true} : {}),
        ...(type === 'select' ? {options: normalizeParamOptions(param.options ?? [])} : {}),
    };
}

/**
 * What is wrong with a parameter's value under its type, or null when it can
 * be sent. A raw parameter is never invalid: its text is pasted as typed.
 */
export function validateParam(param: NotebookParam): ParamIssue | null {
    if (!param.type) return null;
    if (param.isNull) return param.required ? 'required' : null;
    const {value} = param;
    const whenEmpty: ParamIssue = param.required ? 'required' : 'emptyNeedsNull';
    switch (param.type) {
        case 'text':
            // Cell references are expanded by a plain pattern after parameters
            // are resolved, so one inside a literal would be rewritten there.
            if (hasCellReferences(value)) return 'cellReference';
            return param.required && value === '' ? 'required' : null;
        case 'number':
            if (value.trim() === '') return whenEmpty;
            return isValidParamNumber(value) ? null : 'invalidNumber';
        case 'date':
            if (value === '') return whenEmpty;
            return isValidParamDate(value) ? null : 'invalidDate';
        case 'boolean':
            return value === 'true' || value === 'false' ? null : 'invalidBoolean';
        case 'select': {
            const options = normalizeParamOptions(param.options ?? []);
            if (options.length === 0) return 'noOptions';
            if (options.some(hasCellReferences)) return 'cellReference';
            if (value === '') return whenEmpty;
            return options.includes(value) ? null : 'invalidOption';
        }
    }
}

/**
 * The SQL literal for a valid typed parameter, in the driver's syntax
 * (`sql_syntax.string_escape` and `boolean_literals`, else its dialect).
 */
export function paramLiteral(param: NotebookParam, syntax: SqlSyntax): string {
    if (param.isNull) return 'NULL';
    switch (param.type) {
        case 'number': {
            const digits = param.value.trim();
            // `10-@n` with a bare `-5` reads `10--5`, a comment on most engines.
            return digits.startsWith('-') ? `(${digits})` : digits;
        }
        case 'boolean':
            return booleanLiteralWithStyle(
                param.value === 'true',
                syntax.booleanLiterals ?? 'keywords',
            );
        case 'text':
        case 'date':
        case 'select':
            return quoteSqlStringWithStyle(param.value, syntax.stringEscape);
        default:
            return param.value;
    }
}

/** Why a reference to a typed parameter was not replaced. */
export interface ParamError {
    name: string;
    /** The reference as written in the SQL: `@name` or `${name}`. */
    reference: string;
    /**
     * - `unsupported`: the connection has no typed parameters (`supportsTypedParams`);
     * - `quoted`: a `${name}` reference sits inside a string or quoted identifier;
     * - `invalid`: the value fails its type's validation (`issue`).
     */
    kind: 'unsupported' | 'quoted' | 'invalid';
    issue?: ParamIssue;
}

/**
 * Replaces each parameter reference in one pass, so a value that itself
 * contains `@name` or `${name}` is inserted as is. References without a
 * parameter are left in place and listed in `unresolvedParams`.
 *
 * A raw parameter's value is pasted as typed. A typed parameter is written as
 * a SQL literal for the driver's resolved syntax, passed as `dialect`; when
 * that cannot be done its reference is left in place and reported in `errors`,
 * and the SQL must not be run. A typed reference inside a comment is left as
 * written.
 */
export function resolveParams(
    sql: string,
    params: NotebookParam[],
    dialect?: DialectInput,
): {sql: string; unresolvedParams: string[]; errors: ParamError[]} {
    const paramMap = new Map(params.map((p) => [p.name, p]));
    const typedSyntax = typedParamSyntax(dialect);
    const unresolved = new Set<string>();
    const errors = new Map<string, ParamError>();
    let resolvedSql = '';
    let cursor = 0;
    // One error per parameter, for its first reference that cannot be replaced.
    const reject = (error: ParamError) => {
        if (!errors.has(error.name)) errors.set(error.name, error);
    };
    forEachReference(sql, dialect, (match, name, offset, context) => {
        const param = paramMap.get(name);
        if (param === undefined) {
            unresolved.add(name);
            return;
        }
        let value = param.value;
        if (param.type) {
            // A comment is not executed, so a typed reference there stays as written.
            if (context === 'comment') return;
            if (!typedSyntax) return reject({name, reference: match, kind: 'unsupported'});
            if (context === 'quoted') return reject({name, reference: match, kind: 'quoted'});
            const issue = validateParam(param);
            if (issue) return reject({name, reference: match, kind: 'invalid', issue});
            value = paramLiteral(param, typedSyntax);
        }
        resolvedSql += sql.slice(cursor, offset) + value;
        cursor = offset + match.length;
    });
    resolvedSql += sql.slice(cursor);
    return {sql: resolvedSql, unresolvedParams: [...unresolved], errors: [...errors.values()]};
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

/** `'O''Brien'` gives `O'Brien` when `value` is one complete quoted string. */
function unquoteSqlString(value: string): string | null {
    const match = /^'((?:[^']|'')*)'$/.exec(value.trim());
    return match ? match[1].replace(/''/g, "'") : null;
}

/**
 * The parameter under another type (`undefined`: raw), carrying its value
 * over where that is unambiguous: a raw quoted string loses its quotes for
 * text, date and list, and `true` / `false` / `1` / `0` become a boolean.
 * Anything else is kept as typed, for validation to flag.
 */
export function changeParamType(
    param: NotebookParam,
    type: NotebookParamType | undefined,
): NotebookParam {
    if (type === param.type) return param;
    const {name, value} = param;
    if (!type) return {name, value};
    const text = param.type ? value : (unquoteSqlString(value) ?? value);
    const flags = {
        ...(param.isNull ? {isNull: true} : {}),
        ...(param.required ? {required: true} : {}),
    };
    switch (type) {
        case 'number':
            return {name, value: value.trim(), type, ...flags};
        case 'boolean':
            // A checkbox has no third state to show an unreadable value in.
            return {
                name,
                value: /^(true|1)$/i.test(value.trim()) ? 'true' : 'false',
                type,
                ...flags,
            };
        case 'select':
            return {name, value: text, type, ...flags, options: text === '' ? [] : [text]};
        default:
            return {name, value: text, type, ...flags};
    }
}

/**
 * Unapplied row definitions of the Parameters panel, by parameter name. A
 * draft is a whole row (type, configuration and value) and reaches the
 * notebook only through `applyParamDrafts`.
 */
export type ParamDrafts = Readonly<Record<string, NotebookParam>>;

export function withParamDraft(drafts: ParamDrafts, draft: NotebookParam): ParamDrafts {
    return {...drafts, [draft.name]: draft};
}

export function withoutParamDraft(drafts: ParamDrafts, name: string): ParamDrafts {
    if (!Object.hasOwn(drafts, name)) return drafts;
    return Object.fromEntries(Object.entries(drafts).filter(([key]) => key !== name));
}

/**
 * The draft the panel shows for `param`, if any. Raw parameters are not
 * drafted: their value takes effect as it is typed, so a raw draft of a raw
 * parameter (left behind by undo) is ignored.
 */
export function draftFor(param: NotebookParam, drafts: ParamDrafts): NotebookParam | undefined {
    const draft = Object.hasOwn(drafts, param.name) ? drafts[param.name] : undefined;
    if (!draft || (!draft.type && !param.type)) return undefined;
    return draft;
}

/** A draft that would change the parameter when applied. */
export function isParamPending(param: NotebookParam, drafts: ParamDrafts): boolean {
    const draft = draftFor(param, drafts);
    return (
        draft !== undefined &&
        JSON.stringify(normalizeParam(draft)) !== JSON.stringify(normalizeParam(param))
    );
}

export function hasPendingParamDrafts(params: NotebookParam[], drafts: ParamDrafts): boolean {
    return params.some((param) => isParamPending(param, drafts));
}

/**
 * Whether Apply can commit: something is pending and every row, drafted or
 * not, is valid, so the applied parameters are never left half-configured.
 */
export function canApplyParamDrafts(params: NotebookParam[], drafts: ParamDrafts): boolean {
    return (
        hasPendingParamDrafts(params, drafts) &&
        params.every((param) => validateParam(draftFor(param, drafts) ?? param) === null)
    );
}

/** The parameters with every draft committed, in stored form. */
export function applyParamDrafts(params: NotebookParam[], drafts: ParamDrafts): NotebookParam[] {
    return params.map((param) => {
        const draft = draftFor(param, drafts);
        return draft ? normalizeParam(draft) : param;
    });
}
