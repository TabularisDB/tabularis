import {describe, it, expect} from 'vitest';
import {databaseSummary} from '../../src/utils/status';

describe('databaseSummary', () => {
    it('uses column names and keeps compiler details out of the short version', () => {
        expect(
            databaseSummary({
                columns: ['version', 'database'],
                rows: [['PostgreSQL 18.6 (build) on Linux', 'neondb']],
            }),
        ).toEqual({name: 'neondb', version: '18.6', details: 'PostgreSQL 18.6 (build) on Linux'});
    });
    it('handles empty or unfamiliar metadata without inventing a version', () => {
        expect(databaseSummary({columns: [], rows: []})).toEqual({
            name: '',
            version: '',
            details: '',
        });
        expect(
            databaseSummary({columns: ['database', 'version'], rows: [[null, 'Custom server']]}),
        ).toEqual({name: '', version: '', details: 'Custom server'});
    });
});
