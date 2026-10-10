import type { TypedCommandCaller } from "../api/contract";
import type { NotebookMetadata, NotebookState } from "../types/notebook";
import { createDefaultNotebookState } from "./notebook";
import { serializeNotebook, deserializeNotebook } from "./notebookFile";

const SAVE_DEBOUNCE_MS = 1500;

/**
 * Dispatched whenever the set of saved notebooks changes (create, import,
 * rename, delete) so UI listing notebooks — e.g. the sidebar — can refresh
 * without polling.
 */
export const NOTEBOOKS_CHANGED_EVENT = "tabularis:notebooks-changed";

function notifyNotebooksChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(NOTEBOOKS_CHANGED_EVENT));
  }
}

// Module-level session cache
const cache = new Map<string, NotebookState>();
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
  const title = titleCache.get(notebookId) ?? "Notebook";
  const connectionId = connectionIdCache.get(notebookId);
  const notebook = serializeNotebook(
    title,
    state.cells,
    state.params,
    state.stopOnError,
    connectionId,
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
  return client.call("save_notebook", { connectionId, notebookId, content });
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

/** Update cached notebook state and schedule debounced save. */
export function setNotebookState(notebookId: string, state: NotebookState): void {
  cache.set(notebookId, state);
  scheduleSave(notebookId);
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
  connectionIdCache.set(notebookId, connectionId);
  clientCache.set(notebookId, client);

  const cached = cache.get(notebookId);
  if (cached) return cached;

  const content = await client.call("load_notebook", {
    connectionId,
    notebookId,
  });
  if (!content) {
    // File not found — create default state
    const state = createDefaultNotebookState();
    cache.set(notebookId, state);
    titleCache.set(notebookId, "Notebook");
    return state;
  }

  const { title, cells, params, stopOnError } = deserializeNotebook(content);
  const state: NotebookState = { cells, params, stopOnError };
  cache.set(notebookId, state);
  titleCache.set(notebookId, title);
  return state;
}

/** Create a new notebook with default state, save to disk. */
export async function createNotebook(
  title: string,
  connectionId: string,
  client: TypedCommandCaller,
): Promise<{ notebookId: string; state: NotebookState }> {
  const notebookId = generateNotebookId();
  const state = createDefaultNotebookState();

  titleCache.set(notebookId, title);
  connectionIdCache.set(notebookId, connectionId);
  clientCache.set(notebookId, client);
  cache.set(notebookId, state);

  const content = serializeForDisk(notebookId, state);
  await client.call("create_notebook", { connectionId, notebookId, content });
  notifyNotebooksChanged();

  return { notebookId, state };
}

/** Create a notebook file from existing in-memory state (used for migration). */
export async function createNotebookFromState(
  title: string,
  state: NotebookState,
  connectionId: string,
  client: TypedCommandCaller,
): Promise<{ notebookId: string }> {
  const notebookId = generateNotebookId();

  titleCache.set(notebookId, title);
  connectionIdCache.set(notebookId, connectionId);
  clientCache.set(notebookId, client);
  cache.set(notebookId, state);

  const content = serializeForDisk(notebookId, state);
  await client.call("create_notebook", { connectionId, notebookId, content });
  notifyNotebooksChanged();

  return { notebookId };
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
  cache.delete(notebookId);
  titleCache.delete(notebookId);
  connectionIdCache.delete(notebookId);
  clientCache.delete(notebookId);
  await client.call("delete_notebook", { connectionId, notebookId });
  notifyNotebooksChanged();
}

/** List saved notebooks for a connection (metadata only, read from disk). */
export async function listNotebooks(
  connectionId: string,
  client: TypedCommandCaller,
): Promise<NotebookMetadata[]> {
  return client.call("list_notebooks", { connectionId });
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
  await client.call("rename_notebook", { connectionId, notebookId, title });
  notifyNotebooksChanged();
}

/** Flush pending save and remove from cache (on tab close). */
export async function evictFromCache(notebookId: string): Promise<void> {
  await flushSave(notebookId);
  cache.delete(notebookId);
  titleCache.delete(notebookId);
  connectionIdCache.delete(notebookId);
  clientCache.delete(notebookId);
}

/** Flush all pending saves immediately (on app close). */
export async function flushAllPendingSaves(): Promise<void> {
  const ids = Array.from(saveTimers.keys());
  await Promise.all(ids.map(flushSave));
}

/** Clear all module state (for testing only). */
export function _resetForTesting(): void {
  for (const timer of saveTimers.values()) clearTimeout(timer);
  saveTimers.clear();
  cache.clear();
  titleCache.clear();
  connectionIdCache.clear();
  clientCache.clear();
}
