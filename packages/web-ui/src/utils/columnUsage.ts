// Column usage evidence (#1407): finds where one table column is referenced in
// SQL text (view definitions, query history) and says how sure each match is.
// The lexing reuses the splitter's dialect rules, so quotes, comments and
// dollar-quoted bodies follow the active driver's SQL dialect.

import {normalizeDialect, optionsFor, type DialectInput, type DialectOptions} from './sqlSplitter';
import {scanToken, type TokenizerState} from './sqlSplitter/tokenizer';
import type {SavedQueryExcerpt} from './savedQuerySearch';

/** The column being inspected. `schema` is absent on drivers without schemas. */
export interface ColumnUsageTarget {
    table: string;
    column: string;
    schema?: string;
    database?: string;
}

export type ColumnUsageConfidence = 'confirmed' | 'parsed' | 'uncertain';

/** Why a textual match could not be confirmed as a reference to the target column. */
export type UncertainReason =
    | 'unresolved-qualifier'
    | 'unqualified-schema'
    | 'several-tables'
    | 'derived-table'
    | 'alias-conflict'
    | 'wildcard'
    | 'dynamic-sql'
    | 'name-case'
    | 'textual';

export interface SqlColumnMatch {
    confidence: Exclude<ColumnUsageConfidence, 'confirmed'>;
    reason?: UncertainReason;
    /** String offsets of the matching token in the analysed SQL. */
    start: number;
    end: number;
}

export interface RelationRef {
    name: string;
    schema?: string;
}

export interface FindColumnReferencesOptions {
    dialect?: DialectInput;
    /**
     * The schema that unqualified table names resolve to for this SQL (a
     * view's own schema). Left out for query history, where the search path
     * at run time is unknown.
     */
    defaultSchema?: string;
    /** Column names of a table, when known; `undefined` when unknown. */
    columnsOf?: (ref: RelationRef) => readonly string[] | undefined;
}

type LexKind = 'word' | 'quoted' | 'string' | 'number' | 'punct' | 'delimiter';

interface LexToken {
    kind: LexKind;
    /** Identifier value (quotes removed) or the raw text. */
    value: string;
    start: number;
    end: number;
    /** Backtick-quoted identifiers compare without case, like MySQL does. */
    caseInsensitive?: boolean;
}

const WORD_START = /[\p{L}_]/u;
const WORD_CHAR = /[\p{L}\p{N}_$]/u;
const DIGIT = /[0-9]/;
// A digit starts a number unless it continues a name; `$` before it does not
// make it one (MSSQL money literals `$100.50`, placeholders `$1`).
const NAME_CHAR = /[\p{L}\p{N}_]/u;
const MAX_EXECUTABLE_DEPTH = 4;

function identifierRule(source: string, position: number, options: DialectOptions) {
    return options.quotes.find(
        (rule) => rule.kind === 'identifier' && source.startsWith(rule.open, position),
    );
}

function lexInto(
    source: string,
    offset: number,
    options: DialectOptions,
    tokens: LexToken[],
    depth: number,
): void {
    const state: TokenizerState = {delimiter: ';', lineLeading: true};
    let position = 0;
    while (position < source.length) {
        const ch = source[position];
        // Words and numbers are read here: the splitter only returns them one
        // character at a time.
        if (
            WORD_START.test(ch) ||
            (DIGIT.test(ch) && !NAME_CHAR.test(source[position - 1] ?? ''))
        ) {
            const token = scanToken(source, position, options, state);
            if (token && token.kind === 'data' && token.length === 1) {
                let end = position + 1;
                const isNumber = DIGIT.test(ch);
                const pattern = isNumber ? /[0-9A-Za-z_.]/ : WORD_CHAR;
                while (end < source.length && pattern.test(source[end])) end++;
                const raw = source.slice(position, end);
                if (!isNumber && /^[nxbe]$/i.test(raw) && source[end] === "'") {
                    // N'..', X'..', B'..', E'..': the prefix belongs to the literal.
                    const literal = scanToken(source, end, options, state);
                    if (literal?.kind === 'string') {
                        tokens.push({
                            kind: 'string',
                            value: source.slice(position, end + literal.length),
                            start: offset + position,
                            end: offset + end + literal.length,
                        });
                        state.lineLeading = false;
                        position = end + literal.length;
                        continue;
                    }
                }
                tokens.push({
                    kind: isNumber ? 'number' : 'word',
                    value: raw,
                    start: offset + position,
                    end: offset + end,
                });
                state.lineLeading = false;
                position = end;
                continue;
            }
        }
        const token = scanToken(source, position, options, state);
        if (token === null) break;
        const start = offset + position;
        const end = start + token.length;
        switch (token.kind) {
            case 'string': {
                const rule = identifierRule(source, position, options);
                if (rule) {
                    const inner = source.slice(
                        position + rule.open.length,
                        position + token.length - rule.close.length,
                    );
                    tokens.push({
                        kind: 'quoted',
                        value: rule.doubleClose
                            ? inner.replaceAll(rule.close + rule.close, rule.close)
                            : inner,
                        start,
                        end,
                        caseInsensitive: rule.open === '`',
                    });
                } else {
                    tokens.push({
                        kind: 'string',
                        value: source.slice(position, position + token.length),
                        start,
                        end,
                    });
                }
                state.lineLeading = false;
                break;
            }
            case 'data':
                if (token.length > 1 && source.startsWith('/*!', position)) {
                    // MySQL executable comment: its payload is real SQL.
                    if (depth < MAX_EXECUTABLE_DEPTH) {
                        const payload = source.slice(position + 3, position + token.length - 2);
                        const version = /^\d*/.exec(payload)?.[0].length ?? 0;
                        lexInto(
                            payload.slice(version),
                            start + 3 + version,
                            options,
                            tokens,
                            depth + 1,
                        );
                    }
                } else {
                    tokens.push({
                        kind: 'punct',
                        value: source.slice(position, position + token.length),
                        start,
                        end,
                    });
                }
                state.lineLeading = false;
                break;
            case 'delimiter':
            case 'goDelimiter':
            case 'slashDelimiter':
                tokens.push({kind: 'delimiter', value: ';', start, end});
                state.lineLeading = false;
                break;
            case 'setDelimiter':
                if (token.value !== undefined) state.delimiter = token.value;
                state.lineLeading = false;
                break;
            case 'eoln':
                state.lineLeading = true;
                break;
            case 'lineComment':
            case 'blockComment':
                state.lineLeading = false;
                break;
            case 'whitespace':
                break;
        }
        position += token.length;
    }
}

