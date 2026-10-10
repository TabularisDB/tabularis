import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TabularisClient } from "../../src/api/client";
import {
  UI_STATE_CACHE_KEY,
  UI_STATE_KEYS,
  UiStateStore,
} from "../../src/utils/uiStateStore";

const SIDEBAR = UI_STATE_KEYS.sidebarWidth.key;
const LAST_SEEN = UI_STATE_KEYS.lastSeenVersion.key;
const SUPPORT = UI_STATE_KEYS.supportPromptDismissed.key;

type ChangeHandler = (payload: { key: string; value: unknown }) => void;

function mockClient(remote: Record<string, unknown> | Error = {}) {
  let handler: ChangeHandler | undefined;
  const unsubscribe = vi.fn();
  const call = vi.fn(async (command: string) => {
    if (command === "get_ui_state") {
      if (remote instanceof Error) throw remote;
      return remote;
    }
    return undefined;
  });
  const subscribe = vi.fn(async (_event: string, next: ChangeHandler) => {
    handler = next;
    return unsubscribe;
  });
  return {
    call,
    subscribe,
    unsubscribe,
    emit: (key: string, value: unknown) => handler?.({ key, value }),
    client: { call, subscribe } as unknown as TabularisClient,
  };
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("UiStateStore", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("loads every known key once and becomes ready", async () => {
    const store = new UiStateStore();
    const mock = mockClient({ [SIDEBAR]: 320, [LAST_SEEN]: "1.0.0" });
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.isReady()).toBe(false);
    store.attach(mock.client);
    await settle();

    expect(mock.call).toHaveBeenCalledTimes(1);
    expect(mock.call).toHaveBeenCalledWith("get_ui_state", {
      keys: Object.values(UI_STATE_KEYS).map(({ key }) => key),
    });
    expect(store.isReady()).toBe(true);
    expect(store.get(SIDEBAR, 256)).toBe(320);
    expect(store.get(LAST_SEEN, null)).toBe("1.0.0");
    expect(store.get(SUPPORT, false)).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it("writes values through the backend and deletes cleared ones", async () => {
    const store = new UiStateStore();
    const mock = mockClient();
    store.attach(mock.client);
    await settle();

    store.set(LAST_SEEN, "2.0.0");
    store.set(LAST_SEEN, null);
    await settle();

    expect(mock.call).toHaveBeenCalledWith("set_ui_state", { key: LAST_SEEN, value: "2.0.0" });
    expect(mock.call).toHaveBeenCalledWith("delete_ui_state", { key: LAST_SEEN });
    expect(store.get(LAST_SEEN, "fallback")).toBe("fallback");
  });

  it("debounces rapid writes and flushes them on demand", async () => {
    vi.useFakeTimers();
    const store = new UiStateStore();
    const mock = mockClient();
    store.attach(mock.client);
    await settle();
    mock.call.mockClear();

    store.set(SIDEBAR, 300, { debounceMs: 200 });
    store.set(SIDEBAR, 310, { debounceMs: 200 });
    expect(store.get(SIDEBAR, 0)).toBe(310);
    expect(mock.call).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(mock.call).toHaveBeenCalledTimes(1);
    expect(mock.call).toHaveBeenCalledWith("set_ui_state", { key: SIDEBAR, value: 310 });

    store.set(SIDEBAR, 330, { debounceMs: 200 });
    store.flush();
    expect(mock.call).toHaveBeenLastCalledWith("set_ui_state", { key: SIDEBAR, value: 330 });
    vi.advanceTimersByTime(500);
    expect(mock.call).toHaveBeenCalledTimes(2);
  });

  it("follows changes from other windows but keeps a pending local write", async () => {
    vi.useFakeTimers();
    const store = new UiStateStore();
    const mock = mockClient();
    store.attach(mock.client);
    await settle();

    mock.emit(LAST_SEEN, "3.0.0");
    expect(store.get(LAST_SEEN, null)).toBe("3.0.0");
    mock.emit(LAST_SEEN, null);
    expect(store.get(LAST_SEEN, null)).toBeNull();

    store.set(SIDEBAR, 400, { debounceMs: 200 });
    mock.emit(SIDEBAR, 250);
    expect(store.get(SIDEBAR, 0)).toBe(400);
  });

  it("migrates values older versions kept in localStorage", async () => {
    localStorage.setItem(SIDEBAR, "300");
    localStorage.setItem(SUPPORT, "true");
    localStorage.setItem(LAST_SEEN, "0.9.0");
    const store = new UiStateStore();
    const mock = mockClient({ [LAST_SEEN]: "1.2.0" });
    store.attach(mock.client);
    await settle();

    expect(mock.call).toHaveBeenCalledWith("set_ui_state", { key: SIDEBAR, value: 300 });
    expect(mock.call).toHaveBeenCalledWith("set_ui_state", { key: SUPPORT, value: true });
    // The backend value wins over the one this host had.
    expect(mock.call).not.toHaveBeenCalledWith("set_ui_state", { key: LAST_SEEN, value: "0.9.0" });
    expect(store.get(LAST_SEEN, null)).toBe("1.2.0");
    expect(store.get(SUPPORT, false)).toBe(true);
    for (const key of [SIDEBAR, SUPPORT, LAST_SEEN]) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  it("ignores legacy values it cannot parse", async () => {
    localStorage.setItem(SUPPORT, "false");
    const store = new UiStateStore();
    const mock = mockClient();
    store.attach(mock.client);
    await settle();

    expect(mock.call).not.toHaveBeenCalledWith("set_ui_state", expect.anything());
    expect(store.get(SUPPORT, false)).toBe(false);
  });

  it("keeps the legacy value when migrating it fails", async () => {
    localStorage.setItem(SUPPORT, "true");
    const store = new UiStateStore();
    const mock = mockClient();
    mock.call.mockImplementation(async (command: string) => {
      if (command === "get_ui_state") return {};
      throw new Error("disk full");
    });
    store.attach(mock.client);
    await settle();

    expect(store.get(SUPPORT, false)).toBe(true);
    expect(localStorage.getItem(SUPPORT)).toBe("true");
  });

  it("falls back to local values when the backend cannot be read", async () => {
    localStorage.setItem(SIDEBAR, "300");
    const store = new UiStateStore();
    const mock = mockClient(new Error("offline"));
    store.attach(mock.client);
    await settle();

    expect(store.isReady()).toBe(true);
    expect(store.get(SIDEBAR, 256)).toBe(300);
    expect(localStorage.getItem(SIDEBAR)).toBe("300");
  });

  it("does not let a slow load overwrite a local change", async () => {
    let resolve: (value: Record<string, unknown>) => void = () => {};
    const store = new UiStateStore();
    const mock = mockClient();
    mock.call.mockImplementation((command: string) =>
      command === "get_ui_state"
        ? new Promise((next) => {
            resolve = next;
          })
        : Promise.resolve(undefined),
    );
    store.attach(mock.client);
    store.set(SIDEBAR, 450);
    resolve({ [SIDEBAR]: 200 });
    await settle();

    expect(store.get(SIDEBAR, 0)).toBe(450);
  });

  it("keeps layout values in a first-paint cache only", async () => {
    const store = new UiStateStore();
    store.attach(mockClient().client);
    await settle();
    store.set(SIDEBAR, 333);
    store.set(LAST_SEEN, "1.0.0");

    expect(JSON.parse(localStorage.getItem(UI_STATE_CACHE_KEY) ?? "{}")).toEqual({ [SIDEBAR]: 333 });
    const next = new UiStateStore();
    expect(next.get(SIDEBAR, 256)).toBe(333);
    expect(next.get(LAST_SEEN, null)).toBeNull();
  });

  it("commits before notifying and rejects without changing the value", async () => {
    const store = new UiStateStore();
    const mock = mockClient();
    store.attach(mock.client);
    await settle();
    const listener = vi.fn();
    store.subscribe(listener);

    mock.call.mockRejectedValueOnce(new Error("denied"));
    await expect(store.commit(SUPPORT, true)).rejects.toThrow("denied");
    expect(store.get(SUPPORT, false)).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    await store.commit(SUPPORT, true);
    expect(store.get(SUPPORT, false)).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("stops following changes and flushes writes when detached", async () => {
    vi.useFakeTimers();
    const store = new UiStateStore();
    const mock = mockClient();
    const detach = store.attach(mock.client);
    await settle();

    store.set(SIDEBAR, 290, { debounceMs: 200 });
    detach();

    expect(mock.unsubscribe).toHaveBeenCalledOnce();
    expect(mock.call).toHaveBeenCalledWith("set_ui_state", { key: SIDEBAR, value: 290 });
  });
});
