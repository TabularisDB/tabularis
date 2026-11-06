import type {ExplainSnapshot} from '@tabularis/explain';
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
            typeof candidate.id === 'string' &&
            typeof candidate.sql === 'string' &&
            candidate.plan &&
            typeof candidate.plan === 'object' &&
            (candidate.plan as Record<string, unknown>).root
        ) {
            valid.push(candidate as unknown as ExplainSnapshot);
        }
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
