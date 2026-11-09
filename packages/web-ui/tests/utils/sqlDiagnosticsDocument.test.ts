import {describe, it, expect, vi} from 'vitest';
import {
    analyzeDocument,
    MAX_DIAGNOSTICS_DOCUMENT_LENGTH,
    MAX_DIAGNOSTICS_RELATIONS,
} from '@/utils/sqlDiagnosticsDocument';
import type {RelationResolver} from '@/utils/sqlDiagnostics';

const columns: Record<string, string[]> = {
    orders: ['id', 'customer_id', 'total'],
    customers: ['id', 'name'],
};

const resolver = (): RelationResolver =>
    vi.fn(async ({name}) =>
        columns[name] ? {status: 'found', columns: columns[name]} : {status: 'missing'},
    );

describe('sqlDiagnosticsDocument', () => {
    describe('analyzeDocument', () => {
        it('reports document offsets for statements after the first', async () => {
            const text = 'SELECT 1;\n\n  -- note\n  SELECT o.custmer_id FROM orders o;';
            const found = await analyzeDocument(text, {resolveRelation: resolver()});
            expect(found).toHaveLength(1);
            expect(text.slice(found[0].start, found[0].end)).toBe('custmer_id');
        });

        it('analyzes statements independently', async () => {
            const text = 'SELECT o.id FROM orders o;\nSELECT c.nope FROM customers c;';
            const found = await analyzeDocument(text, {resolveRelation: resolver()});
            expect(found.map((d) => d.name)).toEqual(['c.nope']);
        });

        it('ignores statements outside the SELECT subset', async () => {
            const resolveRelation = resolver();
            const found = await analyzeDocument(
                'UPDATE orders SET nope = 1; INSERT INTO orders (nope) VALUES (1);',
                {resolveRelation},
            );
            expect(found).toEqual([]);
            expect(resolveRelation).not.toHaveBeenCalled();
        });

        it('asks the resolver once per distinct relation across statements', async () => {
            const resolveRelation = resolver();
            await analyzeDocument(
                'SELECT * FROM orders; SELECT * FROM orders o JOIN customers c ON true;',
                {resolveRelation},
            );
            expect(resolveRelation).toHaveBeenCalledTimes(2);
        });

        it('keeps a relation the script creates or alters out of the missing set', async () => {
            const text = `CREATE TEMP TABLE scratch (id int);
                ALTER TABLE orders ADD COLUMN extra int;
                SELECT s.id FROM scratch s;
                SELECT o.extra FROM orders o;`;
            const found = await analyzeDocument(text, {resolveRelation: resolver()});
            expect(found.map((d) => d.code)).toEqual([
                'metadataUnavailable',
                'metadataUnavailable',
            ]);
        });

        it('treats a failing lookup as unknown, not as an error', async () => {
            const found = await analyzeDocument('SELECT o.nope FROM orders o', {
                resolveRelation: vi.fn().mockRejectedValue(new Error('offline')),
            });
            expect(found.map((d) => d.code)).toEqual(['metadataUnavailable']);
        });

        it('returns nothing once aborted', async () => {
            const controller = new AbortController();
            const pending = analyzeDocument('SELECT o.nope FROM orders o', {
                resolveRelation: async () => {
                    controller.abort();
                    return {status: 'found', columns: ['id']};
                },
                signal: controller.signal,
            });
            await expect(pending).resolves.toEqual([]);
        });

        it('does not look up more relations than the bound', async () => {
            const resolveRelation = resolver();
            const count = MAX_DIAGNOSTICS_RELATIONS + 5;
            const joins = Array.from({length: count}, (_, i) => `JOIN t${i} ON true`).join(' ');
            await analyzeDocument(`SELECT 1 FROM orders ${joins}`, {resolveRelation});
            expect(resolveRelation).toHaveBeenCalledTimes(MAX_DIAGNOSTICS_RELATIONS);
        });

        it('skips oversized documents', async () => {
            const resolveRelation = resolver();
            const text = `SELECT o.nope FROM orders o; -- ${'x'.repeat(MAX_DIAGNOSTICS_DOCUMENT_LENGTH)}`;
            expect(await analyzeDocument(text, {resolveRelation})).toEqual([]);
            expect(resolveRelation).not.toHaveBeenCalled();
        });
    });
});
