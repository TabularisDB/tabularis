import type { TabularisClient } from "../api/client";

/**
 * UI state shared by every host (desktop windows and browser sessions).
 *
 * Values live in the backend SQLite store (`get_ui_state` / `set_ui_state`),
 * so a sidebar width chosen on the desktop is also used in the browser. This
 * module keeps an in-memory copy so components can read synchronously.
 */
export interface UiStateKeyDefinition<T> {
  key: string;
  /** Converts the value an older version kept in localStorage. */
  parseLegacy: (raw: string) => T | undefined;
  /**
   * Mirror the value in localStorage so the first paint uses it before the
   * backend answers. Only layout values need this: a sidebar that starts at
   * the default width and then snaps to the saved one is a visible jump.
   */
  firstPaintCache?: boolean;
}

const parseWidth = (raw: string): number | undefined => {
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const parseTrue = (raw: string): boolean | undefined =>
  raw === "true" ? true : undefined;

export const UI_STATE_KEYS = {
  sidebarWidth: {
    key: "tabularis_sidebar_width",
    parseLegacy: parseWidth,
    firstPaintCache: true,
  },
  rowEditorSidebarWidth: {
    key: "tabularis_row_editor_sidebar_width",
    parseLegacy: parseWidth,
    firstPaintCache: true,
  },
  lastSeenVersion: {
    key: "tabularis_last_seen_version",
    parseLegacy: (raw: string) => (raw ? raw : undefined),
  },
  supportPromptDismissed: {
    key: "tabularis_support_prompt_dismissed",
    parseLegacy: parseTrue,
  },
  discordCalloutDismissed: {
    key: "tabularis:discord-callout-v2-dismissed",
    parseLegacy: parseTrue,
  },
} satisfies Record<string, UiStateKeyDefinition<unknown>>;

const DEFINITIONS: UiStateKeyDefinition<unknown>[] = Object.values(UI_STATE_KEYS);

/** One localStorage entry holds every first-paint value. */
export const UI_STATE_CACHE_KEY = "tabularis:ui-state-cache";

interface SetOptions {
  /** Coalesce rapid writes (e.g. while dragging a resize handle). */
  debounceMs?: number;
}

type Listener = () => void;

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export class UiStateStore {
  private readonly values = new Map<string, unknown>();
  private readonly listeners = new Set<Listener>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pending = new Map<string, unknown>();
  /** Keys changed locally since the current load started. */
  private readonly dirty = new Set<string>();
  private readonly definitions: UiStateKeyDefinition<unknown>[];
  private client: TabularisClient | null = null;
  private ready = false;
  private generation = 0;

  constructor(definitions: UiStateKeyDefinition<unknown>[] = DEFINITIONS) {
    this.definitions = definitions;
    this.readFirstPaintCache();
  }

  get<T>(key: string, fallback: T): T {
    return this.values.has(key) ? (this.values.get(key) as T) : fallback;
  }

  isReady(): boolean {
    return this.ready;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Updates immediately and writes to the backend in the background. */
  set(key: string, value: unknown, options: SetOptions = {}): void {
    if (Object.is(this.values.get(key), value)) return;
    this.dirty.add(key);
    this.applyLocal(key, value);
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    this.timers.delete(key);
    if (options.debounceMs && options.debounceMs > 0) {
      this.pending.set(key, value);
      this.timers.set(
        key,
        setTimeout(() => {
          this.timers.delete(key);
          this.pending.delete(key);
          void this.write(key, value).catch(logWriteFailure(key));
        }, options.debounceMs),
      );
      return;
    }
    this.pending.delete(key);
    void this.write(key, value).catch(logWriteFailure(key));
  }

  /** Writes to the backend first and only then updates subscribers. */
  async commit(key: string, value: unknown): Promise<void> {
    await this.write(key, value);
    this.dirty.add(key);
    this.applyLocal(key, value);
  }

  /** Forgets every value and the attached client, then re-reads the cache. */
  reset(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
    this.dirty.clear();
    this.values.clear();
    this.client = null;
    this.ready = false;
    this.generation += 1;
    this.readFirstPaintCache();
    this.notify();
  }

  /** Sends debounced writes now (e.g. before the page unloads). */
  flush(): void {
    for (const [key, timer] of this.timers) {
      clearTimeout(timer);
      const value = this.pending.get(key);
      this.pending.delete(key);
      void this.write(key, value).catch(logWriteFailure(key));
    }
    this.timers.clear();
  }

  /**
   * Loads the shared values, migrates values older versions kept in
   * localStorage and follows changes made by other windows or sessions.
   */
  attach(client: TabularisClient): () => void {
    const generation = ++this.generation;
    this.client = client;
    this.dirty.clear();
    let unsubscribe: (() => void) | undefined;
    let disposed = false;

    void client
      .subscribe("ui-state://changed", ({ key, value }) => {
        if (generation !== this.generation) return;
        if (this.timers.has(key)) return; // a newer local write is on its way
        this.applyLocal(key, value);
      })
      .then((stop) => {
        if (disposed) stop();
        else unsubscribe = stop;
      })
      .catch((error: unknown) => {
        console.warn("Failed to follow shared UI state changes:", error);
      });

    void this.load(client, generation);

    return () => {
      disposed = true;
      unsubscribe?.();
      this.flush();
      if (generation === this.generation) this.client = null;
    };
  }

  private async load(client: TabularisClient, generation: number): Promise<void> {
    const keys = this.definitions.map((definition) => definition.key);
    let remote: Readonly<Record<string, unknown>> | null = null;
    try {
      remote = await client.call("get_ui_state", { keys });
    } catch (error) {
      console.warn("Failed to load shared UI state; using local values:", error);
    }
    if (generation !== this.generation) return;

    const storage = safeStorage();
    for (const definition of this.definitions) {
      const { key } = definition;
      if (this.dirty.has(key)) continue;
      const remoteValue = remote?.[key];
      if (remoteValue !== undefined && remoteValue !== null) {
        this.applyLocal(key, remoteValue);
        removeLegacy(storage, key);
        continue;
      }
      if (!remote) continue;
      // The backend has no value yet: migrate the one this host already had.
      const legacy = readLegacy(storage, definition);
      const local = legacy !== undefined ? legacy : this.values.get(key);
      if (local === undefined) continue;
      this.applyLocal(key, local);
      try {
        await client.call("set_ui_state", { key, value: local });
        removeLegacy(storage, key);
      } catch (error) {
        console.warn(`Failed to migrate UI state "${key}":`, error);
      }
    }

    this.ready = true;
    this.notify();
  }

  private async write(key: string, value: unknown): Promise<void> {
    const client = this.client;
    if (!client) return;
    if (value === undefined || value === null) {
      await client.call("delete_ui_state", { key });
    } else {
      await client.call("set_ui_state", { key, value });
    }
  }

  private applyLocal(key: string, value: unknown): void {
    if (value === undefined || value === null) this.values.delete(key);
    else this.values.set(key, value);
    this.writeFirstPaintCache();
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private readFirstPaintCache(): void {
    const storage = safeStorage();
    if (!storage) return;
    let cached: Record<string, unknown> = {};
    try {
      const raw = storage.getItem(UI_STATE_CACHE_KEY);
      if (raw) cached = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      cached = {};
    }
    for (const definition of this.definitions) {
      if (!definition.firstPaintCache) continue;
      const value = cached[definition.key] ?? readLegacy(storage, definition);
      if (value !== undefined) this.values.set(definition.key, value);
    }
  }

  private writeFirstPaintCache(): void {
    const storage = safeStorage();
    if (!storage) return;
    const cached: Record<string, unknown> = {};
    for (const definition of this.definitions) {
      if (definition.firstPaintCache && this.values.has(definition.key)) {
        cached[definition.key] = this.values.get(definition.key);
      }
    }
    try {
      storage.setItem(UI_STATE_CACHE_KEY, JSON.stringify(cached));
    } catch {
      // The cache only avoids a layout jump; the backend keeps the value.
    }
  }
}

function readLegacy(
  storage: Storage | null,
  definition: UiStateKeyDefinition<unknown>,
): unknown {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(definition.key);
    return raw === null ? undefined : definition.parseLegacy(raw);
  } catch {
    return undefined;
  }
}

function removeLegacy(storage: Storage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Harmless: the backend value wins on every later start.
  }
}

function logWriteFailure(key: string) {
  return (error: unknown) => {
    console.warn(`Failed to save UI state "${key}":`, error);
  };
}

export const uiStateStore = new UiStateStore();
