import type {CompareFunction, ExternalTriggers, JsonData} from 'json-edit-react';

export {isJsonColumn} from './json';

export type JsonTreeData = JsonData;

export interface SafeParseResult {
    value: unknown;
    error?: string;
}

export function safeParse(text: string): SafeParseResult {
    if (text.trim() === '') return {value: null};
    try {
        return {value: JSON.parse(text)};
    } catch (e) {
        const message = e instanceof SyntaxError ? e.message : 'Invalid JSON';
        return {value: null, error: message};
    }
}

/** Only objects and arrays have nodes that can be expanded or collapsed. */
export function hasCollapsibleNodes(value: unknown): boolean {
    return typeof value === 'object' && value !== null;
}

/**
 * Builds a fresh `externalTriggers` object that collapses or expands the whole
 * tree. The editor reacts to a new object identity, so every call must return
 * a new object even when the requested state is unchanged.
 */
export function buildCollapseTrigger(collapsed: boolean): ExternalTriggers {
    return {collapse: {path: [], collapsed, includeChildren: true}};
}

const keyCollator = new Intl.Collator(undefined, {numeric: true});

/**
 * Orders object keys for the tree's `keySort`. The editor's default compares
 * keys as plain strings, which shows "10" before "2"; this keeps digit runs in
 * numeric order and ignores case at the first pass ("apple" before "Banana").
 */
export const compareJsonKeys: CompareFunction = ([a], [b]) =>
    keyCollator.compare(String(a), String(b));
