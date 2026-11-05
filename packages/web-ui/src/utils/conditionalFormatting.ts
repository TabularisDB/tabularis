import {NO_VALUE_OPS, isFilterComplete, splitInList, type FilterOperator} from './filterBar';

/**
 * Conditional formatting for the data grid (#991): rules that color a row, or
 * one cell, from the values already loaded. Conditions reuse the structured
 * filter operators of the filter bar and are evaluated here, in the frontend,
 * so a rule never runs a query.
 */

/** Theme tones a rule can paint with; each maps to a theme token, never a literal color. */
export const FORMAT_TONES = ['danger', 'warning', 'success', 'info', 'muted'] as const;
export type FormatTone = (typeof FORMAT_TONES)[number];

/** What a matching rule paints: the whole row (record), or only its condition's cell. */
export type FormatTarget = 'row' | 'cell';

export interface FormatRule {
    id: string;
    /** Shown in the row tooltip and read by screen readers, so color is never the only signal. */
    name: string;
    column: string;
    operator: FilterOperator;
    value: string;
    /** Upper bound, for BETWEEN only. */
    value2?: string;
    tone: FormatTone;
    target: FormatTarget;
    /** Defaults to true. */
    enabled?: boolean;
}

/** Every operator of the filter bar can be evaluated on loaded rows. */
export const FORMAT_RULE_OPERATORS: readonly FilterOperator[] = [
    '=',
    '!=',
    '>',
    '<',
    '>=',
    '<=',
    'LIKE',
    'NOT LIKE',
    'contains',
    'starts with',
    'ends with',
    'is empty',
    'is not empty',
    'IS NULL',
    'IS NOT NULL',
    'IN',
    'NOT IN',
    'BETWEEN',
];

/** Rules kept per table. Adding more is refused, which keeps the stored value small. */
export const MAX_FORMAT_RULES_PER_TABLE = 20;

/** Background tint of a row painted by a rule. Muted rows dim their text instead. */
export const FORMAT_ROW_CLASS: Record<FormatTone, string> = {
    danger: 'bg-accent-error/15 hover:bg-accent-error/25',
    warning: 'bg-accent-warning/15 hover:bg-accent-warning/25',
    success: 'bg-accent-success/15 hover:bg-accent-success/25',
    info: 'bg-accent-info/15 hover:bg-accent-info/25',
    muted: 'hover:bg-surface-secondary/50',
};

/** Text color of a cell painted by a rule (and of every cell of a muted row). */
export const FORMAT_TEXT_CLASS: Record<FormatTone, string> = {
    danger: 'text-accent-error',
    warning: 'text-accent-warning',
    success: 'text-accent-success',
    info: 'text-accent-info',
    muted: 'text-muted',
};

/** Solid swatch of a tone, for the editor. */
export const FORMAT_SWATCH_CLASS: Record<FormatTone, string> = {
    danger: 'bg-accent-error',
    warning: 'bg-accent-warning',
    success: 'bg-accent-success',
    info: 'bg-accent-info',
    muted: 'bg-surface-tertiary',
};

/** The rule that won a row or a cell: what it paints with and the name it exposes. */
export interface AppliedFormat {
    tone: FormatTone;
    name: string;
}

/** Formatting of one row: the row rule, the cell rules by column index, and every applied name. */
export interface RowFormat {
    row: AppliedFormat | null;
    cells: ReadonlyMap<number, AppliedFormat>;
    /** Names of the rules that paint something in this row, in rule order, without repeats. */
    names: readonly string[];
}

interface CompiledRule {
    rule: FormatRule;
    colIndex: number;
    test: (value: unknown) => boolean;
}

const NUMBER_PATTERN = /^[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?$/i;

/** A number for numeric comparison, or null when the value is not numeric. */
function toNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isNaN(value) ? null : value;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return NUMBER_PATTERN.test(trimmed) ? Number(trimmed) : null;
    }
    return null;
}

const INTEGER_PATTERN = /^[-+]?\d+$/;

/** An exact integer, or null when the value is not a whole number written as digits. */
function toBigInt(value: unknown): bigint | null {
    if (typeof value === 'bigint') return value;
    const text =
        typeof value === 'number' ? (Number.isInteger(value) ? value.toFixed(0) : '') : value;
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    return INTEGER_PATTERN.test(trimmed) ? BigInt(trimmed) : null;
}

