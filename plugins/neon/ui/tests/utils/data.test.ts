import {describe, expect, it} from 'vitest';
import {displayValue, objectRows} from '../../src/utils/data';

describe('data', () => {
    it('formats scalar and structured values', () => {
        expect([null, undefined, false, 0, 'hello', {ok: true}].map(displayValue)).toEqual([
            'NULL',
            'NULL',
            'false',
            '0',
            'hello',
            '{"ok":true}',
        ]);
    });
    it('aligns heterogeneous rows to their shared columns', () => {
        expect(objectRows([{id: 1}, {id: 2, name: 'two'}])).toEqual({
            columns: ['id', 'name'],
            rows: [
                [1, undefined],
                [2, 'two'],
            ],
        });
        expect(objectRows([])).toEqual({columns: [], rows: []});
    });
});