function lex(sql: string, dialect: DialectInput): LexToken[] {
    const tokens: LexToken[] = [];
    lexInto(sql, 0, optionsFor(dialect), tokens, 0);
    return tokens;
}

const isIdent = (token: LexToken | undefined): token is LexToken =>
    token !== undefined && (token.kind === 'word' || token.kind === 'quoted');

const keyword = (token: LexToken | undefined): string =>
    token?.kind === 'word' ? token.value.toUpperCase() : '';

/**
 * How two names compare: exactly, without letter case, or without the case of
 * ASCII letters only (SQLite: `"Ä"` and `"ä"` are two tables).
 */
export type NameMatch = 'exact' | 'insensitive' | 'ascii-insensitive';

const asciiLower = (name: string): string => name.replace(/[A-Z]+/g, (c) => c.toLowerCase());

/**
 * How a dialect identifies names. `fold` is what an unquoted name becomes in
 * the catalog: PostgreSQL folds to lower case and Oracle to upper case, and
 * both keep quoted names as written. `tables` covers database, schema and
 * table names, `columns` column names.
 *
 * Where case sensitivity is a server setting, catalog names compare exactly
 * and SQL that spells a name in another case is reported as uncertain
 * (`tableCaseUncertain`, `columnCaseUncertain`):
 * - MySQL and MariaDB keep database and table names case-sensitive on a
 *   case-sensitive file system (`lower_case_table_names=0`, the Linux
 *   default); column names never are.
 * - SQL Server follows the database collation, which may be case-sensitive.
 *   A dialect with unknown rules is treated the same way.
 *
 * SQLite ignores the case of ASCII letters only.
 */
export interface IdentifierRules {
    fold: 'lower' | 'upper' | 'none';
    tables: NameMatch;
    columns: NameMatch;
    tableCaseUncertain: boolean;
    columnCaseUncertain: boolean;
}

export function identifierRulesFor(dialect: DialectInput): IdentifierRules {
    const name = typeof dialect === 'object' ? dialect.dialect : normalizeDialect(dialect);
    const rules = (
        fold: IdentifierRules['fold'],
        tables: NameMatch,
        columns: NameMatch,
        tableCaseUncertain: boolean,
        columnCaseUncertain: boolean,
    ): IdentifierRules => ({fold, tables, columns, tableCaseUncertain, columnCaseUncertain});
    switch (name) {
        case 'postgres':
            return rules('lower', 'exact', 'exact', false, false);
        case 'oracle':
            return rules('upper', 'exact', 'exact', false, false);
        case 'mysql':
            return rules('none', 'exact', 'insensitive', true, false);
        case 'sqlite':
            return rules('none', 'ascii-insensitive', 'ascii-insensitive', false, false);
        default:
            return rules('none', 'exact', 'exact', true, true);
    }
}

/** A key under which names that compare equal with `match` are the same. */
export function nameKey(name: string, match: NameMatch): string {
    if (match === 'insensitive') return name.toLowerCase();
    if (match === 'ascii-insensitive') return asciiLower(name);
    return name;
}

/** Whether two names, both as the catalog reports them, are the same object. */
export function catalogNamesEqual(a: string, b: string, match: NameMatch): boolean {
    return nameKey(a, match) === nameKey(b, match);
}

/** The catalog spelling of an identifier written in SQL. */
function catalogName(token: LexToken, rules: IdentifierRules): string {
    if (token.kind === 'quoted' && !token.caseInsensitive) return token.value;
    // PostgreSQL only folds ASCII letters.
    if (rules.fold === 'lower') return asciiLower(token.value);
    if (rules.fold === 'upper') return token.value.toUpperCase();
    return token.value;
}

function identEquals(
    token: LexToken,
    name: string,
    rules: IdentifierRules,
    match: NameMatch,
): boolean {
    return catalogNamesEqual(catalogName(token, rules), name, match);
}

