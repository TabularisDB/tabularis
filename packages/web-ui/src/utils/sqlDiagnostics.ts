/**
 * Metadata-aware diagnostics for a documented subset of PostgreSQL SELECT.
 *
 * Supported subset:
 *   - `SELECT` / `WITH [RECURSIVE]` statements, set operations
 *     (`UNION` / `INTERSECT` / `EXCEPT`) and parenthesized queries
 *   - tables, views, schema-qualified names, table aliases and column alias lists
 *   - `JOIN ... ON` and `JOIN ... USING`
 *   - CTEs and derived tables (`(SELECT ...) AS t`, including `LATERAL` subqueries)
 *   - scalar, `IN` and `EXISTS` subqueries, with correlated references
 *   - `SELECT *` / `alias.*` expansion, output aliases in `ORDER BY` / `GROUP BY`
 *
 * What is reported:
 *   - error:   a column, or a table alias, that cannot exist; an ambiguous column.
 *              Only raised when every source in scope has fully known columns.
 *   - warning: a relation missing from the loaded metadata (it may be a
 *              temporary table, or created after the metadata was read).
 *   - info:    an analysis limitation. The construct is skipped and references
 *              that depend on it are never flagged.
 *
 * Anything outside the subset (other statement types, vendor extensions) is
 * ignored rather than flagged: the server stays authoritative, and this module
 * never executes SQL or rewrites it.
 */

export type SqlDiagnosticSeverity = 'error' | 'warning' | 'info';

export type SqlDiagnosticCode =
    | 'unresolvedRelation'
    | 'unresolvedColumn'
    | 'unresolvedAlias'
    | 'ambiguousColumn'
    | 'unsupportedConstruct'
    | 'metadataUnavailable';

export interface SqlDiagnostic {
    code: SqlDiagnosticCode;
    severity: SqlDiagnosticSeverity;
    /** Offsets into the analyzed text; `end` is exclusive. */
    start: number;
    end: number;
    /** The column, relation, alias or construct the message talks about. */
    name: string;
}

export interface RelationRequest {
    schema?: string;
    name: string;
}

export type RelationLookup =
    {status: 'found'; columns: readonly string[]} | {status: 'missing'} | {status: 'unknown'};

export type RelationResolver = (request: RelationRequest) => Promise<RelationLookup>;

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

type TokenKind = 'word' | 'quoted' | 'number' | 'string' | 'param' | 'symbol';

interface Token {
    kind: TokenKind;
    /** Raw source text. */
    text: string;
    /** Folded identifier for words (lowercase) and quoted identifiers (unescaped). */
    value: string;
    start: number;
    end: number;
}

const WORD_START = /[\p{L}_]/u;
const WORD_PART = /[\p{L}\p{N}_$]/u;
const DOLLAR_TAG = /^\$(?:[\p{L}_][\p{L}\p{N}_]*)?\$/u;
const STRING_PREFIXES = new Set(['e', 'b', 'x', 'n']);

