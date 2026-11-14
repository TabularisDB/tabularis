// Collects the evidence of where one column is used (#1407): declared foreign
// keys, view definitions and this connection's query history. Every source
// reports how far it got, so a source that failed, was cut short or is not
// supported never reads as "no dependencies".

import type {ForeignKey} from '@/types/schema';
import type {TableSchema} from '@/types/editor';
import type {QueryHistoryEntry} from '@/types/queryHistory';
import type {DialectInput} from './sqlSplitter';
import {toErrorMessage} from './errors';
import {getReferencedSchema} from './foreignKeys';
import {
    buildUsageSnippet,
    catalogNamesEqual,
    findColumnReferences,
    identifierRulesFor,
    nameKey,
    strongestMatch,
    type ColumnUsageConfidence,
    type ColumnUsageTarget,
    type RelationRef,
    type SqlColumnMatch,
    type UncertainReason,
    type UsageSnippet,
} from './columnUsage';

export type UsageSourceKind = 'foreignKeys' | 'views' | 'history';

export type UsageSourceStatus =
    | 'pending'
    | 'complete'
    | 'partial'
    | 'unsupported'
    | 'permission-denied'
    | 'failed'
    | 'cancelled';

export interface UsageSourceState {
    status: UsageSourceStatus;
    /** Items read (views, history entries, foreign-key lookups). */
    scanned: number;
    /** Items there were, when known. */
    total: number | null;
    /** The first error a lookup returned, as the driver worded it. */
    message?: string;
}

export interface ColumnUsageEvidence {
    id: string;
    source: 'foreign-key' | 'view' | 'history';
    confidence: ColumnUsageConfidence;
    reason?: UncertainReason;
    /** Table or view this evidence points to. */
    objectName?: string;
    objectSchema?: string;
    /** Foreign keys: whether the target column references, or is referenced by, `objectName`. */
    direction?: 'outgoing' | 'incoming';
    /** Foreign keys: the column on the other side. */
    relatedColumn?: string;
    constraintName?: string;
    /** History: the run, including whether it failed and the error it gave. */
    historyEntry?: Pick<
        QueryHistoryEntry,
        'id' | 'sql' | 'executedAt' | 'database' | 'status' | 'error'
    >;
    /** How many references the SQL holds (views and history). */
    matchCount?: number;
    snippet?: UsageSnippet;
}

export interface ColumnUsageResult {
    sources: Record<UsageSourceKind, UsageSourceState>;
    evidence: ColumnUsageEvidence[];
}

/** The lookups a collection needs; each maps to one backend command. */
export interface ColumnUsageLookups {
    getForeignKeys: () => Promise<ForeignKey[]>;
    getSchemaSnapshot: () => Promise<TableSchema[]>;
    getViews: () => Promise<{name: string; definition?: string}[]>;
    getViewDefinition: (viewName: string) => Promise<string>;
    getHistory: () => Promise<QueryHistoryEntry[]>;
}

export interface ColumnUsageLimits {
    maxViews: number;
    maxHistoryEntries: number;
    /** Longer SQL texts are skipped and make the source partial. */
    maxSqlLength: number;
}

export const DEFAULT_COLUMN_USAGE_LIMITS: ColumnUsageLimits = {
    maxViews: 200,
    maxHistoryEntries: 2000,
    maxSqlLength: 200_000,
};

export interface CollectColumnUsageOptions {
    target: ColumnUsageTarget;
    dialect?: DialectInput;
    /** The driver can list views (its `views` capability). */
    viewsSupported: boolean;
    limits?: Partial<ColumnUsageLimits>;
    signal?: AbortSignal;
    /** Called with a fresh result after each step. */
    onProgress?: (result: ColumnUsageResult) => void;
}

const PERMISSION_PATTERN =
    /permission denied|access denied|insufficient privilege|not authori[sz]ed|command denied|must be owner|privilege/i;
const UNSUPPORTED_PATTERN =
    /not supported|unsupported|not implemented|unknown method|method not found/i;

/** Whether an error message says the user lacks rights, or the driver lacks the feature. */
export function classifyLookupError(
    message: string,
): 'permission-denied' | 'unsupported' | 'failed' {
    if (PERMISSION_PATTERN.test(message)) return 'permission-denied';
    if (UNSUPPORTED_PATTERN.test(message)) return 'unsupported';
    return 'failed';
}

/**
 * The status of a source that read `scanned` of `total` items, met `errors`
 * failures (the first one's message in `firstError`) and stopped early when
 * `truncated` (a limit was hit).
 */
