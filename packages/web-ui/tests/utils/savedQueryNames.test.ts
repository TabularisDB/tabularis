import {describe, expect, it} from 'vitest';
import {getSavedQueryCopyName} from '@/utils/savedQueryNames';

describe('getSavedQueryCopyName', () => {
    it('uses (copy) for the first duplicate', () => {
        expect(getSavedQueryCopyName('Cleanup', ['Cleanup'])).toBe('Cleanup (copy)');
    });

    it('chooses the next unused number', () => {
        expect(
            getSavedQueryCopyName('Cleanup', ['Cleanup', 'Cleanup (copy)', 'Cleanup (copy 2)']),
        ).toBe('Cleanup (copy 3)');
    });

    it('keeps the SQL query name unchanged when no copies exist', () => {
        expect(getSavedQueryCopyName('Monthly report', [])).toBe('Monthly report (copy)');
    });

    it('does not change the input names', () => {
        const existing = ['Cleanup', 'Cleanup (copy)'];
        expect(getSavedQueryCopyName('Cleanup', existing)).toBe('Cleanup (copy 2)');
        expect(existing).toEqual(['Cleanup', 'Cleanup (copy)']);
    });
});
