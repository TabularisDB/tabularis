import type {DriverCapabilities} from '@/types/plugins';
import {isMysqlDialect} from './identifiers';

export type BooleanDriver = string | DriverCapabilities | null | undefined;

export function isBooleanColumnType(type?: string, driver?: BooleanDriver): boolean {
    const normalized = type?.trim().toLowerCase();
    const dialect = typeof driver === 'object' ? driver?.sql_dialect : driver;
    return (
        !!normalized &&
        (/^(?:pg_catalog\.)?bool(?:ean)?$/.test(normalized) ||
            (isMysqlDialect(driver) &&
                /^(?:tinyint\s*\(\s*1\s*\)(?:\s+unsigned)?|bit\s*\(\s*1\s*\))$/.test(normalized)) ||
            (dialect === 'mssql' && normalized === 'bit'))
    );
}

/** Only called after the column has been identified as Boolean. */
export function parseBooleanValue(value: unknown): boolean | null | undefined {
    if (value === null || value === undefined) return null;
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;
    if (typeof value === 'string') {
        if (/^(true|t|1)$/i.test(value)) return true;
        if (/^(false|f|0)$/i.test(value)) return false;
    }
    return undefined;
}

/** Undefined means this type or value must keep its ordinary editor. */
export function getBooleanValue(
    value: unknown,
    type?: string,
    driver?: BooleanDriver,
): boolean | null | undefined {
    const supported = type?.trim() ? isBooleanColumnType(type, driver) : typeof value === 'boolean';
    return supported ? parseBooleanValue(value) : undefined;
}

/** Retain the driver's wire representation, including when reverting an edit. */
export function booleanEditValue(next: boolean | null, original: unknown, type?: string): unknown {
    if (next === null) return null;
    if (typeof original === 'number') return next ? 1 : 0;
    if (typeof original === 'string') {
        if (/^[01]$/.test(original)) return next ? '1' : '0';
        if (/^[tf]$/i.test(original)) {
            const value = next ? 't' : 'f';
            return original === original.toUpperCase() ? value.toUpperCase() : value;
        }
        if (/^(true|false)$/i.test(original)) {
            if (original.toLowerCase() === String(next)) return original;
            const value = next ? 'true' : 'false';
            return original === original.toUpperCase() ? value.toUpperCase() : value;
        }
    }
    if (/^(tinyint|bit)\b/i.test(type?.trim() ?? '')) return next ? 1 : 0;
    return next;
}