function settle(
    scanned: number,
    total: number | null,
    errors: string[],
    truncated: boolean,
): UsageSourceState {
    if (errors.length > 0 && scanned === 0) {
        return {status: classifyLookupError(errors[0]), scanned, total, message: errors[0]};
    }
    if (errors.length > 0 || truncated) {
        return {status: 'partial', scanned, total, ...(errors[0] ? {message: errors[0]} : {})};
    }
    return {status: 'complete', scanned, total};
}

function matchEvidence(
    sql: string,
    matches: SqlColumnMatch[],
    dialect: DialectInput,
): Pick<ColumnUsageEvidence, 'confidence' | 'reason' | 'matchCount' | 'snippet'> | null {
    const best = strongestMatch(matches);
    if (!best) return null;
    return {
        confidence: best.confidence,
        ...(best.reason ? {reason: best.reason} : {}),
        matchCount: matches.length,
        snippet: buildUsageSnippet(sql, best.start, best.end, dialect),
    };
}

const CONFIDENCE_ORDER: Record<ColumnUsageConfidence, number> = {
    confirmed: 0,
    parsed: 1,
    uncertain: 2,
};

/** Evidence ordered by confidence (confirmed first), keeping each source's own order. */
export function sortEvidence(evidence: readonly ColumnUsageEvidence[]): ColumnUsageEvidence[] {
    return evidence
        .map((item, index) => ({item, index}))
        .sort(
            (a, b) =>
                CONFIDENCE_ORDER[a.item.confidence] - CONFIDENCE_ORDER[b.item.confidence] ||
                a.index - b.index,
        )
        .map(({item}) => item);
}

// How often the history scan yields: every this many entries, or sooner
// when one stretch of matching has run this long.
const YIELD_EVERY_ENTRIES = 100;
const YIELD_EVERY_MS = 16;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Reads every source in turn, one lookup at a time, and stops between
 * lookups once `signal` aborts: what is left is marked cancelled.
 */
