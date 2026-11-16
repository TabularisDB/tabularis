import {describe, it, expect, vi} from 'vitest';
import {createRelationResolver, type RelationMetadataSource} from '@/utils/sqlDiagnosticsMetadata';

function source(overrides: Partial<RelationMetadataSource> = {}): RelationMetadataSource {
    const listings: Record<string, string[]> = {
        public: ['orders', 'customers'],
        sales: ['invoices'],
    };
    return {
        searchPath: ['sales', 'public'],
        listRelations: (schema) => (listings[schema] ? new Set(listings[schema]) : null),
        fetchColumns: vi.fn(async (_schema, name) => (name === 'orphan' ? [] : ['id', 'name'])),
        ...overrides,
    };
}

describe('sqlDiagnosticsMetadata', () => {
    describe('createRelationResolver', () => {
        it('finds an unqualified relation along the search path', async () => {
            const fetchColumns = vi.fn(async () => ['id']);
            const resolve = createRelationResolver(source({fetchColumns}));
            expect(await resolve({name: 'orders'})).toEqual({status: 'found', columns: ['id']});
            expect(fetchColumns).toHaveBeenCalledWith('public', 'orders');
        });

        it('prefers the first schema on the search path', async () => {
            const fetchColumns = vi.fn(async () => ['id']);
            const resolve = createRelationResolver(
                source({
                    fetchColumns,
                    listRelations: () => new Set(['orders']),
                }),
            );
            await resolve({name: 'orders'});
            expect(fetchColumns).toHaveBeenCalledTimes(1);
            expect(fetchColumns).toHaveBeenCalledWith('sales', 'orders');
        });

        it('reports missing only when every candidate listing is loaded and lacks the name', async () => {
            const resolve = createRelationResolver(source());
            expect(await resolve({name: 'ghost'})).toEqual({status: 'missing'});
            expect(await resolve({schema: 'sales', name: 'orders'})).toEqual({status: 'missing'});
        });

        it('stays unknown when a candidate schema is not loaded and has no such relation', async () => {
            const resolve = createRelationResolver(
                source({searchPath: ['archive', 'public'], fetchColumns: async () => []}),
            );
            expect(await resolve({name: 'ghost'})).toEqual({status: 'unknown'});
        });

        it('reads columns of a relation in an unloaded schema directly', async () => {
            const resolve = createRelationResolver(source());
            expect(await resolve({schema: 'archive', name: 'old_orders'})).toEqual({
                status: 'found',
                columns: ['id', 'name'],
            });
        });

        it('stays unknown when a listed relation has no readable columns', async () => {
            const resolve = createRelationResolver(
                source({listRelations: () => new Set(['orphan'])}),
            );
            expect(await resolve({schema: 'public', name: 'orphan'})).toEqual({status: 'unknown'});
        });

        it('never judges system catalogs', async () => {
            const fetchColumns = vi.fn(async () => ['x']);
            const resolve = createRelationResolver(source({fetchColumns}));
            expect(await resolve({schema: 'pg_catalog', name: 'pg_class'})).toEqual({
                status: 'unknown',
            });
            expect(await resolve({schema: 'information_schema', name: 'tables'})).toEqual({
                status: 'unknown',
            });
            expect(await resolve({name: 'pg_stat_activity'})).toEqual({status: 'unknown'});
            expect(fetchColumns).not.toHaveBeenCalled();
        });

        it('is unknown without any schema to search', async () => {
            const resolve = createRelationResolver(source({searchPath: []}));
            expect(await resolve({name: 'orders'})).toEqual({status: 'unknown'});
        });
    });
});