// Words that end a FROM list or cannot be a table alias.
const NOT_ALIAS = new Set([
    'ON',
    'USING',
    'WHERE',
    'GROUP',
    'ORDER',
    'HAVING',
    'LIMIT',
    'OFFSET',
    'FETCH',
    'UNION',
    'INTERSECT',
    'EXCEPT',
    'MINUS',
    'JOIN',
    'INNER',
    'LEFT',
    'RIGHT',
    'FULL',
    'OUTER',
    'CROSS',
    'NATURAL',
    'STRAIGHT_JOIN',
    'SET',
    'VALUES',
    'VALUE',
    'SELECT',
    'RETURNING',
    'WINDOW',
    'FOR',
    'LATERAL',
    'TABLESAMPLE',
    'QUALIFY',
    'WITH',
    'AS',
    'PARTITION',
    'DEFAULT',
    'OUTPUT',
    'WHEN',
    'THEN',
    'INTO',
    'FROM',
    'UPDATE',
    'DELETE',
    'INSERT',
    'MERGE',
    'APPLY',
    'PIVOT',
    'UNPIVOT',
    'CONNECT',
    'START',
    'USE',
    'IGNORE',
    'FORCE',
    'ONLY',
    'AND',
    'OR',
    'NOT',
    'IS',
    'IN',
]);

// Words after which the next name is a relation.
const RELATION_KEYWORDS = new Set(['FROM', 'JOIN', 'UPDATE', 'INTO', 'TABLE', 'STRAIGHT_JOIN']);

// Words that end a comma-separated FROM (or UPDATE) list at their depth.
const LIST_END = new Set([
    'WHERE',
    'GROUP',
    'ORDER',
    'HAVING',
    'LIMIT',
    'OFFSET',
    'FETCH',
    'UNION',
    'INTERSECT',
    'EXCEPT',
    'MINUS',
    'SET',
    'VALUES',
    'SELECT',
    'RETURNING',
    'WINDOW',
    'QUALIFY',
    'FOR',
    'WHEN',
]);

// Words that may stand between SELECT and a bare `*`.
const SELECT_MODIFIERS = new Set([
    'ALL',
    'DISTINCT',
    'DISTINCTROW',
    'UNIQUE',
    'HIGH_PRIORITY',
    'STRAIGHT_JOIN',
    'SQL_SMALL_RESULT',
    'SQL_BIG_RESULT',
    'SQL_BUFFER_RESULT',
    'SQL_NO_CACHE',
    'SQL_CACHE',
    'SQL_CALC_FOUND_ROWS',
]);

const SET_OPERATORS = new Set(['UNION', 'INTERSECT', 'EXCEPT', 'MINUS']);

const DYNAMIC_SQL_WORDS = new Set(['EXECUTE', 'EXEC', 'PREPARE', 'SP_EXECUTESQL']);

interface Binding {
    /** Undefined for derived tables, table functions and CTEs. */
    ref?: RelationRef;
    /** The query level (see `computeScopes`) whose FROM list holds it. */
    scope: number;
    /** Index of the token where the relation starts. */
    at: number;
}

interface StatementModel {
    tokens: LexToken[];
    /** Query level of each token: 0 for the statement, one per subquery. */
    scopes: number[];
    /** Enclosing query level of each subquery level. */
    parents: Map<number, number>;
    /** Index of the parenthesis that opens each subquery level. */
    opens: Map<number, number>;
    /** alias (lower-cased) → bindings it was given in this statement. */
    bindings: Map<string, Binding[]>;
    relations: Binding[];
    /** Token indexes that name relations or aliases, never columns. */
    nameTokens: Set<number>;
}

function skipParens(tokens: LexToken[], open: number): number {
    let depth = 0;
    for (let i = open; i < tokens.length; i++) {
        if (tokens[i].value === '(' && tokens[i].kind === 'punct') depth++;
        else if (tokens[i].value === ')' && tokens[i].kind === 'punct') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return tokens.length - 1;
}

interface CteDefinition {
    name: string;
    bodyOpen: number;
    bodyClose: number;
    recursive: boolean;
    /** Index of the parenthesis that closes the query the WITH belongs to. */
    visibleUntil: number;
}

// The closing parenthesis of the level `from` is in, or the end of the tokens.
function enclosingClose(tokens: LexToken[], from: number): number {
    let depth = 0;
    for (let k = from; k < tokens.length; k++) {
        if (tokens[k].kind !== 'punct') continue;
        if (tokens[k].value === '(') depth++;
        else if (tokens[k].value === ')') {
            if (depth === 0) return k;
            depth--;
        }
    }
    return tokens.length;
}

function collectCtes(tokens: LexToken[]): CteDefinition[] {
    const ctes: CteDefinition[] = [];
    for (let i = 0; i < tokens.length; i++) {
        if (keyword(tokens[i]) !== 'WITH') continue;
        let j = i + 1;
        const recursive = keyword(tokens[j]) === 'RECURSIVE';
        if (recursive) j++;
        const visibleUntil = enclosingClose(tokens, i);
        while (isIdent(tokens[j])) {
            const name = tokens[j].value.toLowerCase();
            j++;
            if (tokens[j]?.value === '(') j = skipParens(tokens, j) + 1;
            if (keyword(tokens[j]) !== 'AS') break;
            j++;
            if (keyword(tokens[j]) === 'NOT') j++;
            if (keyword(tokens[j]) === 'MATERIALIZED') j++;
            if (tokens[j]?.value !== '(') break;
            const bodyClose = skipParens(tokens, j);
            ctes.push({name, bodyOpen: j, bodyClose, recursive, visibleUntil});
            j = bodyClose + 1;
            if (tokens[j]?.value !== ',') break;
            j++;
        }
    }
    return ctes;
}

// A CTE name hides a table only after its own body (or inside it, when
// recursive) and up to the end of the query that defines it.
function isCteAt(ctes: CteDefinition[], name: string, index: number): boolean {
    const key = name.toLowerCase();
    return ctes.some(
        (cte) =>
            cte.name === key &&
            index < cte.visibleUntil &&
            (index > cte.bodyClose ||
                (cte.recursive && index > cte.bodyOpen && index < cte.bodyClose)),
    );
}

// A parenthesis that opens with SELECT or WITH starts a new query level;
// any other (function arguments, IN lists, column lists) stays in its level.
// A UNION / INTERSECT / EXCEPT of a level starts a sibling level for the
// query after it, with the same parent, so each side has its own tables.
function computeScopes(tokens: LexToken[]): {
    scopes: number[];
    parents: Map<number, number>;
    opens: Map<number, number>;
} {
    const scopes: number[] = [];
    const parents = new Map<number, number>();
    const opens = new Map<number, number>();
    // Each frame: its query level, and whether it is that level's own
    // frame (the statement or a SELECT/WITH parenthesis).
    const stack: {level: number; own: boolean}[] = [{level: 0, own: true}];
    let next = 1;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.kind === 'punct' && token.value === ')' && stack.length > 1) {
            stack.pop();
        }
        const top = stack[stack.length - 1];
        scopes.push(top.level);
        if (token.kind === 'punct' && token.value === '(') {
            const first = keyword(tokens[i + 1]);
            if (first === 'SELECT' || first === 'WITH') {
                parents.set(next, top.level);
                opens.set(next, i);
                stack.push({level: next++, own: true});
            } else {
                stack.push({level: top.level, own: false});
            }
        } else if (top.own && SET_OPERATORS.has(keyword(token))) {
            const parent = parents.get(top.level);
            if (parent !== undefined) parents.set(next, parent);
            const open = opens.get(top.level);
            if (open !== undefined) opens.set(next, open);
            stack[stack.length - 1] = {level: next++, own: true};
        }
    }
    return {scopes, parents, opens};
}