export async function collectColumnUsage(
    lookups: ColumnUsageLookups,
    options: CollectColumnUsageOptions,
): Promise<ColumnUsageResult> {
    const {target, dialect, signal} = options;
    // Catalog names compare by the dialect's identifier rules: PostgreSQL's
    // "Orders" is not orders, nor is MySQL's Orders on Linux, SQL Server's
    // under a case-sensitive collation or SQLite's "Ä" for "ä".
    const rules = identifierRulesFor(dialect);
    const sameTable = (a: string | null | undefined, b: string | null | undefined): boolean =>
        catalogNamesEqual(a ?? '', b ?? '', rules.tables);
    const sameColumn = (a: string | null | undefined, b: string | null | undefined): boolean =>
        catalogNamesEqual(a ?? '', b ?? '', rules.columns);
    const tableKey = (name: string) => nameKey(name, rules.tables);
    const limits = {...DEFAULT_COLUMN_USAGE_LIMITS, ...options.limits};
    const result: ColumnUsageResult = {
        sources: {
            foreignKeys: {status: 'pending', scanned: 0, total: null},
            views: {status: 'pending', scanned: 0, total: null},
            history: {status: 'pending', scanned: 0, total: null},
        },
        evidence: [],
    };
    const publish = () =>
        options.onProgress?.({sources: {...result.sources}, evidence: [...result.evidence]});
    const cancelled = () => signal?.aborted === true;
    const cancelRest = () => {
        for (const key of Object.keys(result.sources) as UsageSourceKind[]) {
            if (result.sources[key].status === 'pending') {
                result.sources[key] = {...result.sources[key], status: 'cancelled'};
            }
        }
        publish();
        return result;
    };

    // Column names of the tables in the target's schema, from the snapshot.
    let snapshot: TableSchema[] | null = null;

    // 1. Declared foreign keys, both directions.
    {
        const errors: string[] = [];
        let scanned = 0;
        try {
            const outgoing = await lookups.getForeignKeys();
            scanned++;
            for (const fk of outgoing) {
                if (!sameColumn(fk.column_name, target.column)) continue;
                const refSchema = getReferencedSchema(fk, target.schema);
                result.evidence.push({
                    id: `fk-out-${fk.name}-${refSchema ?? ''}-${fk.ref_table}-${fk.ref_column}`,
                    source: 'foreign-key',
                    confidence: 'confirmed',
                    direction: 'outgoing',
                    objectName: fk.ref_table,
                    ...(refSchema ? {objectSchema: refSchema} : {}),
                    relatedColumn: fk.ref_column,
                    constraintName: fk.name,
                });
            }
        } catch (err) {
            errors.push(toErrorMessage(err));
        }
        if (cancelled()) return cancelRest();
        try {
            // The snapshot holds the tables of the target's schema, so a key
            // there references the target only when its referenced schema
            // (the source schema when the driver doesn't report one) matches.
            snapshot = await lookups.getSchemaSnapshot();
            scanned++;
            for (const table of snapshot) {
                for (const fk of table.foreign_keys ?? []) {
                    const refSchema = getReferencedSchema(fk, target.schema);
                    if (
                        !sameTable(fk.ref_table, target.table) ||
                        !sameColumn(fk.ref_column, target.column) ||
                        (refSchema && target.schema && !sameTable(refSchema, target.schema))
                    ) {
                        continue;
                    }
                    result.evidence.push({
                        id: `fk-in-${table.name}-${fk.name}-${fk.column_name}`,
                        source: 'foreign-key',
                        confidence: 'confirmed',
                        direction: 'incoming',
                        objectName: table.name,
                        ...(target.schema ? {objectSchema: target.schema} : {}),
                        relatedColumn: fk.column_name,
                        constraintName: fk.name,
                    });
                }
            }
        } catch (err) {
            errors.push(toErrorMessage(err));
        }
        result.sources.foreignKeys = settle(scanned, 2, errors, false);
        publish();
    }

    const columnsByTable = new Map<string, string[]>();
    for (const table of snapshot ?? []) {
        columnsByTable.set(
            tableKey(table.name),
            table.columns.map((c) => c.name),
        );
    }
    // Columns are only known for tables of the target's own schema.
    const columnsOf = (ref: RelationRef): readonly string[] | undefined => {
        if (ref.schema !== undefined && !sameTable(ref.schema, target.schema ?? target.database)) {
            return undefined;
        }
        return columnsByTable.get(tableKey(ref.name));
    };

    // 2. View definitions of the target's schema.
    if (cancelled()) return cancelRest();
    if (!options.viewsSupported) {
        result.sources.views = {status: 'unsupported', scanned: 0, total: null};
        publish();
    } else {
        const errors: string[] = [];
        let views: {name: string; definition?: string}[] = [];
        let listed = false;
        try {
            views = await lookups.getViews();
            listed = true;
        } catch (err) {
            errors.push(toErrorMessage(err));
        }
        let scanned = 0;
        let truncated = false;
        for (const view of views.slice(0, limits.maxViews)) {
            if (cancelled()) {
                result.sources.views = {status: 'cancelled', scanned, total: views.length};
                return cancelRest();
            }
            let definition = view.definition;
            if (!definition) {
                try {
                    definition = await lookups.getViewDefinition(view.name);
                } catch (err) {
                    errors.push(toErrorMessage(err));
                    continue;
                }
            }
            if (!definition || !definition.trim()) {
                // A view whose body can't be read may still use the column.
                errors.push(`definition of ${view.name} is not available`);
                continue;
            }
            if (definition.length > limits.maxSqlLength) {
                truncated = true;
                continue;
            }
            scanned++;
            const matches = findColumnReferences(definition, target, {
                dialect,
                defaultSchema: target.schema,
                columnsOf,
            });
            const found = matchEvidence(definition, matches, dialect);
            if (found) {
                result.evidence.push({
                    id: `view-${view.name}`,
                    source: 'view',
                    objectName: view.name,
                    ...(target.schema ? {objectSchema: target.schema} : {}),
                    ...found,
                });
            }
        }
        if (views.length > limits.maxViews) truncated = true;
        result.sources.views = listed
            ? settle(scanned, views.length, errors, truncated)
            : settle(0, null, errors, false);
        publish();
    }

    // 3. Query history of this connection, newest first.
    if (cancelled()) return cancelRest();
    {
        const errors: string[] = [];
        let entries: QueryHistoryEntry[] = [];
        let loaded = false;
        try {
            entries = await lookups.getHistory();
            loaded = true;
        } catch (err) {
            errors.push(toErrorMessage(err));
        }
        // Entries run on another database of the connection are out of scope.
        const inScope = entries
            .filter(
                (entry) =>
                    !entry.database ||
                    !target.database ||
                    sameTable(entry.database, target.database),
            )
            .sort((a, b) => b.executedAt.localeCompare(a.executedAt));
        let scanned = 0;
        let truncated = inScope.length > limits.maxHistoryEntries;
        let sinceYield = 0;
        let lastYield = now();
        for (const entry of inScope.slice(0, limits.maxHistoryEntries)) {
            // The scan is synchronous: hand the event loop back now and then so
            // a Stop click (the abort) and rendering can run before we go on.
            if (++sinceYield >= YIELD_EVERY_ENTRIES || now() - lastYield >= YIELD_EVERY_MS) {
                await yieldToEventLoop();
                sinceYield = 0;
                lastYield = now();
            }
            if (cancelled()) {
                result.sources.history = {status: 'cancelled', scanned, total: inScope.length};
                return cancelRest();
            }
            if (entry.sql.length > limits.maxSqlLength) {
                truncated = true;
                continue;
            }
            scanned++;
            const matches = findColumnReferences(entry.sql, target, {dialect, columnsOf});
            const found = matchEvidence(entry.sql, matches, dialect);
            if (found) {
                result.evidence.push({
                    id: `history-${entry.id}`,
                    source: 'history',
                    historyEntry: {
                        id: entry.id,
                        sql: entry.sql,
                        executedAt: entry.executedAt,
                        database: entry.database,
                        status: entry.status,
                        error: entry.error,
                    },
                    ...found,
                });
            }
        }
        result.sources.history = loaded
            ? settle(scanned, inScope.length, errors, truncated)
            : settle(0, null, errors, false);
        publish();
    }

    return result;
}