/** The text a value is compared as: what the grid shows for it. */
function toText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null) return JSON.stringify(value);
    return String(value);
}

/**
 * The value a rule compares with. The filter bar quotes values for you, but a
 * value typed with its quotes (`'failed'`) means the same, so one pair of
 * matching quotes is removed and doubled quotes inside are unescaped.
 */
export function unquoteRuleValue(raw: string): string {
    const value = raw.trim();
    if (value.length >= 2) {
        const quote = value[0];
        if ((quote === "'" || quote === '"') && value[value.length - 1] === quote) {
            return value
                .slice(1, -1)
                .split(quote + quote)
                .join(quote);
        }
    }
    return value;
}

const TRUE_WORDS = new Set(['true', '1', 't', 'yes']);
const FALSE_WORDS = new Set(['false', '0', 'f', 'no']);

/**
 * Compares a cell with a rule value: numerically when both are numbers, as
 * booleans for boolean cells, otherwise as text (ISO dates and times sort
 * correctly as text). Returns null when the two cannot be compared.
 */
function compare(cell: unknown, target: string): number | null {
    if (typeof cell === 'boolean') {
        const word = target.toLowerCase();
        const wanted = TRUE_WORDS.has(word) ? true : FALSE_WORDS.has(word) ? false : null;
        if (wanted === null) return null;
        return Number(cell) - Number(wanted);
    }
    // NaN is not ordered against anything.
    if (typeof cell === 'number' && Number.isNaN(cell)) return null;
    const a = toNumber(cell);
    const b = toNumber(target);
    if (a !== null && b !== null) {
        // Integers past 2^53 (BIGINT ids) lose precision as numbers: compare them exactly.
        const exactA = toBigInt(cell);
        const exactB = toBigInt(target);
        if (
            exactA !== null &&
            exactB !== null &&
            (!Number.isSafeInteger(a) || !Number.isSafeInteger(b))
        ) {
            return exactA === exactB ? 0 : exactA < exactB ? -1 : 1;
        }
        return a === b ? 0 : a < b ? -1 : 1;
    }
    const text = toText(cell);
    return text === target ? 0 : text < target ? -1 : 1;
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * SQL LIKE pattern (`%` any run, `_` one character) as a case-insensitive regular
 * expression. A backslash makes the next character literal (`\_`, `\%`, `\\`),
 * the default LIKE escape of MySQL and PostgreSQL; a trailing backslash is literal.
 */
function likeToRegExp(pattern: string): RegExp {
    let source = '';
    const chars = [...pattern];
    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        if (ch === '\\' && i + 1 < chars.length) {
            source += escapeRegExp(chars[++i]);
        } else {
            source += ch === '%' ? '[\\s\\S]*' : ch === '_' ? '[\\s\\S]' : escapeRegExp(ch);
        }
    }
    return new RegExp(`^${source}$`, 'i');
}

const isNull = (value: unknown) => value === null || value === undefined;