function buildModel(tokens: LexToken[], rule: IdentifierRules): StatementModel {
    const {scopes, parents, opens} = computeScopes(tokens);
    const model: StatementModel = {
        tokens,
        scopes,
        parents,
        opens,
        bindings: new Map(),
        relations: [],
        nameTokens: new Set(),
    };
    const ctes = collectCtes(tokens);
    const listDepths = new Set<number>();
    let depth = 0;

    const bind = (alias: string, binding: Binding) => {
        const key = alias.toLowerCase();
        const list = model.bindings.get(key) ?? [];
        list.push(binding);
        model.bindings.set(key, list);
    };

    // Derived tables: the index of their closing parenthesis. Their body is
    // walked like the rest of the statement and the alias read after it.
    const derivedCloses = new Set<number>();
    // Parenthesised joins `(a JOIN b ON ...)`: the index of their opening
    // parenthesis. Their tables are read like a FROM list one level deeper.
    const joinGroups = new Set<number>();

    const readAlias = (start: number, binding: Binding, defaultAlias?: string): number => {
        let i = start;
        if (keyword(tokens[i]) === 'AS') i++;
        const aliasToken = tokens[i];
        if (
            isIdent(aliasToken) &&
            !(aliasToken.kind === 'word' && NOT_ALIAS.has(keyword(aliasToken)))
        ) {
            model.nameTokens.add(i);
            bind(aliasToken.value, binding);
            i++;
            // Column alias list: `AS t(a, b)`.
            if (tokens[i]?.value === '(') {
                const close = skipParens(tokens, i);
                for (let k = i + 1; k < close; k++) model.nameTokens.add(k);
                i = close + 1;
            }
            return i;
        }
        if (defaultAlias) bind(defaultAlias, binding);
        return start;
    };

    // Reads one relation starting at `start`; returns the index after what it
    // consumed. A derived table consumes nothing but its leading keywords.
    const readRelation = (start: number, allowFunction: boolean): number => {
        let i = start;
        while (['LATERAL', 'ONLY', 'TABLE'].includes(keyword(tokens[i]))) i++;
        let binding: Binding;
        let defaultAlias: string | undefined;
        if (tokens[i]?.value === '(') {
            const first = tokens[i + 1];
            const close = skipParens(tokens, i);
            // `((SELECT ...)) d` is one derived table in extra parentheses, and
            // `((SELECT ...) UNION (SELECT ...)) d` one made of a set operation.
            const innerClose = tokens[i + 1]?.value === '(' ? skipParens(tokens, i + 1) : undefined;
            const wrapsQuery =
                innerClose !== undefined &&
                ['SELECT', 'WITH', 'VALUES'].includes(keyword(tokens[i + 2])) &&
                (innerClose === close - 1 || SET_OPERATORS.has(keyword(tokens[innerClose + 1])));
            if (
                (isIdent(first) || (tokens[i + 1]?.value === '(' && !wrapsQuery)) &&
                !['SELECT', 'WITH', 'VALUES', 'TABLE'].includes(keyword(first))
            ) {
                joinGroups.add(i);
                return i;
            }
            derivedCloses.add(close);
            model.relations.push({scope: scopes[i], at: i});
            return i;
        } else if (isIdent(tokens[i])) {
            const parts: LexToken[] = [tokens[i]];
            model.nameTokens.add(i);
            i++;
            while (tokens[i]?.value === '.' && isIdent(tokens[i + 1]) && parts.length < 3) {
                parts.push(tokens[i + 1]);
                model.nameTokens.add(i + 1);
                i += 2;
            }
            const name = parts[parts.length - 1].value;
            const schemaPart = parts.length > 1 ? parts[parts.length - 2] : undefined;
            const schema = schemaPart && catalogName(schemaPart, rule);
            defaultAlias = name;
            if (allowFunction && tokens[i]?.value === '(') {
                // Table function: its columns are not the table's.
                i = skipParens(tokens, i) + 1;
                binding = {scope: scopes[start], at: start};
            } else if (!schema && isCteAt(ctes, name, start)) {
                binding = {scope: scopes[start], at: start};
            } else {
                const refName = catalogName(parts[parts.length - 1], rule);
                binding = {
                    ref: schema ? {name: refName, schema} : {name: refName},
                    scope: scopes[start],
                    at: start,
                };
            }
        } else {
            return i;
        }
        // `INSERT INTO t (a, b)`: the list is t's columns, never an alias,
        // since readAlias only takes an identifier.
        i = readAlias(i, binding, defaultAlias);
        model.relations.push(binding);
        return i;
    };

    const verbBefore = (index: number, verbs: string[]): boolean => {
        for (let k = index - 1; k >= 0; k--) {
            if (scopes[k] === scopes[index] && verbs.includes(keyword(tokens[k]))) return true;
        }
        return false;
    };

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.kind === 'punct') {
            if (token.value === '(') {
                depth++;
                if (joinGroups.has(i)) {
                    listDepths.add(depth);
                    const next = readRelation(i + 1, true);
                    if (next > i + 1) i = next - 1;
                }
            } else if (token.value === ')') {
                listDepths.delete(depth);
                depth = Math.max(0, depth - 1);
                if (derivedCloses.has(i)) {
                    const next = readAlias(i + 1, {scope: scopes[i], at: i});
                    if (next > i + 1) i = next - 1;
                }
            } else if (token.value === ',' && listDepths.has(depth)) {
                const next = readRelation(i + 1, true);
                if (next > i + 1) i = next - 1;
            }
            continue;
        }
        const word = keyword(token);
        if (!word) continue;
        if (LIST_END.has(word)) listDepths.delete(depth);
        // `ON DUPLICATE KEY UPDATE a = 1, b = 2` / `ON CONFLICT ... DO UPDATE`.
        if (word === 'ON' && ['DUPLICATE', 'CONFLICT'].includes(keyword(tokens[i + 1])))
            listDepths.delete(depth);
        if (RELATION_KEYWORDS.has(word)) {
            // `DELETE t FROM`, `INSERT INTO`, `UPDATE t SET` and `FROM a, b`.
            if (word === 'TABLE' && keyword(tokens[i - 1]) !== 'LOCK') continue;
            if (word === 'UPDATE' && ['KEY', 'FOR', 'DO', 'THEN'].includes(keyword(tokens[i - 1])))
                continue;
            if (word === 'FROM' && keyword(tokens[i - 1]) === 'DISTINCT') continue;
            if (tokens[i + 1]?.value === '(' && word !== 'FROM' && word !== 'JOIN') continue;
            if (word === 'FROM' || word === 'UPDATE') listDepths.add(depth);
            const next = readRelation(i + 1, word === 'FROM' || word === 'JOIN');
            if (next > i + 1) i = next - 1;
        } else if (
            word === 'USING' &&
            tokens[i + 1]?.value !== '(' &&
            verbBefore(i, ['DELETE', 'MERGE'])
        ) {
            // `DELETE FROM a USING b` (PostgreSQL), `DELETE FROM a USING a JOIN b`
            // (MySQL) and `MERGE INTO a USING b`; not `EXECUTE ... USING var`.
            listDepths.add(depth);
            const next = readRelation(i + 1, true);
            if (next > i + 1) i = next - 1;
        }
    }
    return model;
}