// Returns null for an unterminated string, quoted identifier, comment or
// dollar-quoted body: that is a draft in progress, not something to analyze.
function lex(sql: string): Token[] | null {
    const tokens: Token[] = [];
    const push = (kind: TokenKind, start: number, end: number, value?: string) => {
        const text = sql.slice(start, end);
        tokens.push({kind, text, value: value ?? text, start, end});
    };

    let i = 0;
    while (i < sql.length) {
        const c = sql[i];
        if (/\s/.test(c)) {
            i++;
            continue;
        }
        if (c === '-' && sql[i + 1] === '-') {
            while (i < sql.length && sql[i] !== '\n') i++;
            continue;
        }
        if (c === '/' && sql[i + 1] === '*') {
            let depth = 1;
            i += 2;
            while (i < sql.length && depth > 0) {
                if (sql[i] === '/' && sql[i + 1] === '*') {
                    depth++;
                    i += 2;
                } else if (sql[i] === '*' && sql[i + 1] === '/') {
                    depth--;
                    i += 2;
                } else {
                    i++;
                }
            }
            if (depth > 0) return null;
            continue;
        }
        if (c === "'") {
            const end = scanString(sql, i, false);
            if (end < 0) return null;
            push('string', i, end);
            i = end;
            continue;
        }
        if (c === '"') {
            let j = i + 1;
            let value = '';
            for (;;) {
                if (j >= sql.length) return null;
                if (sql[j] === '"') {
                    if (sql[j + 1] === '"') {
                        value += '"';
                        j += 2;
                        continue;
                    }
                    break;
                }
                value += sql[j++];
            }
            push('quoted', i, j + 1, value);
            i = j + 1;
            continue;
        }
        if (c === '$') {
            if (/\d/.test(sql[i + 1] ?? '')) {
                let j = i + 1;
                while (/\d/.test(sql[j] ?? '')) j++;
                push('param', i, j);
                i = j;
                continue;
            }
            const tag = DOLLAR_TAG.exec(sql.slice(i, i + 130))?.[0];
            if (tag) {
                const close = sql.indexOf(tag, i + tag.length);
                if (close < 0) return null;
                push('string', i, close + tag.length);
                i = close + tag.length;
                continue;
            }
            push('symbol', i, i + 1);
            i++;
            continue;
        }
        if (c === '{' && sql[i + 1] === '{') {
            const close = sql.indexOf('}}', i + 2);
            if (close >= 0) {
                push('param', i, close + 2);
                i = close + 2;
                continue;
            }
        }
        if (c === ':') {
            if (sql[i + 1] === ':') {
                push('symbol', i, i + 2);
                i += 2;
                continue;
            }
            // `:name` bind parameter, the same shape `extractQueryParams` accepts.
            if (WORD_START.test(sql[i + 1] ?? '') && !/[\w:]/.test(sql[i - 1] ?? '')) {
                let j = i + 1;
                while (WORD_PART.test(sql[j] ?? '')) j++;
                push('param', i, j);
                i = j;
                continue;
            }
        }
        if (c === '?') {
            push('param', i, i + 1);
            i++;
            continue;
        }
        if (
            /\d/.test(c) ||
            (c === '.' && /\d/.test(sql[i + 1] ?? '') && !/[\w)"\]]/.test(sql[i - 1] ?? ''))
        ) {
            let j = i;
            while (/[\d_]/.test(sql[j] ?? '')) j++;
            if (sql[j] === '.' && /\d/.test(sql[j + 1] ?? '')) {
                j++;
                while (/[\d_]/.test(sql[j] ?? '')) j++;
            } else if (sql[j] === '.' && !WORD_START.test(sql[j + 1] ?? '') && sql[j + 1] !== '.') {
                j++;
            }
            if (/[eE]/.test(sql[j] ?? '') && /[\d+-]/.test(sql[j + 1] ?? '')) {
                j += 2;
                while (/\d/.test(sql[j] ?? '')) j++;
            }
            push('number', i, j);
            i = j;
            continue;
        }
        if (WORD_START.test(c)) {
            let j = i + 1;
            while (WORD_PART.test(sql[j] ?? '')) j++;
            if (j === i + 1 && sql[j] === "'" && STRING_PREFIXES.has(c.toLowerCase())) {
                const end = scanString(sql, j, c.toLowerCase() === 'e');
                if (end < 0) return null;
                push('string', i, end);
                i = end;
                continue;
            }
            push('word', i, j, sql.slice(i, j).toLowerCase());
            i = j;
            continue;
        }
        push('symbol', i, i + 1);
        i++;
    }
    return tokens;
}

// Returns the index after the closing quote, or -1 when unterminated.
function scanString(sql: string, open: number, backslashEscapes: boolean): number {
    let j = open + 1;
    while (j < sql.length) {
        if (backslashEscapes && sql[j] === '\\') {
            j += 2;
            continue;
        }
        if (sql[j] === "'") {
            if (sql[j + 1] === "'") {
                j += 2;
                continue;
            }
            return j + 1;
        }
        j++;
    }
    return -1;
}

// ---------------------------------------------------------------------------
// Syntax tree
// ---------------------------------------------------------------------------

interface IdentPart {
    value: string;
    start: number;
    end: number;
}

interface ColumnRef {
    qualifier: IdentPart[];
    name: IdentPart;
    star: boolean;
    outputFirst?: boolean;
}

interface OutputItem {
    alias?: string;
    /** `*` (qualifier null) or `qualifier.*`. */
    star?: {qualifier: string | null};
    /** Name of a plain column expression, used when the item has no alias. */
    columnName?: string;
}

interface CteDef {
    name: string;
    columns: string[] | null;
    query: QueryNode | null;
}

interface CteEnv {
    defs: Map<string, CteDef>;
    parent: CteEnv | null;
}

interface SourceNode {
    /** Folded name the source is referenced by in this scope. */
    alias: string | null;
    kind: 'relation' | 'query' | 'opaque';
    relation?: {schema?: IdentPart; name: IdentPart};
    cte?: CteDef;
    query?: QueryNode;
    columnAliases: string[] | null;
}

interface SelectNode {
    parent: SelectNode | null;
    env: CteEnv | null;
    sources: SourceNode[];
    refs: ColumnRef[];
    /** ORDER BY / GROUP BY references: they may name an output column. */
    orderRefs: ColumnRef[];
    outputs: OutputItem[];
    usingColumns: Set<string>;
    natural: boolean;
    /** The FROM clause held something that was not understood. */
    opaque: boolean;
}

interface QueryNode {
    operands: Array<SelectNode | QueryNode>;
    /** ORDER BY of a set operation: it can only name output columns. */
    setOrderRefs: ColumnRef[];
}

interface Limitation {
    construct: string;
    start: number;
    end: number;
}

export interface ParsedSelect {
    selects: SelectNode[];
    queries: QueryNode[];
    limitations: Limitation[];
    relations: RelationRequest[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const words = (list: string): ReadonlySet<string> => new Set(list.trim().split(/\s+/));

// Words that never start a column reference inside an expression.
const NON_REFERENCE_WORDS = words(`
    and or not null true false is isnull notnull in between like ilike similar to case when then
    else end as distinct cast interval exists any all some over partition by filter within group
    order asc desc nulls first last collate escape at time zone from for placing both leading
    trailing using unknown symmetric asymmetric array row only select where having limit offset
    fetch next union intersect except on join left right inner outer full cross natural lateral
    with recursive current_date current_time current_timestamp localtime localtimestamp
    current_user session_user user current_schema current_catalog current_role system_user
    variadic default window rows range groups unbounded preceding following current exclude ties
    others into returning overlaps operator ordinality
`);

// Keywords that complete an operand, so a word right after them is an alias.
const OPERAND_END_WORDS = words(`
    null true false end current_date current_time current_timestamp localtime localtimestamp
    current_user session_user user
`);

const EXPRESSION_STOPS = new Set([
    'where',
    'group',
    'having',
    'window',
    'order',
    'limit',
    'offset',
    'fetch',
    'for',
    'union',
    'intersect',
    'except',
    'returning',
    'into',
]);
const SELECT_LIST_STOPS = new Set([...EXPRESSION_STOPS, 'from']);
const JOIN_WORDS = new Set(['join', 'inner', 'left', 'right', 'full', 'cross', 'natural']);
const JOIN_CONDITION_STOPS = new Set([...EXPRESSION_STOPS, ...JOIN_WORDS]);
const ALIAS_STOP_WORDS = words(`
    where group order having limit offset union intersect except for fetch window on using join
    inner left right full cross natural lateral tablesample returning set with
`);
const ORDER_SUFFIX_WORDS = words('asc desc nulls first last');
const NO_STOPS: ReadonlySet<string> = new Set();

interface ItemState {
    alias?: string;
    star?: {qualifier: string | null};
    columnName?: string;
    hasOther: boolean;
    started: boolean;
}

interface ScanOptions {
    stops: ReadonlySet<string>;
    target: ColumnRef[] | null;
    stopAtComma?: boolean;
    item?: ItemState;
}

const identPart = (token: Token): IdentPart => ({
    value: token.value,
    start: token.start,
    end: token.end,
});

const isIdentToken = (token: Token | undefined): token is Token =>
    token !== undefined && (token.kind === 'word' || token.kind === 'quoted');

const relationKey = (schema: string | undefined, name: string): string =>
    `${schema ?? ''}\u0000${name}`;

export function parseSelectStatement(sql: string): ParsedSelect | null {
    const lexed = lex(sql);
    if (!lexed || lexed.length === 0) return null;
    const tokens = lexed;
    const first = tokens[0];
    const startsQuery =
        (first.kind === 'word' && (first.value === 'select' || first.value === 'with')) ||
        (first.kind === 'symbol' && first.text === '(');
    if (!startsQuery) return null;

    const selects: SelectNode[] = [];
    const queries: QueryNode[] = [];
    const limitations: Limitation[] = [];
    let i = 0;

    const at = (offset = 0): Token | undefined => tokens[i + offset];
    const isWord = (token: Token | undefined, ...words: string[]): boolean =>
        token !== undefined && token.kind === 'word' && words.includes(token.value);
    const isSymbol = (token: Token | undefined, text: string): boolean =>
        token !== undefined && token.kind === 'symbol' && token.text === text;
    const limit = (construct: string, start: number, end: number) => {
        limitations.push({construct, start, end});
    };

    const skipBalanced = () => {
        if (!isSymbol(at(), '(')) return;
        let depth = 0;
        while (i < tokens.length) {
            const token = tokens[i++];
            if (token.kind !== 'symbol') continue;
            if (token.text === '(') depth++;
            else if (token.text === ')' && --depth === 0) return;
        }
    };

    // Consumes the type name after `::` or `AS` inside CAST.
    const skipType = () => {
        const head = at();
        if (!isIdentToken(head)) return;
        i++;
        while (isSymbol(at(), '.') && isIdentToken(at(1))) i += 2;
        const name = head.value;
        if (head.kind === 'word') {
            if (name === 'double' && isWord(at(), 'precision')) i++;
            else if (
                (name === 'character' || name === 'char' || name === 'bit') &&
                isWord(at(), 'varying')
            )
                i++;
            else if (name === 'interval') {
                if (isWord(at(), 'year', 'month', 'day', 'hour', 'minute', 'second')) i++;
                if (isWord(at(), 'to') && isWord(at(1), 'month', 'day', 'hour', 'minute', 'second'))
                    i += 2;
            }
        }
        if (isSymbol(at(), '(')) skipBalanced();
        if (head.kind === 'word' && (name === 'timestamp' || name === 'time')) {
            if (isWord(at(), 'with', 'without') && isWord(at(1), 'time') && isWord(at(2), 'zone'))
                i += 3;
        }
        while (isSymbol(at(), '[')) {
            while (i < tokens.length && !isSymbol(at(), ']')) i++;
            i++;
        }
    };

    const newSelect = (parent: SelectNode | null, env: CteEnv | null): SelectNode => {
        const node: SelectNode = {
            parent,
            env,
            sources: [],
            refs: [],
            orderRefs: [],
            outputs: [],
            usingColumns: new Set(),
            natural: false,
            opaque: false,
        };
        selects.push(node);
        return node;
    };

    const lookupCte = (env: CteEnv | null, name: string): CteDef | undefined => {
        for (let e = env; e; e = e.parent) {
            const def = e.defs.get(name);
            if (def) return def;
        }
        return undefined;
    };

    // ----- expressions -----

    const scanParenContent = (select: SelectNode, options: ScanOptions, depth: number) => {
        // `(` already consumed.
        const next = at();
        if (isWord(next, 'select', 'with')) {
            parseQuery(select, select.env);
        } else if (isWord(next, 'values')) {
            i--;
            skipBalanced();
            return;
        } else {
            scan(
                select,
                {...options, stops: NO_STOPS, stopAtComma: false, item: undefined},
                depth + 1,
            );
        }
        if (isSymbol(at(), ')')) i++;
        // Field selection or subscript on a parenthesized expression: `(x).y`, `(x)[1]`.
        if (isSymbol(at(), '.') && (isIdentToken(at(1)) || isSymbol(at(1), '*'))) i += 2;
    };

    const scan = (select: SelectNode, options: ScanOptions, depth: number) => {
        const {item} = options;
        let prevOperand = false;
        let prevWord: string | null = null;

        while (i < tokens.length) {
            const token = tokens[i];
            const previous = prevWord;
            prevWord = token.kind === 'word' ? token.value : null;

            if (token.kind === 'symbol') {
                const text = token.text;
                if (text === ')' || text === ']' || text === ';') return;
                if (text === ',' && depth === 0 && options.stopAtComma) return;
                if (text === '(') {
                    i++;
                    if (item) item.started = true;
                    scanParenContent(select, options, depth);
                    if (item) item.hasOther = true;
                    prevOperand = true;
                    continue;
                }
                if (text === '[') {
                    i++;
                    if (item) item.started = true;
                    scan(
                        select,
                        {...options, stops: NO_STOPS, stopAtComma: false, item: undefined},
                        depth + 1,
                    );
                    if (isSymbol(at(), ']')) i++;
                    if (item) item.hasOther = true;
                    prevOperand = true;
                    continue;
                }
                if (text === '::') {
                    i++;
                    skipType();
                    prevOperand = true;
                    continue;
                }
                if (text === '*' && item && depth === 0 && !item.started) {
                    item.star = {qualifier: null};
                    item.started = true;
                    i++;
                    continue;
                }
                if (item) item.hasOther = true;
                if (item) item.started = true;
                i++;
                prevOperand = false;
                continue;
            }

            if (item) item.started = true;

            if (token.kind !== 'word' && token.kind !== 'quoted') {
                // number, string, parameter
                if (item) item.hasOther = true;
                i++;
                prevOperand = true;
                continue;
            }

            if (token.kind === 'word') {
                const word = token.value;
                const next = at(1);
                const isFunctionLike = (word === 'left' || word === 'right') && isSymbol(next, '(');
                if (
                    depth === 0 &&
                    options.stops.has(word) &&
                    !(word === 'from' && previous === 'distinct') &&
                    !(word === 'group' && previous === 'within') &&
                    !isFunctionLike
                ) {
                    return;
                }
                if (word === 'as') {
                    i++;
                    if (depth === 0 && item) {
                        const alias = at();
                        if (isIdentToken(alias)) {
                            item.alias = alias.value;
                            i++;
                        }
                    } else {
                        skipType();
                    }
                    prevOperand = false;
                    continue;
                }
                if (word === 'extract' && isSymbol(next, '(')) {
                    // The first argument is a field name, not a column.
                    i += 2;
                    while (i < tokens.length && !isWord(at(), 'from') && !isSymbol(at(), ')')) i++;
                    if (isWord(at(), 'from')) i++;
                    scan(
                        select,
                        {...options, stops: NO_STOPS, stopAtComma: false, item: undefined},
                        depth + 1,
                    );
                    if (isSymbol(at(), ')')) i++;
                    if (item) item.hasOther = true;
                    prevOperand = true;
                    continue;
                }
                if (word === 'collate') {
                    i++;
                    while (isIdentToken(at())) {
                        i++;
                        if (!(isSymbol(at(), '.') && isIdentToken(at(1)))) break;
                        i++;
                    }
                    prevOperand = true;
                    continue;
                }
                if (word === 'operator' && isSymbol(next, '(')) {
                    i++;
                    skipBalanced();
                    prevOperand = false;
                    continue;
                }
                if (word === 'over' && !isFunctionLike) {
                    i++;
                    if (isIdentToken(at())) i++;
                    if (item) item.hasOther = true;
                    prevOperand = false;
                    continue;
                }
                if (
                    NON_REFERENCE_WORDS.has(word) &&
                    !(isSymbol(next, '.') && isIdentToken(at(2)))
                ) {
                    if (item) item.hasOther = true;
                    i++;
                    prevOperand = OPERAND_END_WORDS.has(word);
                    continue;
                }
            }

            // Dotted chain: a, a.b, a.b.c, a.*
            const parts: Token[] = [token];
            let j = i + 1;
            let star = false;
            while (isSymbol(tokens[j], '.')) {
                const part = tokens[j + 1];
                if (isIdentToken(part)) {
                    parts.push(part);
                    j += 2;
                } else if (isSymbol(part, '*')) {
                    star = true;
                    j += 2;
                    break;
                } else {
                    break;
                }
            }
            const after = tokens[j];

            if (isSymbol(after, '(')) {
                // Function call, possibly schema-qualified.
                i = j;
                if (item) item.hasOther = true;
                prevOperand = false;
                continue;
            }
            if (parts.length === 1 && !star && after?.kind === 'string') {
                // Typed literal such as `date '2024-01-01'`.
                i = j;
                if (item) item.hasOther = true;
                prevOperand = false;
                continue;
            }
            if (prevOperand) {
                // Two operands in a row: an implicit select-list alias, or
                // something this scanner does not know. Neither is a reference.
                if (
                    depth === 0 &&
                    item &&
                    item.alias === undefined &&
                    parts.length === 1 &&
                    !star
                ) {
                    item.alias = token.value;
                }
                i = j;
                prevOperand = false;
                continue;
            }

            if (parts.length <= 3) {
                const name = star ? null : identPart(parts[parts.length - 1]);
                const qualifier = (star ? parts : parts.slice(0, -1)).map(identPart);
                if (name) {
                    options.target?.push({qualifier, name, star: false});
                } else if (qualifier.length > 0) {
                    const last = qualifier[qualifier.length - 1];
                    options.target?.push({
                        qualifier,
                        name: {value: '*', start: last.end, end: last.end},
                        star: true,
                    });
                }
            }
            if (item) {
                if (
                    star &&
                    depth === 0 &&
                    parts.length === 1 &&
                    !item.hasOther &&
                    item.columnName === undefined
                ) {
                    item.star = {qualifier: parts[0].value};
                } else if (!star && !item.hasOther && item.columnName === undefined && !item.star) {
                    item.columnName = parts[parts.length - 1].value;
                } else {
                    item.hasOther = true;
                }
            }
            i = j;
            prevOperand = true;
        }
    };

    // ----- FROM clause -----

    const parseAlias = (): {alias: string | null; columns: string[] | null} => {
        let alias: string | null = null;
        if (isWord(at(), 'as')) {
            i++;
            if (isIdentToken(at())) alias = tokens[i++].value;
        } else {
            const next = at();
            if (
                next?.kind === 'quoted' ||
                (next?.kind === 'word' && !ALIAS_STOP_WORDS.has(next.value))
            ) {
                alias = next.value;
                i++;
            }
        }
        let columns: string[] | null = null;
        if (alias !== null && isSymbol(at(), '(')) {
            columns = [];
            i++;
            let expectName = true;
            while (i < tokens.length && !isSymbol(at(), ')')) {
                const token = tokens[i++];
                if (expectName && isIdentToken(token)) columns.push(token.value);
                expectName = isSymbol(token, ',');
            }
            if (isSymbol(at(), ')')) i++;
        }
        return {alias, columns};
    };

    const parseFromItem = (select: SelectNode) => {
        if (isWord(at(), 'lateral')) i++;
        if (isWord(at(), 'only')) i++;
        const token = at();
        if (!token) return;

        if (isSymbol(token, '(')) {
            const next = at(1);
            if (isWord(next, 'select', 'with')) {
                i++;
                // A derived table sees outer queries, not its FROM siblings,
                // unless it is LATERAL.
                const lateral = isWord(tokens[i - 2], 'lateral');
                const query = parseQuery(lateral ? select : select.parent, select.env);
                if (isSymbol(at(), ')')) i++;
                const {alias, columns} = parseAlias();
                select.sources.push({
                    alias,
                    kind: 'query',
                    query: query ?? undefined,
                    columnAliases: columns,
                });
                if (!query) select.opaque = true;
                return;
            }
            if (next && isWord(next, 'values')) {
                limit('VALUES', next.start, next.end);
                skipBalanced();
                const {alias, columns} = parseAlias();
                select.sources.push({alias, kind: 'opaque', columnAliases: columns});
                return;
            }
            i++;
            parseFromList(select);
            if (isSymbol(at(), ')')) i++;
            if (parseAlias().alias !== null) {
                limit('(…) JOIN', token.start, token.end);
                select.opaque = true;
            }
            return;
        }

        if (!isIdentToken(token)) {
            i++;
            return;
        }

        if (isWord(token, 'rows') && isWord(at(1), 'from')) {
            limit('ROWS FROM', token.start, at(1)!.end);
            i += 2;
            skipBalanced();
            const {alias, columns} = parseAlias();
            select.sources.push({alias, kind: 'opaque', columnAliases: columns});
            return;
        }

        const parts: Token[] = [token];
        i++;
        while (isSymbol(at(), '.') && isIdentToken(at(1))) {
            parts.push(tokens[i + 1]);
            i += 2;
        }
        const last = parts[parts.length - 1];

        if (isSymbol(at(), '(')) {
            limit(`${parts.map((p) => p.text).join('.')}(…)`, parts[0].start, last.end);
            skipBalanced();
            if (isWord(at(), 'with') && isWord(at(1), 'ordinality')) i += 2;
            const {alias, columns} = parseAlias();
            select.sources.push({
                alias: alias ?? last.value,
                kind: 'opaque',
                columnAliases: columns,
            });
            return;
        }

        if (isSymbol(at(), '*')) i++;
        if (isWord(at(), 'tablesample')) {
            limit('TABLESAMPLE', at()!.start, at()!.end);
            i += 2;
            skipBalanced();
            if (isWord(at(), 'repeatable')) {
                i++;
                skipBalanced();
            }
        }
        const {alias, columns} = parseAlias();

        if (parts.length > 2) {
            limit(parts.map((p) => p.text).join('.'), parts[0].start, last.end);
            select.sources.push({
                alias: alias ?? last.value,
                kind: 'opaque',
                columnAliases: columns,
            });
            return;
        }
        const cte = parts.length === 1 ? lookupCte(select.env, token.value) : undefined;
        if (cte) {
            select.sources.push({
                alias: alias ?? token.value,
                kind: 'relation',
                cte,
                columnAliases: columns,
            });
            return;
        }
        select.sources.push({
            alias: alias ?? last.value,
            kind: 'relation',
            relation: {
                schema: parts.length === 2 ? identPart(parts[0]) : undefined,
                name: identPart(last),
            },
            columnAliases: columns,
        });
    };

    const parseFromList = (select: SelectNode) => {
        for (;;) {
            parseFromItem(select);
            while (JOIN_WORDS.has(at()?.kind === 'word' ? at()!.value : '')) {
                if (isWord(at(), 'natural')) {
                    select.natural = true;
                    limit('NATURAL JOIN', at()!.start, at()!.end);
                }
                while (isWord(at(), 'natural', 'inner', 'left', 'right', 'full', 'cross', 'outer'))
                    i++;
                if (!isWord(at(), 'join')) break;
                i++;
                parseFromItem(select);
                for (;;) {
                    if (isWord(at(), 'on')) {
                        i++;
                        scan(
                            select,
                            {stops: JOIN_CONDITION_STOPS, target: select.refs, stopAtComma: true},
                            0,
                        );
                    } else if (isWord(at(), 'using')) {
                        i++;
                        if (isSymbol(at(), '(')) {
                            i++;
                            while (i < tokens.length && !isSymbol(at(), ')')) {
                                const column = tokens[i++];
                                if (isIdentToken(column)) select.usingColumns.add(column.value);
                            }
                            if (isSymbol(at(), ')')) i++;
                        }
                    } else {
                        break;
                    }
                }
            }
            if (isSymbol(at(), ',')) {
                i++;
                continue;
            }
            return;
        }
    };

    // ----- SELECT core and queries -----

    const parseOrderItems = (select: SelectNode) => {
        for (;;) {
            const start = i;
            const before = select.orderRefs.length;
            scan(select, {stops: EXPRESSION_STOPS, target: select.orderRefs, stopAtComma: true}, 0);
            const added = select.orderRefs.slice(before);
            const [ref] = added;
            const suffix = tokens.slice(start + 1, i);
            if (
                added.length === 1 &&
                !ref.star &&
                ref.qualifier.length === 0 &&
                tokens[start]?.start === ref.name.start &&
                suffix.every(
                    (token) => token.kind === 'word' && ORDER_SUFFIX_WORDS.has(token.value),
                )
            ) {
                ref.outputFirst = true;
            }
            if (isSymbol(at(), ',')) {
                i++;
                continue;
            }
            return;
        }
    };

    const parseSelectCore = (parent: SelectNode | null, env: CteEnv | null): SelectNode => {
        const select = newSelect(parent, env);
        i++; // SELECT
        if (isWord(at(), 'all')) {
            i++;
        } else if (isWord(at(), 'distinct')) {
            i++;
            if (isWord(at(), 'on') && isSymbol(at(1), '(')) {
                i += 2;
                scan(select, {stops: NO_STOPS, target: select.refs}, 1);
                if (isSymbol(at(), ')')) i++;
            }
        }

        for (;;) {
            const item: ItemState = {hasOther: false, started: false};
            scan(
                select,
                {stops: SELECT_LIST_STOPS, target: select.refs, stopAtComma: true, item},
                0,
            );
            if (item.started) {
                select.outputs.push({
                    alias: item.alias,
                    star: item.star,
                    columnName: item.hasOther ? undefined : item.columnName,
                });
            }
            if (isSymbol(at(), ',')) {
                i++;
                continue;
            }
            break;
        }

        if (isWord(at(), 'from')) {
            i++;
            parseFromList(select);
        }

        while (i < tokens.length) {
            const token = at()!;
            if (isSymbol(token, ')') || isSymbol(token, ';')) break;
            if (isWord(token, 'union', 'intersect', 'except')) break;
            if (isWord(token, 'where', 'having')) {
                i++;
                scan(select, {stops: EXPRESSION_STOPS, target: select.refs}, 0);
            } else if (isWord(token, 'group')) {
                i++;
                if (isWord(at(), 'by')) i++;
                scan(select, {stops: EXPRESSION_STOPS, target: select.orderRefs}, 0);
            } else if (isWord(token, 'order')) {
                i++;
                if (isWord(at(), 'by')) i++;
                parseOrderItems(select);
            } else if (isWord(token, 'window')) {
                i++;
                for (;;) {
                    if (isIdentToken(at())) i++;
                    if (isWord(at(), 'as')) i++;
                    if (isSymbol(at(), '(')) {
                        i++;
                        scan(select, {stops: NO_STOPS, target: select.refs}, 1);
                        if (isSymbol(at(), ')')) i++;
                    }
                    if (isSymbol(at(), ',')) {
                        i++;
                        continue;
                    }
                    break;
                }
            } else if (isWord(token, 'limit', 'offset', 'fetch', 'for')) {
                i++;
                scan(select, {stops: EXPRESSION_STOPS, target: null}, 0);
            } else {
                i++;
            }
        }
        return select;
    };

    const parseOperand = (
        parent: SelectNode | null,
        env: CteEnv | null,
    ): SelectNode | QueryNode | null => {
        if (isWord(at(), 'select')) return parseSelectCore(parent, env);
        if (isSymbol(at(), '(')) {
            i++;
            const inner = parseQuery(parent, env);
            if (isSymbol(at(), ')')) i++;
            return inner;
        }
        return null;
    };

    function parseQuery(parent: SelectNode | null, env: CteEnv | null): QueryNode | null {
        const query: QueryNode = {operands: [], setOrderRefs: []};
        queries.push(query);
        let scopeEnv = env;

        if (isWord(at(), 'with')) {
            i++;
            const recursive = isWord(at(), 'recursive');
            if (recursive) i++;
            scopeEnv = {defs: new Map(), parent: env};
            for (;;) {
                const name = at();
                if (!isIdentToken(name)) return null;
                i++;
                const def: CteDef = {name: name.value, columns: null, query: null};
                if (isSymbol(at(), '(')) {
                    i++;
                    def.columns = [];
                    while (i < tokens.length && !isSymbol(at(), ')')) {
                        const column = tokens[i++];
                        if (isIdentToken(column)) def.columns.push(column.value);
                    }
                    if (isSymbol(at(), ')')) i++;
                }
                if (!isWord(at(), 'as')) return null;
                i++;
                if (isWord(at(), 'not')) i++;
                if (isWord(at(), 'materialized')) i++;
                if (!isSymbol(at(), '(')) return null;
                i++;
                if (recursive) scopeEnv.defs.set(def.name, def);
                def.query = parseQuery(parent, scopeEnv);
                if (isSymbol(at(), ')')) i++;
                scopeEnv.defs.set(def.name, def);
                if (isSymbol(at(), ',')) {
                    i++;
                    continue;
                }
                break;
            }
        }

        const first = parseOperand(parent, scopeEnv);
        if (!first) return null;
        query.operands.push(first);

        while (isWord(at(), 'union', 'intersect', 'except')) {
            i++;
            if (isWord(at(), 'all', 'distinct')) i++;
            const operand = parseOperand(parent, scopeEnv);
            if (!operand) break;
            query.operands.push(operand);
        }

        const last = query.operands[query.operands.length - 1];
        if (query.operands.length > 1 && 'orderRefs' in last) {
            query.setOrderRefs.push(...last.orderRefs);
            last.orderRefs = [];
        }
        if (isWord(at(), 'order', 'limit', 'offset', 'fetch')) {
            const trailing = newSelect(parent, scopeEnv);
            if (isWord(at(), 'order')) {
                i++;
                if (isWord(at(), 'by')) i++;
                scan(trailing, {stops: EXPRESSION_STOPS, target: query.setOrderRefs}, 0);
            }
            scan(trailing, {stops: new Set(), target: null}, 0);
        }
        return query;
    }

    try {
        if (!parseQuery(null, null)) return null;
    } catch {
        return null;
    }

    const relations = new Map<string, RelationRequest>();
    for (const select of selects) {
        for (const source of select.sources) {
            if (source.kind !== 'relation' || !source.relation) continue;
            const schema = source.relation.schema?.value;
            relations.set(relationKey(schema, source.relation.name.value), {
                schema,
                name: source.relation.name.value,
            });
        }
    }
    return {selects, queries, limitations, relations: [...relations.values()]};
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

interface ColumnSet {
    names: string[];
    /** False when the list may miss columns (unknown source, unnamed expression). */
    complete: boolean;
}

const INCOMPLETE: ColumnSet = {names: [], complete: false};

function applyColumnAliases(set: ColumnSet, aliases: string[] | null): ColumnSet {
    if (!aliases) return set;
    if (!set.complete) return {names: aliases, complete: false};
    return {names: [...aliases, ...set.names.slice(aliases.length)], complete: true};
}

export function diagnoseParsedSelect(
    parsed: ParsedSelect,
    lookups: ReadonlyMap<string, RelationLookup>,
): SqlDiagnostic[] {
    const diagnostics: SqlDiagnostic[] = [];
    const sourceCache = new Map<SourceNode, ColumnSet>();
    const cteCache = new Map<CteDef, ColumnSet>();
    const selectCache = new Map<SelectNode, ColumnSet>();
    const inProgress = new Set<object>();

    const guarded = <T extends object>(key: T, compute: () => ColumnSet): ColumnSet => {
        if (inProgress.has(key)) return INCOMPLETE;
        inProgress.add(key);
        try {
            return compute();
        } finally {
            inProgress.delete(key);
        }
    };

    const queryColumns = (query: QueryNode | null): ColumnSet => {
        if (!query) return INCOMPLETE;
        const first = query.operands[0];
        return 'operands' in first ? queryColumns(first) : selectColumns(first);
    };

    const cteColumns = (cte: CteDef): ColumnSet => {
        const cached = cteCache.get(cte);
        if (cached) return cached;
        const result = guarded(cte, () => applyColumnAliases(queryColumns(cte.query), cte.columns));
        cteCache.set(cte, result);
        return result;
    };

    const sourceColumns = (source: SourceNode): ColumnSet => {
        const cached = sourceCache.get(source);
        if (cached) return cached;
        let base: ColumnSet = INCOMPLETE;
        if (source.cte) {
            base = cteColumns(source.cte);
        } else if (source.kind === 'relation' && source.relation) {
            const lookup = lookups.get(
                relationKey(source.relation.schema?.value, source.relation.name.value),
            );
            if (lookup?.status === 'found') base = {names: [...lookup.columns], complete: true};
        } else if (source.kind === 'query') {
            base = guarded(source, () => queryColumns(source.query ?? null));
        }
        const result = applyColumnAliases(base, source.columnAliases);
        sourceCache.set(source, result);
        return result;
    };

    function selectColumns(select: SelectNode): ColumnSet {
        const cached = selectCache.get(select);
        if (cached) return cached;
        const result = guarded(select, () => {
            const names: string[] = [];
            let complete = true;
            for (const item of select.outputs) {
                if (item.alias !== undefined) {
                    names.push(item.alias);
                } else if (item.star) {
                    const {qualifier} = item.star;
                    const matched = select.sources.filter(
                        (source) => qualifier === null || source.alias === qualifier,
                    );
                    if (qualifier !== null && matched.length === 0) complete = false;
                    for (const source of matched) {
                        const columns = sourceColumns(source);
                        names.push(...columns.names);
                        if (!columns.complete) complete = false;
                    }
                } else if (item.columnName !== undefined) {
                    names.push(item.columnName);
                } else {
                    complete = false;
                }
            }
            return {names, complete};
        });
        selectCache.set(select, result);
        return result;
    }

    const error = (code: SqlDiagnosticCode, part: IdentPart, name: string): void => {
        diagnostics.push({code, severity: 'error', start: part.start, end: part.end, name});
    };

    const checkRef = (select: SelectNode, ref: ColumnRef, allowOutputName: boolean): void => {
        const name = ref.name.value;

        if (ref.qualifier.length === 0) {
            if (ref.outputFirst) {
                const outputs = selectColumns(select);
                if (outputs.names.includes(name) || !outputs.complete) return;
            }
            for (let scope: SelectNode | null = select; scope; scope = scope.parent) {
                if (scope.sources.length === 0) continue;
                const matching = scope.sources.filter((source) =>
                    sourceColumns(source).names.includes(name),
                );
                if (matching.length > 1 && !scope.natural && !scope.usingColumns.has(name)) {
                    error('ambiguousColumn', ref.name, name);
                    return;
                }
                if (matching.length > 0) return;
                // A bare table alias is a whole-row reference.
                if (scope.sources.some((source) => source.alias === name)) return;
                if (scope === select && allowOutputName) {
                    const outputs = selectColumns(select);
                    if (outputs.names.includes(name) || !outputs.complete) return;
                }
                if (scope.opaque || scope.sources.some((source) => !sourceColumns(source).complete))
                    return;
            }
            error('unresolvedColumn', ref.name, name);
            return;
        }

        if (ref.qualifier.length > 2) return;
        const qualifier = ref.qualifier[ref.qualifier.length - 1];
        const schema = ref.qualifier.length === 2 ? ref.qualifier[0].value : undefined;
        for (let scope: SelectNode | null = select; scope; scope = scope.parent) {
            const source = scope.sources.find((candidate) =>
                schema === undefined
                    ? candidate.alias === qualifier.value
                    : candidate.relation?.name.value === qualifier.value &&
                      candidate.relation.schema?.value === schema,
            );
            if (source) {
                if (ref.star) return;
                const columns = sourceColumns(source);
                if (columns.names.includes(name) || !columns.complete) return;
                error('unresolvedColumn', ref.name, `${qualifier.value}.${name}`);
                return;
            }
            if (scope.opaque) return;
        }
        if (schema === undefined) error('unresolvedAlias', qualifier, qualifier.value);
    };

    for (const select of parsed.selects) {
        for (const source of select.sources) {
            if (source.kind !== 'relation' || !source.relation || source.cte) continue;
            const {schema, name} = source.relation;
            const lookup = lookups.get(relationKey(schema?.value, name.value));
            const start = schema?.start ?? name.start;
            const display = schema ? `${schema.value}.${name.value}` : name.value;
            if (lookup?.status === 'missing') {
                diagnostics.push({
                    code: 'unresolvedRelation',
                    severity: 'warning',
                    start,
                    end: name.end,
                    name: display,
                });
            } else if (!lookup || lookup.status === 'unknown') {
                diagnostics.push({
                    code: 'metadataUnavailable',
                    severity: 'info',
                    start,
                    end: name.end,
                    name: display,
                });
            }
        }

        if (select.sources.length === 0) continue;
        for (const ref of select.refs) checkRef(select, ref, false);
        for (const ref of select.orderRefs) checkRef(select, ref, true);
    }

    // ORDER BY of a set operation can only name output columns.
    for (const query of parsed.queries) {
        if (query.setOrderRefs.length === 0) continue;
        const outputs = queryColumns(query);
        for (const ref of query.setOrderRefs) {
            if (
                ref.qualifier.length > 0 ||
                outputs.names.includes(ref.name.value) ||
                !outputs.complete
            ) {
                continue;
            }
            error('unresolvedColumn', ref.name, ref.name.value);
        }
    }

    for (const {construct, start, end} of parsed.limitations) {
        diagnostics.push({
            code: 'unsupportedConstruct',
            severity: 'info',
            start,
            end,
            name: construct,
        });
    }

    return diagnostics.sort((a, b) => a.start - b.start || a.end - b.end);
}

export {relationKey};
