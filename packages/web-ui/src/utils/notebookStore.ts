import type {TypedCommandCaller} from '@/api/contract';
import type {NotebookCell, NotebookMetadata, NotebookState} from '@/types/notebook';
import {createDefaultNotebookState} from './notebook';
import {serializeNotebook, deserializeNotebook} from './notebookFile';

const SAVE_DEBOUNCE_MS = 1500;

/**
 * Dispatched whenever the set of saved notebooks changes (create, import,
 * rename, delete) so UI listing notebooks — e.g. the sidebar — can refresh
 * without polling.
 */
export const NOTEBOOKS_CHANGED_EVENT = 'tabularis:notebooks-changed';

function notifyNotebooksChanged(): void {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(NOTEBOOKS_CHANGED_EVENT));
    }
}

// Module-level session cache
const cache = new Map<string, NotebookState>();
const pendingLoads = new Map<string, Promise<NotebookState>>();
const evicting = new Map<string, Promise<void>>();
const pendingSaves = new Map<string, Promise<void>>();
const stateListeners = new Map<string, Set<() => void>>();
type UnconfirmedWrite = {fingerprints: Set<string>; explicitlyRemoved: boolean};
const unconfirmedWrites = new Map<string, Map<string, UnconfirmedWrite>>();
const titleCache = new Map<string, string>();
// Notebooks are persisted per connection (`notebooks/<connectionId>/<id>`), so
// every save/load/delete needs the owning connection id. It is captured when a
// notebook is created or loaded and read back from here for autosaves.
const connectionIdCache = new Map<string, string>();
const clientCache = new Map<string, TypedCommandCaller>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function generateNotebookId(): string {
    return `nb_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

/** Serialize notebook state to JSON, stripping runtime fields. */
function serializeForDisk(notebookId: string, state: NotebookState): string {
    const title = titleCache.get(notebookId) ?? 'Notebook';
    const connectionId = connectionIdCache.get(notebookId);
    const notebook = serializeNotebook(
        title,
        state.cells,
        state.params,
        state.stopOnError,
        connectionId,
        {preserveCellIds: true},
    );
    return JSON.stringify(notebook, null, 2);
}

/** Persist a notebook, or skip (with a warning) if its connection is unknown. */
function persist(notebookId: string, content: string): Promise<void> {
    const connectionId = connectionIdCache.get(notebookId);
    const client = clientCache.get(notebookId);
    if (!connectionId || !client) {
        console.error(`Cannot save notebook ${notebookId}: unknown connection or client`);
        return Promise.resolve();
    }
    // Autosave, close, and reopen can all write the same file. Start each RPC
    // after its predecessor settles, including when that predecessor failed.
    const save = () => client.call('save_notebook', {connectionId, notebookId, content});
    const previous = pendingSaves.get(notebookId);
    const pending = (previous ? previous.then(save, save) : save()).finally(() => {
        if (pendingSaves.get(notebookId) === pending) pendingSaves.delete(notebookId);
    });
    pendingSaves.set(notebookId, pending);
    return pending;
}

/** Flush a single pending save immediately. */
async function flushSave(notebookId: string): Promise<void> {
    const timer = saveTimers.get(notebookId);
    if (timer) {
        clearTimeout(timer);
        saveTimers.delete(notebookId);
    }

    const state = cache.get(notebookId);
    if (!state) return;

    const content = serializeForDisk(notebookId, state);
    await persist(notebookId, content);
}

/** Schedule a debounced save for a notebook. */
function scheduleSave(notebookId: string): void {
    const existing = saveTimers.get(notebookId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
        saveTimers.delete(notebookId);
        const state = cache.get(notebookId);
        if (!state) return;
        const content = serializeForDisk(notebookId, state);
        persist(notebookId, content).catch((e) =>
            console.error(`Failed to auto-save notebook ${notebookId}:`, e),
        );
    }, SAVE_DEBOUNCE_MS);

    saveTimers.set(notebookId, timer);
}

// --- Public API ---

/** Get cached notebook state (returns undefined if not loaded). */
export function getNotebookState(notebookId: string): NotebookState | undefined {
    return cache.get(notebookId);
}

function publishNotebookState(notebookId: string, state: NotebookState): void {
    cache.set(notebookId, state);
    stateListeners.get(notebookId)?.forEach((listener) => listener());
}

function withoutLoadingCells(state: NotebookState): NotebookState {
    // Spinners belong to live runs, not migrated/imported documents.
    if (!state.cells.some((cell) => cell.isLoading)) return state;
    return {...state, cells: state.cells.map((cell) => ({...cell, isLoading: false}))};
}

function reconcileWriteOwners(
    notebookId: string,
    cells: NotebookCell[],
    previousCells?: NotebookCell[],
): void {
    const writes = unconfirmedWrites.get(notebookId);
    if (!writes?.size) return;
    const present = new Set(cells.map(({id}) => id));
    const previous = previousCells && new Set(previousCells.map(({id}) => id));
    for (const [id, write] of writes) {
        // Undo (or reloading with the same ID) restores the owner. Only an
        // explicit edit can mark it removed; a missing disk ID is an orphan.
        if (present.has(id)) write.explicitlyRemoved = false;
        else if (previous?.has(id)) write.explicitlyRemoved = true;
    }
}

/** Commit an explicit document edit and schedule debounced save. */
export function setNotebookState(notebookId: string, state: NotebookState): void {
    const previous = cache.get(notebookId);
    reconcileWriteOwners(notebookId, state.cells, previous?.cells);
    publishNotebookState(notebookId, previous ? state : withoutLoadingCells(state));
    scheduleSave(notebookId);
}

/** Runtime updates are shared across views but never persisted to the notebook file. */
export function updateNotebookRuntime(
    notebookId: string,
    update: (state: NotebookState) => NotebookState,
): boolean {
    const previous = cache.get(notebookId);
    if (!previous || evicting.has(notebookId)) return false;
    const next = update(previous);
    if (next === previous) return false;
    publishNotebookState(notebookId, next);
    return true;
}

function resumeNotebook(notebookId: string): void {
    if (!evicting.delete(notebookId)) return;
    // A run may have settled while runtime updates were suspended for close.
    const state = cache.get(notebookId);
    if (state) {
        const resumed = withoutLoadingCells(state);
        if (resumed !== state) publishNotebookState(notebookId, resumed);
    }
}

export function subscribeNotebookState(notebookId: string, listener: () => void): () => void {
    resumeNotebook(notebookId);
    const listeners = stateListeners.get(notebookId) ?? new Set();
    stateListeners.set(notebookId, listeners);
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
        if (!listeners.size) stateListeners.delete(notebookId);
    };
}

export function hasUnconfirmedNotebookWrite(
    notebookId: string,
    cellId: string,
    cells: readonly NotebookCell[],
): boolean {
    const writes = unconfirmedWrites.get(notebookId);
    if (!writes) return false;
    // A lost ID can belong to any cell after a reload. An intentional deletion
    // only hides the record while its owner is absent, so Undo can restore it.
    for (const [id, write] of writes) {
        if (id === cellId || (!write.explicitlyRemoved && !cells.some((cell) => cell.id === id)))
            return true;
    }
    return false;
}

export function setUnconfirmedNotebookWrite(
    notebookId: string,
    cellId: string,
    fingerprint: string,
    unconfirmed: boolean,
): void {
    if (unconfirmed) {
        const writes = unconfirmedWrites.get(notebookId) ?? new Map<string, UnconfirmedWrite>();
        const cellWrites = writes.get(cellId) ?? {
            fingerprints: new Set<string>(),
            explicitlyRemoved: false,
        };
        cellWrites.fingerprints.add(fingerprint);
        writes.set(cellId, cellWrites);
        unconfirmedWrites.set(notebookId, writes);
    } else {
        const writes = unconfirmedWrites.get(notebookId);
        const cellWrites = writes?.get(cellId);
        cellWrites?.fingerprints.delete(fingerprint);
        if (!cellWrites?.fingerprints.size) writes?.delete(cellId);
        if (!writes?.size) unconfirmedWrites.delete(notebookId);
    }
}

/** Restore document fields without reviving the execution state in the snapshot. */
export function restoreNotebookDocument(
    snapshot: NotebookState,
    live: NotebookState | null,
): NotebookState {
    const byId = new Map(live?.cells.map((cell) => [cell.id, cell]));
    return {
        ...snapshot,
        cells: snapshot.cells.map((cell) => {
            const {result, error, executionTime, history, isLoading} = byId.get(cell.id) ?? {};
            return {...cell, result, error, executionTime, history, isLoading};
        }),
    };
}

/** Get the cached title for a notebook. */
export function getNotebookTitle(notebookId: string): string | undefined {
    return titleCache.get(notebookId);
}

/** Update the cached title and schedule debounced save. */
export function setNotebookTitle(notebookId: string, title: string): void {
    titleCache.set(notebookId, title);
    scheduleSave(notebookId);
}

/** Load a notebook from disk (or return cached state if already loaded). */
export async function loadNotebook(
    notebookId: string,
    connectionId: string,
    client: TypedCommandCaller,
): Promise<NotebookState> {
    resumeNotebook(notebookId);
    connectionIdCache.set(notebookId, connectionId);
    clientCache.set(notebookId, client);

    const cached = cache.get(notebookId);
    if (cached) return cached;

    const load: Promise<NotebookState> = client
        .call('load_notebook', {connectionId, notebookId})
        .then((content) => {
            const current = cache.get(notebookId);
            if (current) return current;
            const latest = pendingLoads.get(notebookId);
            if (latest && latest !== load) return latest;

            const {title, ...state} = content
                ? deserializeNotebook(content, {preserveCellIds: true})
                : {title: 'Notebook', ...createDefaultNotebookState()};
            // A closed tab can still finish its read, but it must not repopulate the cache.
            if (latest === load) {
                reconcileWriteOwners(notebookId, state.cells);
                titleCache.set(notebookId, title);
                publishNotebookState(notebookId, state);
            }
            return state;
        })
        .finally(() => {
            if (pendingLoads.get(notebookId) === load) pendingLoads.delete(notebookId);
        });
    pendingLoads.set(notebookId, load);
    return load;
}

/** Create a new notebook with default state, save to disk. */
export async function createNotebook(
    title: string,
    connectionId: string,
    client: TypedCommandCaller,
): Promise<{notebookId: string; state: NotebookState}> {
    const notebookId = generateNotebookId();
    const state = createDefaultNotebookState();

    titleCache.set(notebookId, title);
    connectionIdCache.set(notebookId, connectionId);
    clientCache.set(notebookId, client);
    cache.set(notebookId, state);

    const content = serializeForDisk(notebookId, state);
    await client.call('create_notebook', {connectionId, notebookId, content});
    notifyNotebooksChanged();

    return {notebookId, state};
}

/** Create a notebook file from existing in-memory state (used for migration). */
export async function createNotebookFromState(
    title: string,
    state: NotebookState,
    connectionId: string,
    client: TypedCommandCaller,
): Promise<{notebookId: string}> {
    const notebookId = generateNotebookId();

    titleCache.set(notebookId, title);
    connectionIdCache.set(notebookId, connectionId);
    clientCache.set(notebookId, client);
    publishNotebookState(notebookId, withoutLoadingCells(state));

    const content = serializeForDisk(notebookId, state);
    await client.call('create_notebook', {connectionId, notebookId, content});
    notifyNotebooksChanged();

    return {notebookId};
}

/** Delete a notebook file and evict from cache. */
export async function deleteNotebook(
    notebookId: string,
    connectionId: string,
    client: TypedCommandCaller,
): Promise<void> {
    const timer = saveTimers.get(notebookId);
    if (timer) {
        clearTimeout(timer);
        saveTimers.delete(notebookId);
    }
    pendingLoads.delete(notebookId);
    cache.delete(notebookId);
    titleCache.delete(notebookId);
    connectionIdCache.delete(notebookId);
    clientCache.delete(notebookId);
    // An already queued save must not recreate the file after deletion.
    const pending = pendingSaves.get(notebookId);
    if (pending) await pending.catch(() => {});
    await client.call('delete_notebook', {connectionId, notebookId});
    unconfirmedWrites.delete(notebookId);
    notifyNotebooksChanged();
}

/** List saved notebooks for a connection (metadata only, read from disk). */
export async function listNotebooks(
    connectionId: string,
    client: TypedCommandCaller,
): Promise<NotebookMetadata[]> {
    return client.call('list_notebooks', {connectionId});
}

/** Rename a saved notebook. Patches the file (and cache, if currently open). */
export async function renameNotebook(
    notebookId: string,
    connectionId: string,
    title: string,
    client: TypedCommandCaller,
): Promise<void> {
    connectionIdCache.set(notebookId, connectionId);
    clientCache.set(notebookId, client);
    if (cache.has(notebookId)) {
        // Open notebook: update the cached title and flush the full file so a
        // pending autosave can't clobber the new title.
        titleCache.set(notebookId, title);
        await flushSave(notebookId);
        notifyNotebooksChanged();
        return;
    }
    await client.call('rename_notebook', {connectionId, notebookId, title});
    notifyNotebooksChanged();
}

/** Flush pending save and remove from cache (on tab close). */
export async function evictFromCache(notebookId: string): Promise<void> {
    pendingLoads.delete(notebookId);
    const closing = flushSave(notebookId);
    evicting.set(notebookId, closing);
    try {
        await closing;
        if (evicting.get(notebookId) !== closing) return;
        cache.delete(notebookId);
        titleCache.delete(notebookId);
        connectionIdCache.delete(notebookId);
        clientCache.delete(notebookId);
    } finally {
        if (evicting.get(notebookId) === closing) evicting.delete(notebookId);
    }
}

/** Flush debounced edits and wait for writes already in flight (on app close). */
export async function flushAllPendingSaves(): Promise<void> {
    const ids = new Set([...saveTimers.keys(), ...pendingSaves.keys()]);
    await Promise.all(
        Array.from(ids, (id) => (saveTimers.has(id) ? flushSave(id) : pendingSaves.get(id))),
    );
}

/** Clear all module state (for testing only). */
export function _resetForTesting(): void {
    for (const timer of saveTimers.values()) clearTimeout(timer);
    saveTimers.clear();
    evicting.clear();
    stateListeners.clear();
    pendingLoads.clear();
    pendingSaves.clear();
    unconfirmedWrites.clear();
    cache.clear();
    titleCache.clear();
    connectionIdCache.clear();
    clientCache.clear();
}