/** Builds the test of one condition, with its values parsed once. */
function buildTest(rule: FormatRule): (value: unknown) => boolean {
    const target = unquoteRuleValue(rule.value);
    const lowerTarget = target.toLowerCase();
    switch (rule.operator) {
        case 'IS NULL':
            return isNull;
        case 'IS NOT NULL':
            return (v) => !isNull(v);
        case 'is empty':
            return (v) => isNull(v) || toText(v) === '';
        case 'is not empty':
            return (v) => !isNull(v) && toText(v) !== '';
        case '=':
            return (v) => !isNull(v) && compare(v, target) === 0;
        case '!=': {
            return (v) => {
                if (isNull(v)) return false;
                const order = compare(v, target);
                return order !== null && order !== 0;
            };
        }
        case '>':
        case '<':
        case '>=':
        case '<=': {
            const op = rule.operator;
            return (v) => {
                if (isNull(v)) return false;
                const order = compare(v, target);
                if (order === null) return false;
                if (op === '>') return order > 0;
                if (op === '<') return order < 0;
                if (op === '>=') return order >= 0;
                return order <= 0;
            };
        }
        case 'BETWEEN': {
            const upper = unquoteRuleValue(rule.value2 ?? '');
            return (v) => {
                if (isNull(v)) return false;
                const low = compare(v, target);
                const high = compare(v, upper);
                return low !== null && high !== null && low >= 0 && high <= 0;
            };
        }
        case 'IN':
        case 'NOT IN': {
            const items = splitInList(rule.value).map(unquoteRuleValue);
            const negate = rule.operator === 'NOT IN';
            return (v) => {
                if (isNull(v)) return false;
                const found = items.some((item) => compare(v, item) === 0);
                return negate ? !found : found;
            };
        }
        case 'contains':
            return (v) => !isNull(v) && toText(v).toLowerCase().includes(lowerTarget);
        case 'starts with':
            return (v) => !isNull(v) && toText(v).toLowerCase().startsWith(lowerTarget);
        case 'ends with':
            return (v) => !isNull(v) && toText(v).toLowerCase().endsWith(lowerTarget);
        case 'LIKE':
        case 'NOT LIKE': {
            const pattern = likeToRegExp(target);
            const negate = rule.operator === 'NOT LIKE';
            return (v) => !isNull(v) && pattern.test(toText(v)) !== negate;
        }
        default:
            return () => false;
    }
}

/** Whether a rule can be evaluated: enabled, named column, and every value its operator needs. */
export function isFormatRuleActive(rule: FormatRule): boolean {
    return (
        rule.enabled !== false &&
        rule.column !== '' &&
        isFilterComplete({
            id: rule.id,
            column: rule.column,
            operator: rule.operator,
            value: rule.value,
            value2: rule.value2,
        })
    );
}

/**
 * Prepares rules for a result: resolves each column to its index and parses its
 * values once. Disabled and incomplete rules, and rules whose column is not in
 * the result, are left out.
 */
export function compileFormatRules(
    rules: readonly FormatRule[],
    columns: readonly string[],
): CompiledRule[] {
    const indexByName = new Map(columns.map((name, index) => [name, index]));
    const compiled: CompiledRule[] = [];
    for (const rule of rules) {
        if (!isFormatRuleActive(rule)) continue;
        const colIndex = indexByName.get(rule.column);
        if (colIndex === undefined) continue;
        compiled.push({rule, colIndex, test: buildTest(rule)});
    }
    return compiled;
}

/**
 * Formats one row. Rules are tried in order and the first matching rule wins:
 * the first row rule paints the row, and a cell rule paints its cell only when
 * no row rule matched before it. Returns null when nothing matches.
 */
export function formatRow(
    compiled: readonly CompiledRule[],
    row: readonly unknown[],
): RowFormat | null {
    let rowFormat: AppliedFormat | null = null;
    let cells: Map<number, AppliedFormat> | null = null;
    const names: string[] = [];
    for (const {rule, colIndex, test} of compiled) {
        if (
            rule.target === 'cell' ? rowFormat !== null || cells?.has(colIndex) : rowFormat !== null
        )
            continue;
        if (!test(row[colIndex])) continue;
        const applied = {tone: rule.tone, name: rule.name.trim() || rule.column};
        if (rule.target === 'row') rowFormat = applied;
        else (cells ??= new Map()).set(colIndex, applied);
        if (!names.includes(applied.name)) names.push(applied.name);
    }
    if (!rowFormat && !cells) return null;
    return {row: rowFormat, cells: cells ?? EMPTY_CELLS, names};
}

const EMPTY_CELLS: ReadonlyMap<number, AppliedFormat> = new Map();

/**
 * Formats every row, keyed by row index; rows that match nothing, and `null`
 * entries (rows to skip, such as pending insertions), are left out.
 */
export function getRowFormats(
    compiled: readonly CompiledRule[],
    rows: readonly (readonly unknown[] | null)[],
): Map<number, RowFormat> {
    const formats = new Map<number, RowFormat>();
    if (compiled.length === 0) return formats;
    rows.forEach((row, index) => {
        if (!row) return;
        const format = formatRow(compiled, row);
        if (format) formats.set(index, format);
    });
    return formats;
}

/**
 * Text color class of one cell: its own cell rule, or the muted row it sits in.
 * Null when no rule colors this cell's text.
 */