type TableMatch = 'match' | 'case-differs' | 'schema-unknown' | 'other-qualifier' | 'no';

/** `ref` holds catalog spellings (see `catalogName`). */
function matchRelation(
    ref: RelationRef,
    target: ColumnUsageTarget,
    defaultSchema: string | undefined,
    rules: IdentifierRules,
): TableMatch {
    // A name in SQL that differs from the catalog's only by case may or may
    // not be the same table (see `IdentifierRules.tableCaseUncertain`).
    let caseDiffers = false;
    const same = (written: string, catalog: string): boolean => {
        if (catalogNamesEqual(written, catalog, rules.tables)) return true;
        if (rules.tableCaseUncertain && catalogNamesEqual(written, catalog, 'insensitive')) {
            caseDiffers = true;
            return true;
        }
        return false;
    };
    const matched = (): TableMatch => (caseDiffers ? 'case-differs' : 'match');
    if (!same(ref.name, target.table)) return 'no';
    if (ref.schema !== undefined) {
        if (target.schema !== undefined) return same(ref.schema, target.schema) ? matched() : 'no';
        if (target.database !== undefined && same(ref.schema, target.database)) return matched();
        return 'other-qualifier';
    }
    if (target.schema === undefined) return matched();
    if (
        defaultSchema !== undefined &&
        catalogNamesEqual(defaultSchema, target.schema, rules.tables)
    )
        return matched();
    return 'schema-unknown';
}

