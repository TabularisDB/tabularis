import type {ExplainPlan} from './types';

/**
 * Contextual metadata about the connection and engine where an EXPLAIN plan was captured.
 * Deliberately excludes credentials, passwords, tokens, or query result rows.
 */
export interface ExplainSnapshotContext {
    connectionId?: string;
    connectionName?: string | null;
    database?: string | null;
    schema?: string | null;
    engine: string;
    engineVersion?: string | null;
}

/**
 * An immutable point-in-time snapshot of an EXPLAIN plan execution.
 */
export interface ExplainSnapshot {
    id: string;
    title: string;
    createdAt: string; // ISO 8601 timestamp
    sql: string;
    context: ExplainSnapshotContext;
    plan: ExplainPlan;
    isPinned?: boolean;
}

export interface CreateExplainSnapshotParams {
    id?: string;
    title?: string;
    sql: string;
    context: ExplainSnapshotContext;
    plan: ExplainPlan;
    isPinned?: boolean;
    createdAt?: string;
}

export const EXPLAIN_SNAPSHOT_SCHEMA_VERSION = 1;

export interface SerializedExplainSnapshotPayload {
    version: number;
    snapshot: ExplainSnapshot;
}

/**
 * Create a new immutable snapshot from a plan and execution context.
 * Does not rerun the SQL query; captures the existing plan structure and raw output.
 */
export function createExplainSnapshot(params: CreateExplainSnapshotParams): ExplainSnapshot {
    const id =
        params.id ??
        (typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `snap_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);
    const createdAt = params.createdAt ?? new Date().toISOString();

    const engineLabel = params.context.engine.toUpperCase();
    const defaultTitle =
        params.title?.trim() ||
        `${engineLabel} Plan (${new Date(createdAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'})})`;

    // Sanitize context: keep only safe metadata, omit any accidental credentials
    const safeContext: ExplainSnapshotContext = {
        connectionId: params.context.connectionId,
        connectionName: params.context.connectionName ?? null,
        database: params.context.database ?? null,
        schema: params.context.schema ?? null,
        engine: (params.context.engine || 'unknown').toLowerCase(),
        engineVersion: params.context.engineVersion ?? null,
    };

    return {
        id,
        title: defaultTitle,
        createdAt,
        sql: params.sql,
        context: safeContext,
        plan: params.plan,
        isPinned: Boolean(params.isPinned),
    };
}

/**
 * Prune snapshots based on a maximum retention limit.
 * Pinned snapshots are NEVER pruned.
 * Unpinned snapshots exceeding `maxUnpinned` are pruned from oldest to newest.
 */
export function pruneExplainSnapshots(
    snapshots: readonly ExplainSnapshot[],
    maxUnpinned = 50,
): ExplainSnapshot[] {
    const pinned: ExplainSnapshot[] = [];
    const unpinned: ExplainSnapshot[] = [];

    for (const snap of snapshots) {
        if (snap.isPinned) {
            pinned.push(snap);
        } else {
            unpinned.push(snap);
        }
    }

    // Sort unpinned by createdAt descending (newest first)
    unpinned.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const keptUnpinned = unpinned.slice(0, Math.max(0, maxUnpinned));

    // Combine and sort all kept snapshots by createdAt descending
    const combined = [...pinned, ...keptUnpinned];
    combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return combined;
}

/**
 * Serialize an explain snapshot for export or persistent storage.
 */
export function serializeExplainSnapshot(snapshot: ExplainSnapshot): string {
    const payload: SerializedExplainSnapshotPayload = {
        version: EXPLAIN_SNAPSHOT_SCHEMA_VERSION,
        snapshot,
    };
    return JSON.stringify(payload, null, 2);
}

/**
 * Deserialize and validate an explain snapshot from an exported JSON string.
 * Validates presence of core fields (`id`, `sql`, `context`, `plan`).
 */
export function deserializeExplainSnapshot(jsonString: string): ExplainSnapshot {
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonString);
    } catch (err) {
        throw new Error(
            `Invalid JSON for EXPLAIN snapshot: ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid EXPLAIN snapshot payload: expected JSON object');
    }

    const payload = parsed as Record<string, unknown>;
    if (typeof payload.version === 'number' && payload.version > EXPLAIN_SNAPSHOT_SCHEMA_VERSION) {
        throw new Error(
            `Unsupported EXPLAIN snapshot schema version: ${payload.version} (maximum supported version is ${EXPLAIN_SNAPSHOT_SCHEMA_VERSION})`,
        );
    }

    const snapshotCandidate = (
        payload.snapshot && typeof payload.snapshot === 'object' ? payload.snapshot : payload
    ) as Record<string, unknown>;

    if (typeof snapshotCandidate.sql !== 'string') {
        throw new Error('Invalid EXPLAIN snapshot: missing required field "sql"');
    }

    if (!snapshotCandidate.plan || typeof snapshotCandidate.plan !== 'object') {
        throw new Error('Invalid EXPLAIN snapshot: missing required field "plan"');
    }

    const planObj = snapshotCandidate.plan as Record<string, unknown>;
    if (!planObj.root || typeof planObj.root !== 'object') {
        throw new Error('Invalid EXPLAIN snapshot: plan missing "root" node');
    }

    const rootObj = planObj.root as Record<string, unknown>;
    if (typeof rootObj.node_type !== 'string') {
        throw new Error('Invalid EXPLAIN snapshot: plan root missing "node_type"');
    }
    if (!Array.isArray(rootObj.children)) {
        throw new Error('Invalid EXPLAIN snapshot: plan root missing "children" array');
    }

    const contextObj = (
        snapshotCandidate.context && typeof snapshotCandidate.context === 'object'
            ? snapshotCandidate.context
            : {}
    ) as Record<string, unknown>;

    const safeContext: ExplainSnapshotContext = {
        connectionId:
            typeof contextObj.connectionId === 'string' ? contextObj.connectionId : undefined,
        connectionName:
            typeof contextObj.connectionName === 'string' ? contextObj.connectionName : null,
        database: typeof contextObj.database === 'string' ? contextObj.database : null,
        schema: typeof contextObj.schema === 'string' ? contextObj.schema : null,
        engine: typeof contextObj.engine === 'string' ? contextObj.engine.toLowerCase() : 'unknown',
        engineVersion:
            typeof contextObj.engineVersion === 'string' ? contextObj.engineVersion : null,
    };

    return {
        id:
            typeof snapshotCandidate.id === 'string'
                ? snapshotCandidate.id
                : typeof crypto !== 'undefined' && crypto.randomUUID
                  ? crypto.randomUUID()
                  : `snap_${Date.now()}`,
        title:
            typeof snapshotCandidate.title === 'string' && snapshotCandidate.title.trim()
                ? snapshotCandidate.title.trim()
                : 'Imported Snapshot',
        createdAt:
            typeof snapshotCandidate.createdAt === 'string'
                ? snapshotCandidate.createdAt
                : new Date().toISOString(),
        sql: snapshotCandidate.sql,
        context: safeContext,
        plan: snapshotCandidate.plan as ExplainPlan,
        isPinned: Boolean(snapshotCandidate.isPinned),
    };
}
