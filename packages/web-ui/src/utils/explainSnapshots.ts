import type {ExplainSnapshot, ExplainSnapshotContext} from '@tabularis/explain';
import type {ExplainPlan} from '@tabularis/explain';

const SNAPSHOTS_STORAGE_KEY = 'tabularis_explain_snapshots';
export const MAX_EXPLAIN_SNAPSHOTS = 50;

function getStorage(): Storage {
    if (typeof window === 'undefined' || !window.localStorage) {
        throw new Error('Local storage is not available');
    }
    return window.localStorage;
}

/**
 * Load all saved EXPLAIN plan snapshots.
 */
export function loadExplainSnapshots(): ExplainSnapshot[] {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return [];
        const raw = window.localStorage.getItem(SNAPSHOTS_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed;
    } catch (e) {
        console.error('Failed to parse explain snapshots from storage:', e);
        return [];
    }
}

/**
 * Persist an array of snapshots to storage.
 * Throws when storage is unavailable or quota is exceeded.
 */
export function persistExplainSnapshots(snapshots: ExplainSnapshot[]): void {
    const storage = getStorage();
    storage.setItem(SNAPSHOTS_STORAGE_KEY, JSON.stringify(snapshots));
}

/**
 * Create a new snapshot from a plan and save it.
 */
export function saveExplainSnapshot(
    plan: ExplainPlan,
    name: string,
    context: ExplainSnapshotContext,
): ExplainSnapshot {
    const snapshots = loadExplainSnapshots();

    const snapshot: ExplainSnapshot = {
        id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        name: name.trim() || `Plan Snapshot ${new Date().toLocaleTimeString()}`,
        createdAt: new Date().toISOString(),
        sql: plan.original_query || '',
        context,
        hasAnalyzeData: plan.has_analyze_data,
        planningTimeMs: plan.planning_time_ms,
        executionTimeMs: plan.execution_time_ms,
        totalCost: plan.root.total_cost,
        rawOutput: plan.raw_output,
        plan,
        isPinned: false,
    };

    // Keep up to MAX_EXPLAIN_SNAPSHOTS, retaining pinned snapshots first
    let updated = [snapshot, ...snapshots];
    if (updated.length > MAX_EXPLAIN_SNAPSHOTS) {
        const pinned = updated.filter((s) => s.isPinned);
        const unpinned = updated.filter((s) => !s.isPinned);
        const allowedUnpinned = Math.max(0, MAX_EXPLAIN_SNAPSHOTS - pinned.length);
        updated = [...pinned, ...unpinned.slice(0, allowedUnpinned)].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
    }

    persistExplainSnapshots(updated);
    return snapshot;
}

/**
 * Delete a snapshot by ID.
 */
export function deleteExplainSnapshot(id: string): ExplainSnapshot[] {
    const snapshots = loadExplainSnapshots();
    const updated = snapshots.filter((s) => s.id !== id);
    persistExplainSnapshots(updated);
    return updated;
}

/**
 * Toggle pin state for a snapshot.
 */
export function togglePinExplainSnapshot(id: string): ExplainSnapshot[] {
    const snapshots = loadExplainSnapshots();
    const updated = snapshots.map((s) => (s.id === id ? {...s, isPinned: !s.isPinned} : s));
    persistExplainSnapshots(updated);
    return updated;
}

/**
 * Filter snapshots compatible as a baseline for the given target plan.
 */
export function getCompatibleBaselineSnapshots(
    targetEngine: string,
    snapshots: ExplainSnapshot[],
): ExplainSnapshot[] {
    const engine = (targetEngine || '').toLowerCase().trim();
    if (!engine) return snapshots;
    return snapshots.filter((s) => (s.context.engine || '').toLowerCase().trim() === engine);
}
