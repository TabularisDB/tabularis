import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TabularisClient } from "../../src/api/client";
import { TabularisClientProvider } from "../../src/contexts/TabularisClientProvider";
import { UiStateProvider } from "../../src/contexts/UiStateProvider";
import { useUiState, useUiStateReady } from "../../src/hooks/useUiState";
import { UI_STATE_KEYS, UiStateStore } from "../../src/utils/uiStateStore";

const SIDEBAR = UI_STATE_KEYS.sidebarWidth;

type ChangeHandler = (payload: { key: string; value: unknown }) => void;

function mockClient(remote: Record<string, unknown>) {
  let handler: ChangeHandler | undefined;
  const unsubscribe = vi.fn();
  const call = vi.fn(async (command: string) =>
    command === "get_ui_state" ? remote : undefined,
  );
  const subscribe = vi.fn(async (_event: string, next: ChangeHandler) => {
    handler = next;
    return unsubscribe;
  });
  return {
    call,
    unsubscribe,
    emit: (key: string, value: unknown) => handler?.({ key, value }),
    client: { call, subscribe } as unknown as TabularisClient,
  };
}

function Probe({ store }: { store: UiStateStore }) {
  const [width, setWidth] = useUiState(SIDEBAR, 256, { store, debounceMs: 100 });
  const ready = useUiStateReady(store);
  return (
    <button type="button" onClick={() => setWidth(width + 10)}>
      {ready ? "ready" : "loading"}:{width}
    </button>
  );
}

function renderWith(store: UiStateStore, client: TabularisClient) {
  return render(
    <TabularisClientProvider client={client}>
      <UiStateProvider store={store}>
        <Probe store={store} />
      </UiStateProvider>
    </TabularisClientProvider>,
  );
}

describe("UiStateProvider", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it("loads shared values, follows live changes and writes with debounce", async () => {
    const store = new UiStateStore();
    const mock = mockClient({ [SIDEBAR.key]: 300 });
    renderWith(store, mock.client);

    expect(await screen.findByText("ready:300")).toBeInTheDocument();

    act(() => mock.emit(SIDEBAR.key, 280));
    expect(screen.getByText("ready:280")).toBeInTheDocument();

    vi.useFakeTimers();
    act(() => screen.getByRole("button").click());
    act(() => screen.getByRole("button").click());
    expect(screen.getByText("ready:300")).toBeInTheDocument();
    expect(mock.call).not.toHaveBeenCalledWith("set_ui_state", expect.anything());
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(mock.call).toHaveBeenCalledTimes(2);
    expect(mock.call).toHaveBeenLastCalledWith("set_ui_state", { key: SIDEBAR.key, value: 300 });
  });

  it("flushes pending writes when the page is hidden and detaches on unmount", async () => {
    const store = new UiStateStore();
    const mock = mockClient({});
    const { unmount } = renderWith(store, mock.client);
    await screen.findByText("ready:256");

    act(() => screen.getByRole("button").click());
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(mock.call).toHaveBeenCalledWith("set_ui_state", { key: SIDEBAR.key, value: 266 });

    unmount();
    expect(mock.unsubscribe).toHaveBeenCalledOnce();
  });
});