function splitStatementsByTokens(tokens: LexToken[]): LexToken[][] {
    const statements: LexToken[][] = [];
    let current: LexToken[] = [];
    for (const token of tokens) {
        if (token.kind === 'delimiter') {
            if (current.length) statements.push(current);
            current = [];
        } else {
            current.push(token);
        }
    }
    if (current.length) statements.push(current);
    return statements;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const wordBoundaryPattern = (name: string): RegExp =>
    new RegExp(`(^|[^\\p{L}\\p{N}_$])${escapeRegExp(name)}(?![\\p{L}\\p{N}_$])`, 'iu');

function analyseStatement(
    tokens: LexToken[],
    target: ColumnUsageTarget,
    options: FindColumnReferencesOptions,
): SqlColumnMatch[] {
    const rule = identifierRulesFor(options.dialect);
    // A mention of the table in any case counts where the case is uncertain.
    const tableMention: NameMatch = rule.tableCaseUncertain ? 'insensitive' : rule.tables;
    const model = buildModel(tokens, rule);
    const matches: SqlColumnMatch[] = [];
    const tableRelations = model.relations.filter((r) => r.ref);
    const relationVerdicts = tableRelations.map((r) =>
        matchRelation(r.ref!, target, options.defaultSchema, rule),
    );
    const targetInStatement = relationVerdicts.some((v) => v !== 'no');
    const targetNameMentioned = tokens.some(
        (t) => isIdent(t) && identEquals(t, target.table, rule, tableMention),
    );

    const uncertain = (token: LexToken, reason: UncertainReason): SqlColumnMatch => ({
        confidence: 'uncertain',
        reason,
        start: token.start,
        end: token.end,
    });

    const resolveVerdict = (verdict: TableMatch): 'parsed' | UncertainReason | null => {
        if (verdict === 'match') return 'parsed';
        if (verdict === 'case-differs') return 'name-case';
        if (verdict === 'schema-unknown') return 'unqualified-schema';
        if (verdict === 'other-qualifier') return 'unresolved-qualifier';
        return null;
    };

    const matchingOpen = (close: number): number => {
        let depth = 0;
        for (let k = close; k >= 0; k--) {
            if (tokens[k].kind !== 'punct') continue;
            if (tokens[k].value === ')') depth++;
            else if (tokens[k].value === '(' && --depth === 0) return k;
        }
        return 0;
    };

    // The SELECT (or RETURNING) whose column list holds the bare `*` at
    // `index`, past `TOP n`, `DISTINCT ON (..)` and MySQL modifiers; undefined
    // when that `*` is not a select-list item (a product, `count(*)`).
    const selectListStart = (index: number): number | undefined => {
        const scope = model.scopes[index];
        let j = index - 1;
        if (tokens[j]?.value === ',') {
            // Walk back over earlier select items to their SELECT, jumping over
            // parentheses (`EXTRACT(YEAR FROM d)`, `OVER (ORDER BY id)`) and
            // `CASE ... END`, whose keywords say nothing about the list.
            for (let k = j - 1; k >= 0; k--) {
                const current = tokens[k];
                if (current.kind === 'punct' && current.value === ')') {
                    k = matchingOpen(k);
                    continue;
                }
                if (model.scopes[k] !== scope) continue;
                const word = keyword(current);
                if (word === 'END') {
                    let nesting = 0;
                    for (; k >= 0; k--) {
                        const inner = keyword(tokens[k]);
                        if (inner === 'END') nesting++;
                        else if (inner === 'CASE' && --nesting === 0) break;
                    }
                    continue;
                }
                if (word === 'SELECT' || word === 'RETURNING') return k;
                if (LIST_END.has(word) || RELATION_KEYWORDS.has(word)) return undefined;
            }
            return undefined;
        }
        if (keyword(tokens[j]) === 'TIES' && keyword(tokens[j - 1]) === 'WITH') j -= 2;
        if (keyword(tokens[j]) === 'PERCENT') j--;
        if (tokens[j]?.kind === 'number' && keyword(tokens[j - 1]) === 'TOP') {
            j -= 2;
        } else if (tokens[j]?.kind === 'punct' && tokens[j].value === ')') {
            const open = matchingOpen(j);
            if (keyword(tokens[open - 1]) === 'TOP') j = open - 2;
            else if (keyword(tokens[open - 1]) === 'ON' && keyword(tokens[open - 2]) === 'DISTINCT')
                j = open - 3;
            else return undefined;
        }
        while (SELECT_MODIFIERS.has(keyword(tokens[j]))) j--;
        const word = keyword(tokens[j]);
        return word === 'SELECT' || word === 'RETURNING' ? j : undefined;
    };

    // A bare `*` reads the target column when a table of its own SELECT (up
    // to the next UNION/INTERSECT/EXCEPT of that level) is the target. Inside
    // EXISTS (..) the columns are never read.
    const wildcardExpandsTarget = (index: number, listStart: number): boolean => {
        const scope = model.scopes[index];
        const open = model.opens.get(scope);
        if (open !== undefined && keyword(tokens[open - 1]) === 'EXISTS') return false;
        let from = -1;
        let until = tokens.length;
        if (keyword(tokens[listStart]) === 'SELECT') {
            from = listStart;
            for (let k = listStart + 1; k < tokens.length; k++) {
                if (model.scopes[k] === scope && SET_OPERATORS.has(keyword(tokens[k]))) {
                    until = k;
                    break;
                }
            }
        }
        return model.relations.some(
            (r) =>
                r.scope === scope &&
                r.at > from &&
                r.at < until &&
                r.ref !== undefined &&
                resolveVerdict(matchRelation(r.ref, target, options.defaultSchema, rule)) !== null,
        );
    };

    let wildcardSeen = false;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (token.kind === 'punct' && token.value === '*' && !wildcardSeen) {
            const prev = tokens[i - 1];
            const listStart = prev?.value === '.' ? undefined : selectListStart(i);
            if (listStart !== undefined) {
                if (wildcardExpandsTarget(i, listStart)) {
                    wildcardSeen = true;
                    matches.push(uncertain(token, 'wildcard'));
                }
            } else if (prev?.value === '.' && isIdent(tokens[i - 2])) {
                const bindings = model.bindings.get(tokens[i - 2].value.toLowerCase()) ?? [];
                if (
                    bindings.some(
                        (b) =>
                            b.ref &&
                            resolveVerdict(
                                matchRelation(b.ref, target, options.defaultSchema, rule),
                            ),
                    )
                ) {
                    wildcardSeen = true;
                    matches.push(uncertain(token, 'wildcard'));
                }
            }
            continue;
        }

        if (!isIdent(token) || model.nameTokens.has(i)) continue;
        const columnName = catalogName(token, rule);
        // Where column case is a server setting, another case is uncertain.
        const columnCaseOnly =
            !catalogNamesEqual(columnName, target.column, rule.columns) &&
            rule.columnCaseUncertain &&
            catalogNamesEqual(columnName, target.column, 'insensitive');
        if (!columnCaseOnly && !catalogNamesEqual(columnName, target.column, rule.columns))
            continue;
        const resolved = (): SqlColumnMatch =>
            columnCaseOnly
                ? uncertain(token, 'name-case')
                : {confidence: 'parsed', start: token.start, end: token.end};
        const next = tokens[i + 1];
        if (next?.value === '.') continue; // a qualifier, not a column
        if (next?.value === '(' && token.kind === 'word') continue; // a function call
        if (keyword(tokens[i - 1]) === 'AS') continue; // an output alias

        if (tokens[i - 1]?.value === '.' && isIdent(tokens[i - 2])) {
            const qualifier = tokens[i - 2];
            const outer =
                tokens[i - 3]?.value === '.' && isIdent(tokens[i - 4]) ? tokens[i - 4] : undefined;
            if (outer) {
                // schema.table.column
                const verdict = resolveVerdict(
                    matchRelation(
                        {name: catalogName(qualifier, rule), schema: catalogName(outer, rule)},
                        target,
                        options.defaultSchema,
                        rule,
                    ),
                );
                if (verdict === 'parsed') matches.push(resolved());
                else if (verdict) matches.push(uncertain(token, verdict));
                continue;
            }
            const bindings = model.bindings.get(qualifier.value.toLowerCase());
            if (!bindings) {
                if (targetInStatement || identEquals(qualifier, target.table, rule, tableMention)) {
                    matches.push(uncertain(token, 'unresolved-qualifier'));
                }
                continue;
            }
            const verdicts = bindings.map((b) =>
                b.ref
                    ? resolveVerdict(matchRelation(b.ref, target, options.defaultSchema, rule))
                    : 'derived-table',
            );
            const relevant = verdicts.filter((v): v is 'parsed' | UncertainReason => v !== null);
            if (relevant.length === 0) continue;
            if (bindings.length > 1 && new Set(verdicts).size > 1) {
                matches.push(uncertain(token, 'alias-conflict'));
            } else if (relevant[0] === 'derived-table') {
                if (targetInStatement) matches.push(uncertain(token, 'derived-table'));
            } else if (relevant[0] === 'parsed') {
                matches.push(resolved());
            } else {
                matches.push(uncertain(token, relevant[0]));
            }
            continue;
        }

        // Unqualified column: it belongs to a table of its own query level, or
        // (a correlated reference) of an enclosing level when no table of the
        // inner levels has a column of that name.
        const mayHaveColumn = (relation: Binding): 'yes' | 'unknown' | 'no' => {
            if (!relation.ref) return 'unknown';
            const columns = options.columnsOf?.(relation.ref);
            if (!columns) return 'unknown';
            return columns.some((c) => catalogNamesEqual(c, target.column, rule.columns))
                ? 'yes'
                : 'no';
        };
        let scope: number | undefined = model.scopes[i];
        let shadowed = false;
        let decided = false;
        while (scope !== undefined && !decided) {
            const level = scope;
            const candidates = model.relations.filter((r) => r.scope === level);
            const verdicts = candidates.map((r) =>
                r.ref ? matchRelation(r.ref, target, options.defaultSchema, rule) : 'no',
            );
            const others = candidates.filter((_, k) => verdicts[k] === 'no').map(mayHaveColumn);
            if (verdicts.some((v) => v !== 'no')) {
                decided = true;
                const best = verdicts.includes('match')
                    ? 'parsed'
                    : resolveVerdict(verdicts.find((v) => v !== 'no')!);
                // `orders` and `Orders` may be two tables that both have it.
                const caseTwin = verdicts.includes('match') && verdicts.includes('case-differs');
                if (shadowed || caseTwin || others.some((o) => o !== 'no')) {
                    matches.push(uncertain(token, 'several-tables'));
                } else if (best === 'parsed') {
                    matches.push(resolved());
                } else if (best) {
                    matches.push(uncertain(token, best));
                }
            } else if (others.includes('yes')) {
                decided = true; // another table of this level owns the column
            } else {
                if (others.includes('unknown')) shadowed = true;
                scope = model.parents.get(level);
            }
        }
        if (!decided && model.relations.length === 0 && targetNameMentioned) {
            matches.push(uncertain(token, 'textual'));
        }
    }

    // Dynamic SQL: the column may only appear inside a string that is run.
    if (tokens.some((t) => DYNAMIC_SQL_WORDS.has(keyword(t)))) {
        const column = wordBoundaryPattern(target.column);
        const table = wordBoundaryPattern(target.table);
        for (const token of tokens) {
            if (token.kind !== 'string' || !column.test(token.value)) continue;
            if (targetNameMentioned || table.test(token.value)) {
                matches.push(uncertain(token, 'dynamic-sql'));
            }
        }
    }
    return matches;
}

