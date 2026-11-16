import {splitBatches} from './sqlSplitter';
import {
    diagnoseParsedSelect,
    parseSelectStatement,
    relationKey,
    type RelationLookup,
    type RelationRequest,
    type RelationResolver,
    type SqlDiagnostic,
} from './sqlDiagnostics';

// Hard bounds keep a large script from turning one keystroke into a long scan
// or a burst of metadata requests.
export const MAX_DIAGNOSTICS_DOCUMENT_LENGTH = 200_000;
export const MAX_DIAGNOSTICS_STATEMENTS = 50;
export const MAX_DIAGNOSTICS_RELATIONS = 25;

const UNKNOWN: RelationLookup = {status: 'unknown'};

const DDL_TARGET =
    /\b(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:(?:global|local|temp|temporary|unlogged|materialized|recursive)\s+)*(?:table|view)\s+(?:if\s+(?:not\s+)?exists\s+)?(?:only\s+)?("(?:[^"]|"")+"|[\p{L}_][\p{L}\p{N}_$]*)(?:\s*\.\s*("(?:[^"]|"")+"|[\p{L}_][\p{L}\p{N}_$]*))?/giu;

const foldIdentifier = (token: string): string =>
    token.startsWith('"') ? token.slice(1, -1).replaceAll('""', '"') : token.toLowerCase();

// Relations a script creates, alters or drops itself. The loaded metadata is
// stale for them, so they are never reported as missing or as lacking a column.
function collectScriptRelations(text: string): Set<string> {
    const names = new Set<string>();
    for (const match of text.matchAll(DDL_TARGET)) {
        const last = match[2] ?? match[1];
        names.add(foldIdentifier(last));
    }
    return names;
}

export interface AnalyzeDocumentOptions {
    resolveRelation: RelationResolver;
    signal?: AbortSignal;
}

/**
 * Diagnoses every statement in the editor text. Resolves metadata through the
 * injected resolver only for relations the SELECT statements actually name.
 * Returns an empty list when `signal` aborts: the caller must discard it.
 */
export async function analyzeDocument(
    text: string,
    {resolveRelation, signal}: AnalyzeDocumentOptions,
): Promise<SqlDiagnostic[]> {
    if (text.length > MAX_DIAGNOSTICS_DOCUMENT_LENGTH) return [];

    const statements = splitBatches(text, 'postgres').slice(0, MAX_DIAGNOSTICS_STATEMENTS);
    const parsed = statements.flatMap((statement) => {
        const result = parseSelectStatement(text.slice(statement.range.start, statement.range.end));
        return result ? [{offset: statement.range.start, result}] : [];
    });
    if (parsed.length === 0) return [];

    const scriptRelations = collectScriptRelations(text);
    const requests = new Map<string, RelationRequest>();
    for (const {result} of parsed) {
        for (const request of result.relations) {
            requests.set(relationKey(request.schema, request.name), request);
        }
    }

    const lookups = new Map<string, RelationLookup>();
    await Promise.all(
        [...requests.entries()].map(async ([key, request], index) => {
            if (scriptRelations.has(request.name) || index >= MAX_DIAGNOSTICS_RELATIONS) {
                lookups.set(key, UNKNOWN);
                return;
            }
            try {
                lookups.set(key, await resolveRelation(request));
            } catch {
                lookups.set(key, UNKNOWN);
            }
        }),
    );
    if (signal?.aborted) return [];

    return parsed.flatMap(({offset, result}) =>
        diagnoseParsedSelect(result, lookups).map((diagnostic) => ({
            ...diagnostic,
            start: diagnostic.start + offset,
            end: diagnostic.end + offset,
        })),
    );
}