export function getFormatTextClass(
    format: RowFormat | null | undefined,
    colIndex: number,
): string | null {
    if (!format) return null;
    const cell = format.cells.get(colIndex);
    if (cell) return FORMAT_TEXT_CLASS[cell.tone];
    return format.row?.tone === 'muted' ? FORMAT_TEXT_CLASS.muted : null;
}

/** Background class of a row painted by a row rule, or null. */
export function getFormatRowClass(format: RowFormat | null | undefined): string | null {
    return format?.row ? FORMAT_ROW_CLASS[format.row.tone] : null;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

/**
 * Every rule, keyed by connection id and then by table (see {@link formatRulesScope}).
 * One UI state key holds them all, like explorer pins: the store loads only
 * registered keys at startup, so a key per table would not survive a restart.
 */
export type StoredFormatRules = Record<string, Record<string, FormatRule[]>>;

/** Where a table's rules live: its database, schema and name. JSON keeps separators from colliding. */
export function formatRulesScope(
    database: string | null | undefined,
    schema: string | null | undefined,
    table: string,
): string {
    return JSON.stringify([database ?? null, schema ?? null, table]);
}

export function getTableFormatRules(
    stored: StoredFormatRules,
    connectionId: string,
    scope: string,
): FormatRule[] {
    return stored[connectionId]?.[scope] ?? [];
}

/** Replaces a table's rules, returning new storage; empty tables and connections are dropped. */
export function setTableFormatRules(
    stored: StoredFormatRules,
    connectionId: string,
    scope: string,
    rules: readonly FormatRule[],
): StoredFormatRules {
    const tables = Object.fromEntries(
        Object.entries({
            ...stored[connectionId],
            [scope]: rules.slice(0, MAX_FORMAT_RULES_PER_TABLE),
        }).filter(([, list]) => list.length > 0),
    );
    return Object.fromEntries(
        Object.entries({...stored, [connectionId]: tables}).filter(
            ([, connectionTables]) => Object.keys(connectionTables).length > 0,
        ),
    );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** A stored rule read defensively, or null when it is malformed. */
function sanitizeRule(value: unknown): FormatRule | null {
    if (!isRecord(value)) return null;
    const {id, name, column, operator, value: ruleValue, value2, tone, target, enabled} = value;
    if (
        typeof id !== 'string' ||
        typeof name !== 'string' ||
        typeof column !== 'string' ||
        typeof ruleValue !== 'string' ||
        !FORMAT_RULE_OPERATORS.includes(operator as FilterOperator) ||
        !FORMAT_TONES.includes(tone as FormatTone) ||
        (target !== 'row' && target !== 'cell')
    ) {
        return null;
    }
    return {
        id,
        name,
        column,
        operator: operator as FilterOperator,
        value: ruleValue,
        ...(typeof value2 === 'string' ? {value2} : {}),
        tone: tone as FormatTone,
        target,
        ...(enabled === false ? {enabled: false} : {}),
    };
}

/** Reads the stored value defensively: anything malformed is skipped instead of thrown on. */
export function sanitizeFormatRules(value: unknown): StoredFormatRules {
    if (!isRecord(value)) return {};
    const stored: StoredFormatRules = {};
    for (const [connectionId, tables] of Object.entries(value)) {
        if (!isRecord(tables)) continue;
        for (const [scope, list] of Object.entries(tables)) {
            if (!Array.isArray(list)) continue;
            const rules = list
                .map(sanitizeRule)
                .filter((rule): rule is FormatRule => rule !== null)
                .slice(0, MAX_FORMAT_RULES_PER_TABLE);
            if (rules.length === 0) continue;
            stored[connectionId] = {...stored[connectionId], [scope]: rules};
        }
    }
    return stored;
}

/** A new rule on a column, with the column's first operator and the danger row tone. */
export function createFormatRule(column: string, operator: FilterOperator): FormatRule {
    return {
        id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: '',
        column,
        operator,
        value: '',
        tone: 'danger',
        target: 'row',
    };
}

/** Whether an operator takes no value (the value inputs are hidden). */
export const isNoValueOperator = (operator: FilterOperator): boolean =>
    NO_VALUE_OPS.includes(operator);