/**
 * `result` (or an empty one) with every source still pending marked failed
 * with `error`: for a collection that threw instead of finishing, so the
 * panel never stays on "searching".
 */
export function failPendingSources(
    result: ColumnUsageResult | null,
    error: unknown,
): ColumnUsageResult {
    const message = toErrorMessage(error);
    const base: ColumnUsageResult = result ?? {
        sources: {
            foreignKeys: {status: 'pending', scanned: 0, total: null},
            views: {status: 'pending', scanned: 0, total: null},
            history: {status: 'pending', scanned: 0, total: null},
        },
        evidence: [],
    };
    const sources = {...base.sources};
    for (const key of Object.keys(sources) as UsageSourceKind[]) {
        if (sources[key].status === 'pending') {
            sources[key] = {...sources[key], status: 'failed', message};
        }
    }
    return {sources, evidence: base.evidence};
}

/** True when every source finished reading all it had. */
export function isUsageComplete(result: ColumnUsageResult): boolean {
    return Object.values(result.sources).every((source) => source.status === 'complete');
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The qualified name shown for the target, e.g. `public.orders.customer_id`. */
/** Whether the evidence comes from a history entry whose run failed. */
export function isFailedRun(item: ColumnUsageEvidence): boolean {
    return item.historyEntry?.status === 'error';
}

export function formatUsageTarget(target: ColumnUsageTarget): string {
    return [target.schema, target.table, target.column].filter(Boolean).join('.');
}

/**
 * A plain-text summary to share: scope, how far each source got, and each
 * piece of evidence with its redacted snippet (never the raw SQL).
 */
export function formatColumnUsageSummary(
    target: ColumnUsageTarget,
    result: ColumnUsageResult,
    t: Translate,
): string {
    const lines = [t('columnUsage.summaryTitle', {column: formatUsageTarget(target)})];
    if (target.database) lines.push(t('columnUsage.summaryDatabase', {database: target.database}));
    for (const key of ['foreignKeys', 'views', 'history'] as UsageSourceKind[]) {
        const source = result.sources[key];
        lines.push(
            `${t(`columnUsage.source.${key}`)}: ${t(`columnUsage.status.${source.status}`, {
                scanned: source.scanned,
                total: source.total ?? '?',
            })}`,
        );
    }
    for (const item of sortEvidence(result.evidence)) {
        const confidence = t(`columnUsage.confidence.${item.confidence}`);
        const reason = item.reason ? ` (${t(`columnUsage.reason.${item.reason}`)})` : '';
        let subject: string;
        if (item.source === 'foreign-key') {
            subject = t(
                item.direction === 'outgoing' ? 'columnUsage.fkOutgoing' : 'columnUsage.fkIncoming',
                {object: item.objectName, column: item.relatedColumn},
            );
        } else if (item.source === 'view') {
            subject = t('columnUsage.viewTitle', {view: item.objectName});
        } else {
            subject = t('columnUsage.historyTitle', {date: item.historyEntry?.executedAt ?? ''});
            // The error text is left out like the raw SQL: it often quotes values.
            if (isFailedRun(item)) subject += ` (${t('columnUsage.failedRun')})`;
        }
        lines.push(`- [${confidence}] ${subject}${reason}`);
        if (item.snippet) lines.push(`    ${item.snippet.text}`);
    }
    if (result.evidence.length === 0) lines.push(t('columnUsage.summaryNone'));
    if (!isUsageComplete(result)) lines.push(t('columnUsage.incompleteNote'));
    return lines.join('\n');
}