/**
 * Every place in `sql` that may read or write `target`'s column, each marked
 * `parsed` (the table is resolved through its name or alias) or `uncertain`
 * (with the reason). A column of the same name on another table is never a
 * match.
 */
export function findColumnReferences(
    sql: string,
    target: ColumnUsageTarget,
    options: FindColumnReferencesOptions = {},
): SqlColumnMatch[] {
    if (!sql || !target.column || !target.table) return [];
    return splitStatementsByTokens(lex(sql, options.dialect)).flatMap((tokens) =>
        analyseStatement(tokens, target, options),
    );
}

/** The strongest match first: parsed before uncertain, then by position. */
export function strongestMatch(matches: readonly SqlColumnMatch[]): SqlColumnMatch | undefined {
    return [...matches].sort(
        (a, b) =>
            (a.confidence === 'parsed' ? 0 : 1) - (b.confidence === 'parsed' ? 0 : 1) ||
            a.start - b.start,
    )[0];
}

interface RedactedSegment {
    start: number;
    end: number;
    text: string;
}

// Every literal becomes a placeholder, and every stretch between tokens that
// holds more than whitespace (a `--`, `#` or block comment, or text the lexer
// skipped) becomes a single space: comments often carry ids, emails or notes.
function redactedSegments(sql: string, dialect: DialectInput): RedactedSegment[] {
    const segments: RedactedSegment[] = [];
    let previousEnd = 0;
    const gap = (end: number) => {
        if (end > previousEnd && /\S/.test(sql.slice(previousEnd, end))) {
            segments.push({start: previousEnd, end, text: ' '});
        }
    };
    for (const token of lex(sql, dialect)) {
        gap(token.start);
        previousEnd = token.end;
        if (token.kind === 'string')
            segments.push({start: token.start, end: token.end, text: "'?'"});
        else if (token.kind === 'number')
            segments.push({start: token.start, end: token.end, text: '?'});
    }
    gap(sql.length);
    return segments;
}

