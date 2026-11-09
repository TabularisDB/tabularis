import type {RelationLookup, RelationRequest, RelationResolver} from './sqlDiagnostics';

export interface RelationMetadataSource {
    /** Schemas an unqualified name is looked up in, in order. */
    searchPath: readonly string[];
    /** Tables, views and materialized views of a schema; null while it is not loaded. */
    listRelations(schema: string): ReadonlySet<string> | null;
    /** Column names of one relation; empty when they cannot be read. */
    fetchColumns(schema: string, name: string): Promise<string[]>;
}

const isSystemSchema = (schema: string): boolean =>
    schema === 'information_schema' || schema.startsWith('pg_');

// Resolves one relation against what is already loaded, reading columns only
// for relations the query names. A relation is `missing` only when every schema
// it could live in has a loaded listing that lacks it; anything less certain is
// `unknown`, so a draft never gets a definite error from incomplete metadata.
export function createRelationResolver(source: RelationMetadataSource): RelationResolver {
    return async ({schema, name}: RelationRequest): Promise<RelationLookup> => {
        if (!schema && name.startsWith('pg_')) return {status: 'unknown'};
        const candidates = schema ? [schema] : source.searchPath;
        let uncertain = candidates.length === 0;

        for (const candidate of candidates) {
            if (isSystemSchema(candidate)) {
                uncertain = true;
                continue;
            }
            const listed = source.listRelations(candidate);
            if (listed && !listed.has(name)) continue;
            const columns = await source.fetchColumns(candidate, name);
            if (columns.length > 0) return {status: 'found', columns};
            uncertain = true;
        }
        return uncertain ? {status: 'unknown'} : {status: 'missing'};
    };
}
