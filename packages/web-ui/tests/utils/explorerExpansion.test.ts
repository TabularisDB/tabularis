import {describe, expect, it} from 'vitest';
import {
    expansionKey,
    readExpanded,
    sanitizeExplorerExpansion,
    withExpanded,
} from '@/utils/explorerExpansion';

describe('expansionKey', () => {
    it('separates connections, node kinds and paths', () => {
        const table = expansionKey('conn', ['table', 'shop', 'public', 'orders']);
        expect(table).not.toBe(expansionKey('other', ['table', 'shop', 'public', 'orders']));
        expect(table).not.toBe(expansionKey('conn', ['view', 'shop', 'public', 'orders']));
        expect(table).not.toBe(expansionKey('conn', ['table', 'shop', 'sales', 'orders']));
        expect(table).not.toBe(expansionKey('conn', ['table', 'crm', 'public', 'orders']));
    });

    it('does not let names containing separators collide', () => {
        expect(expansionKey('conn', ['table', 'a,b', 'c'])).not.toBe(
            expansionKey('conn', ['table', 'a', 'b,c']),
        );
    });

    it('treats a missing database or schema as an empty string', () => {
        expect(expansionKey('conn', ['table', undefined, null, 'orders'])).toBe(
            expansionKey('conn', ['table', '', '', 'orders']),
        );
    });
});

describe('readExpanded', () => {
    it('returns the saved boolean of one node', () => {
        expect(readExpanded({a: true, b: false}, 'a')).toBe(true);
        expect(readExpanded({a: true, b: false}, 'b')).toBe(false);
    });

    it('returns undefined for missing, invalid or inherited entries', () => {
        expect(readExpanded({a: true}, 'missing')).toBeUndefined();
        expect(readExpanded({a: 'yes'}, 'a')).toBeUndefined();
        expect(readExpanded({}, 'toString')).toBeUndefined();
        expect(readExpanded(null, 'a')).toBeUndefined();
        expect(readExpanded('broken', 'a')).toBeUndefined();
        expect(readExpanded(['a'], '0')).toBeUndefined();
    });
});

describe('sanitizeExplorerExpansion', () => {
    it('keeps a valid map as the same object', () => {
        const value = {a: true, b: false};
        expect(sanitizeExplorerExpansion(value)).toBe(value);
    });

    it('drops non-boolean entries and rejects non-objects', () => {
        expect(sanitizeExplorerExpansion({a: true, b: 1, c: null})).toEqual({a: true});
        expect(sanitizeExplorerExpansion('broken')).toEqual({});
        expect(sanitizeExplorerExpansion([true])).toEqual({});
        expect(sanitizeExplorerExpansion(null)).toEqual({});
        expect(sanitizeExplorerExpansion(undefined)).toEqual({});
    });
});

describe('withExpanded', () => {
    it('stores a state that differs from the default', () => {
        expect(withExpanded({}, 'a', true, false)).toEqual({a: true});
        expect(withExpanded({}, 'a', false, true)).toEqual({a: false});
    });

    it('removes the entry when the state matches the default again', () => {
        expect(withExpanded({a: true, b: true}, 'a', false, false)).toEqual({b: true});
    });

    it('returns the same object when nothing changes', () => {
        const value = {a: true};
        expect(withExpanded(value, 'a', true, false)).toBe(value);
        expect(withExpanded(value, 'b', false, false)).toBe(value);
    });

    it('does not modify the given map', () => {
        const value = {a: true};
        withExpanded(value, 'a', false, false);
        withExpanded(value, 'b', true, false);
        expect(value).toEqual({a: true});
    });
});