/** `sql` with every string and number literal replaced by a placeholder and comments kept out. */
export function redactSqlLiterals(sql: string, dialect?: DialectInput): string {
    const tokens = lex(sql, dialect);
    let out = '';
    let last: LexToken | undefined;
    for (const token of tokens) {
        if (last) {
            const gap = sql.slice(last.end, token.start);
            out += gap.length === 0 ? '' : /\n/.test(gap) && !/\S/.test(gap) ? '\n' : ' ';
        }
        if (token.kind === 'string') out += "'?'";
        else if (token.kind === 'number') out += '?';
        else out += sql.slice(token.start, token.end);
        last = token;
    }
    return out;
}

/** A redacted one-line excerpt, split around the match like a saved-query search hit. */
export interface UsageSnippet extends SavedQueryExcerpt {
    /** The whole excerpt on one line, with `…` where it was cut. */
    text: string;
}

/**
 * A one-line excerpt of `sql` around `[start, end)`, with literals replaced
 * by placeholders so values never leave the history or the view body.
 */
export function buildUsageSnippet(
    sql: string,
    start: number,
    end: number,
    dialect?: DialectInput,
    context = 60,
): UsageSnippet {
    // Cut the window at whitespace so it never starts or ends inside a word.
    let from = Math.max(0, start - context);
    while (from > 0 && from < start && !/\s/.test(sql[from - 1])) from++;
    let to = Math.min(sql.length, end + context);
    while (to < sql.length && to > end && !/\s/.test(sql[to])) to--;
    let text = '';
    let highlightStart = -1;
    let highlightEnd = -1;
    let position = from;
    const plain = (until: number) => {
        if (until <= position) return;
        if (highlightStart < 0 && start >= position && start < until) {
            highlightStart = text.length + (start - position);
        }
        if (highlightEnd < 0 && end > position && end <= until) {
            highlightEnd = text.length + (end - position);
        }
        text += sql.slice(position, until);
        position = until;
    };
    for (const segment of redactedSegments(sql, dialect)) {
        if (segment.end <= from || segment.start >= to) continue;
        plain(Math.max(segment.start, from));
        if (highlightStart < 0 && start < segment.end && end > segment.start) {
            highlightStart = text.length;
            highlightEnd = text.length + segment.text.length;
        }
        text += segment.text;
        position = Math.min(segment.end, to);
    }
    plain(to);
    if (highlightStart < 0) highlightStart = text.length;
    if (highlightEnd < highlightStart) highlightEnd = highlightStart;

    // Collapse whitespace runs while keeping the highlight aligned.
    let collapsed = '';
    let newStart = 0;
    let newEnd = 0;
    for (let i = 0; i <= text.length; i++) {
        if (i === highlightStart) newStart = collapsed.length;
        if (i === highlightEnd) newEnd = collapsed.length;
        if (i === text.length) break;
        if (/\s/.test(text[i])) {
            if (collapsed.length > 0 && !collapsed.endsWith(' ')) collapsed += ' ';
        } else {
            collapsed += text[i];
        }
    }
    const trimmed = collapsed.trimEnd();
    const truncatedStart = from > 0;
    const truncatedEnd = to < sql.length;
    const matchStart = Math.min(newStart, trimmed.length);
    const matchEnd = Math.min(newEnd, trimmed.length);
    return {
        text: (truncatedStart ? '… ' : '') + trimmed + (truncatedEnd ? ' …' : ''),
        before: trimmed.slice(0, matchStart),
        match: trimmed.slice(matchStart, matchEnd),
        after: trimmed.slice(matchEnd),
        truncatedStart,
        truncatedEnd,
    };
}
