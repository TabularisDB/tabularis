import {clamp} from './number';

/**
 * How many pages a result set spans.
 * Returns null when the total row count is unknown or the page size cannot
 * produce a count. An empty result (`totalRows === 0`) has a page count of 0.
 */
export function totalPageCount(totalRows: number | null, pageSize: number): number | null {
    if (totalRows === null || !Number.isFinite(totalRows) || totalRows < 0) return null;
    if (!Number.isFinite(pageSize) || pageSize <= 0) return null;
    return Math.ceil(totalRows / pageSize);
}

/**
 * Private-use marker substituted for `{{current}}` so a translated
 * "Page N of M" label can wrap the page input without assuming word order.
 */
export const PAGE_INPUT_SLOT = '\uE000';

/** Splits a label around {@link PAGE_INPUT_SLOT}. Null when the marker is absent. */
export function splitAroundPageSlot(label: string): {before: string; after: string} | null {
    const index = label.indexOf(PAGE_INPUT_SLOT);
    if (index === -1) return null;
    return {
        before: label.slice(0, index),
        after: label.slice(index + PAGE_INPUT_SLOT.length),
    };
}

/**
 * Page to load from a typed value, or null when the field should revert.
 *
 * Integers outside `[1, totalPages]` clamp when the total is a positive count.
 * When `totalPages` is null, only positive integers are accepted.
 * Empty text and anything that is not an integer revert.
 * A non-positive total (no page exists) also reverts.
 */
export function resolvePageJump(raw: string, totalPages: number | null): number | null {
    const trimmed = raw.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) return null;

    const value = Number(trimmed);
    const knownTotal =
        totalPages !== null && Number.isInteger(totalPages) && totalPages >= 1 ? totalPages : null;

    if (!Number.isSafeInteger(value)) {
        if (knownTotal === null) return null;
        return trimmed.startsWith('-') ? 1 : knownTotal;
    }

    if (knownTotal === null) {
        if (totalPages !== null) return null;
        return value >= 1 ? value : null;
    }

    return clamp(value, 1, knownTotal);
}
