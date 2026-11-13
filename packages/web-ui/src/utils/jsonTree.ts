import type {CollapseState, CompareFunction, ExternalTriggers, JsonData} from 'json-edit-react';

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

/** Depths offered by the "Expand to level" control; the root collection is level 1. */
export const JSON_TREE_EXPAND_LEVELS = [1, 2, 3] as const;

type JsonTreePath = CollapseState['path'];

/**
 * Builds a fresh `externalTriggers` object that opens every collection down to
 * `level` (the root collection is level 1) and collapses everything deeper.
 *
 * The editor applies the first entry whose path matches a node, so each
 * collection to open gets its own exact-path entry, followed by a catch-all
 * that collapses the root and all its descendants. Array indexes are numbers,
 * as in the editor's own paths, so the result does not depend on key sorting.
 */
export function buildExpandToLevelTrigger(value: unknown, level: number): ExternalTriggers {
    const open: CollapseState[] = [];
    const visit = (node: unknown, path: JsonTreePath) => {
        if (typeof node !== 'object' || node === null || path.length >= level) return;
        open.push({path, collapsed: false, includeChildren: false});
        if (Array.isArray(node)) {
            node.forEach((child, index) => visit(child, [...path, index]));
        } else {
            for (const [key, child] of Object.entries(node)) visit(child, [...path, key]);
        }
    };
    visit(value, []);
    return {collapse: [...open, {path: [], collapsed: true, includeChildren: true}]};
}

const keyCollator = new Intl.Collator(undefined, {numeric: true});

/**
 * Orders object keys for the tree's `keySort`. The editor's default compares
 * keys as plain strings, which shows "10" before "2"; this keeps digit runs in
 * numeric order and ignores case at the first pass ("apple" before "Banana").
 */
export const compareJsonKeys: CompareFunction = ([a], [b]) =>
    keyCollator.compare(String(a), String(b));
