import type {QueryResult} from '@/types/editor';
import type {CellKpiConfig} from '@/types/notebook';

/** Largest number of decimal places a KPI may be configured with. */
export const KPI_MAX_DECIMALS = 20;

/**
 * What a KPI card shows for a cell. Every state except `value` explains why
 * no number is shown; a multi-row result is never reduced to its first row.
 */
export type KpiState =
    | {kind: 'value'; text: string}
    | {kind: 'noOutput'}
    | {kind: 'error'}
    | {kind: 'noRows'}
    | {kind: 'multipleRows'; count: number}
    | {kind: 'missingColumn'; column: string}
    | {kind: 'null'}
    | {kind: 'notNumeric'; raw: string};

/** An exact decimal: sign, integer digits and fraction digits, no exponent. */
interface ExactDecimal {
    negative: boolean;
    integer: string;
    fraction: string;
}

const DECIMAL_PATTERN = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
const MAX_EXPONENT = 1000;

/**
 * Parse a number, bigint or decimal string into exact digits, without going
 * through `Number` (which would lose large integers and long decimals).
 * Returns null for anything that is not a finite decimal number.
 */
export function parseExactDecimal(value: unknown): ExactDecimal | null {
    let text: string;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return null;
        text = String(value);
    } else if (typeof value === 'bigint') {
        text = value.toString();
    } else if (typeof value === 'string') {
        text = value.trim();
    } else {
        return null;
    }
    const match = DECIMAL_PATTERN.exec(text);
    if (!match) return null;
    const [, sign, intRaw = '', fracRaw = '', expRaw] = match;
    if (intRaw === '' && fracRaw === '') return null;
    const exponent = expRaw ? Number(expRaw) : 0;
    if (Math.abs(exponent) > MAX_EXPONENT) return null;

    // Move the decimal point by the exponent.
    let digits = intRaw + fracRaw;
    let point = intRaw.length + exponent;
    if (point < 0) {
        digits = '0'.repeat(-point) + digits;
        point = 0;
    } else if (point > digits.length) {
        digits = digits + '0'.repeat(point - digits.length);
    }
    const integer = digits.slice(0, point).replace(/^0+/, '') || '0';
    const fraction = digits.slice(point).replace(/0+$/, '');
    const isZero = /^0*$/.test(integer + fraction);
    return {negative: sign === '-' && !isZero, integer, fraction};
}

/** Add one to a string of decimal digits ("199" -> "200", "99" -> "100"). */
function incrementDigits(digits: string): string {
    const chars = digits.split('');
    let i = chars.length - 1;
    while (i >= 0) {
        if (chars[i] === '9') {
            chars[i] = '0';
            i--;
        } else {
            chars[i] = String(Number(chars[i]) + 1);
            return chars.join('');
        }
    }
    return '1' + chars.join('');
}

/** Round to `decimals` fraction digits, half away from zero, exactly. */
export function roundExactDecimal(value: ExactDecimal, decimals: number): ExactDecimal {
    if (value.fraction.length <= decimals) {
        return {...value, fraction: value.fraction.padEnd(decimals, '0')};
    }
    const kept = value.integer + value.fraction.slice(0, decimals);
    const roundUp = value.fraction.charCodeAt(decimals) >= '5'.charCodeAt(0);
    const rounded = roundUp ? incrementDigits(kept) : kept;
    const split = rounded.length - decimals;
    const integer = rounded.slice(0, split).replace(/^0+/, '') || '0';
    const fraction = rounded.slice(split);
    const isZero = /^0*$/.test(integer + fraction);
    return {negative: value.negative && !isZero, integer, fraction};
}

function separators(locale: string): {decimal: string; minus: string} {
    let format: Intl.NumberFormat;
    try {
        format = new Intl.NumberFormat(locale);
    } catch {
        format = new Intl.NumberFormat('en');
    }
    const parts = format.formatToParts(-1.5);
    return {
        decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
        minus: parts.find((p) => p.type === 'minusSign')?.value ?? '-',
    };
}

function groupInteger(integer: string, locale: string): string {
    const options: Intl.NumberFormatOptions = {useGrouping: true};
    try {
        return new Intl.NumberFormat(locale, options).format(BigInt(integer));
    } catch {
        return new Intl.NumberFormat('en', options).format(BigInt(integer));
    }
}

/**
 * Format an exact decimal for `locale`: grouped integer digits and the
 * locale's decimal separator and minus sign. The digits themselves are never
 * converted to a floating-point number. `decimals` null keeps every fraction
 * digit of the value.
 */
export function formatExactDecimal(
    value: ExactDecimal,
    decimals: number | null | undefined,
    locale: string,
): string {
    const rounded = decimals == null ? value : roundExactDecimal(value, decimals);
    const {decimal, minus} = separators(locale);
    const integer = groupInteger(rounded.integer, locale);
    const fraction = rounded.fraction ? `${decimal}${rounded.fraction}` : '';
    return `${rounded.negative ? minus : ''}${integer}${fraction}`;
}

function rawText(value: unknown): string {
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value);
}

/**
 * Work out what the KPI card of a cell shows, from the result and error that
 * are already loaded. Never runs anything.
 */
export function computeKpiState(
    result: QueryResult | null | undefined,
    error: string | undefined,
    config: CellKpiConfig,
    locale: string,
): KpiState {
    if (error) return {kind: 'error'};
    if (!result) return {kind: 'noOutput'};
    if (result.rows.length === 0) return {kind: 'noRows'};
    if (result.rows.length > 1) return {kind: 'multipleRows', count: result.rows.length};
    const colIndex = result.columns.indexOf(config.column);
    if (colIndex === -1) return {kind: 'missingColumn', column: config.column};
    const value = result.rows[0][colIndex];
    if (value === null || value === undefined) return {kind: 'null'};
    const exact = parseExactDecimal(value);
    if (!exact) return {kind: 'notNumeric', raw: rawText(value)};
    const number = formatExactDecimal(exact, config.decimals, locale);
    return {kind: 'value', text: `${config.prefix ?? ''}${number}${config.suffix ?? ''}`};
}

/**
 * A KPI configuration for a result: the first column whose value in the first
 * row is numeric, else the first column. Labelled with the column name.
 */
export function buildDefaultKpiConfig(
    result: QueryResult | null | undefined,
): CellKpiConfig | null {
    if (!result || result.columns.length === 0) return null;
    const row = result.rows[0];
    const numericIndex = row
        ? row.findIndex((v) => v != null && parseExactDecimal(v) !== null)
        : -1;
    const column = result.columns[numericIndex === -1 ? 0 : numericIndex];
    return {column, label: column};
}

/** Clamp a decimal-places setting to a whole number in 0..KPI_MAX_DECIMALS, or null. */
export function normalizeKpiDecimals(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.min(KPI_MAX_DECIMALS, Math.max(0, Math.trunc(value)));
}

/**
 * Keep a well-formed KPI configuration from an untrusted notebook file, or
 * null when it has no column to show.
 */
export function sanitizeKpiConfig(raw: unknown): CellKpiConfig | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.column !== 'string' || obj.column === '') return null;
    const config: CellKpiConfig = {column: obj.column};
    if (typeof obj.label === 'string') config.label = obj.label;
    const decimals = normalizeKpiDecimals(obj.decimals);
    if (decimals !== null) config.decimals = decimals;
    if (typeof obj.prefix === 'string') config.prefix = obj.prefix;
    if (typeof obj.suffix === 'string') config.suffix = obj.suffix;
    return config;
}
