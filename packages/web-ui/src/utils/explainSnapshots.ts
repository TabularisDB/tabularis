import type {ExplainNode, ExplainSnapshot} from '@tabularis/explain';
import {
    deserializeExplainSnapshot,
    pruneExplainSnapshots,
    serializeExplainSnapshot,
} from '@tabularis/explain';
import type {PlatformCapabilities} from '@/platform/capabilities';
import {downloadTextFile} from './fileDownloads';

export const MAX_DEFAULT_UNPINNED_SNAPSHOTS = 50;

/**
 * Safely parse and normalize snapshots retrieved from persisted UI state.
 */
export function normalizeExplainSnapshots(raw: unknown): ExplainSnapshot[] {
    if (!Array.isArray(raw)) return [];

    const valid: ExplainSnapshot[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const candidate = item as Record<string, unknown>;
        if (
            typeof candidate.id !== 'string' ||
            typeof candidate.sql !== 'string' ||
            !candidate.plan ||
            typeof candidate.plan !== 'object'
        ) {
            continue;
        }

        const plan = candidate.plan as Record<string, unknown>;
        if (!plan.root || typeof plan.root !== 'object') continue;
        const root = plan.root as Record<string, unknown>;
        if (typeof root.node_type !== 'string' || !Array.isArray(root.children)) continue;

        const contextCandidate = (
            candidate.context && typeof candidate.context === 'object' ? candidate.context : {}
        ) as Record<string, unknown>;

        const safeSnapshot: ExplainSnapshot = {
            id: candidate.id,
            title:
                typeof candidate.title === 'string' && candidate.title.trim()
                    ? candidate.title.trim()
                    : 'Plan Snapshot',
            createdAt:
                typeof candidate.createdAt === 'string'
                    ? candidate.createdAt
                    : new Date().toISOString(),
            sql: candidate.sql,
            context: {
                connectionId:
                    typeof contextCandidate.connectionId === 'string'
                        ? contextCandidate.connectionId
                        : undefined,
                connectionName:
                    typeof contextCandidate.connectionName === 'string'
                        ? contextCandidate.connectionName
                        : null,
                database:
                    typeof contextCandidate.database === 'string'
                        ? contextCandidate.database
                        : null,
                schema:
                    typeof contextCandidate.schema === 'string' ? contextCandidate.schema : null,
                engine:
                    typeof contextCandidate.engine === 'string'
                        ? contextCandidate.engine.toLowerCase()
                        : typeof plan.driver === 'string'
                          ? plan.driver.toLowerCase()
                          : 'unknown',
                engineVersion:
                    typeof contextCandidate.engineVersion === 'string'
                        ? contextCandidate.engineVersion
                        : null,
            },
            plan: {
                root: plan.root as unknown as ExplainNode,
                planning_time_ms:
                    typeof plan.planning_time_ms === 'number' ? plan.planning_time_ms : null,
                execution_time_ms:
                    typeof plan.execution_time_ms === 'number' ? plan.execution_time_ms : null,
                original_query:
                    typeof plan.original_query === 'string' ? plan.original_query : candidate.sql,
                driver: typeof plan.driver === 'string' ? plan.driver : 'unknown',
                has_analyze_data: Boolean(plan.has_analyze_data),
                raw_output: typeof plan.raw_output === 'string' ? plan.raw_output : null,
            },
            isPinned: Boolean(candidate.isPinned),
        };

        valid.push(safeSnapshot);
    }

    return valid;
}

/**
 * Add a snapshot to the list, automatically applying the retention limit.
 * Pinned snapshots are never pruned.
 */
export function addExplainSnapshot(
    existing: readonly ExplainSnapshot[],
    newSnapshot: ExplainSnapshot,
    maxUnpinned = MAX_DEFAULT_UNPINNED_SNAPSHOTS,
): ExplainSnapshot[] {
    const withoutExisting = existing.filter((s) => s.id !== newSnapshot.id);
    return pruneExplainSnapshots([newSnapshot, ...withoutExisting], maxUnpinned);
}

/**
 * Remove a snapshot by its ID.
 */
export function removeExplainSnapshot(
    existing: readonly ExplainSnapshot[],
    id: string,
): ExplainSnapshot[] {
    return existing.filter((s) => s.id !== id);
}

/**
 * Toggle the pinned status of a snapshot.
 */
export function toggleExplainSnapshotPin(
    existing: readonly ExplainSnapshot[],
    id: string,
): ExplainSnapshot[] {
    return existing.map((s) => (s.id === id ? {...s, isPinned: !s.isPinned} : s));
}

/**
 * Export an explain snapshot to a formatted JSON file using platform download.
 */
export async function exportExplainSnapshot(
    platform: PlatformCapabilities,
    snapshot: ExplainSnapshot,
): Promise<boolean> {
    const contents = serializeExplainSnapshot(snapshot);
    const sanitizedTitle = (snapshot.title || 'snapshot')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .slice(0, 40);
    const fileName = `explain-snapshot-${sanitizedTitle}.json`;

    return downloadTextFile(platform, {
        fileName,
        contents,
        mimeType: 'application/json',
        filters: [
            {name: 'JSON', extensions: ['json']},
            {name: 'All files', extensions: ['*']},
        ],
    });
}

/**
 * Import a snapshot from raw file contents.
 */
export function importExplainSnapshotFromText(text: string): ExplainSnapshot {
    return deserializeExplainSnapshot(text);
}
