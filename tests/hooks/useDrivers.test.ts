import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { listen, type EventCallback } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const settingsMock = { settings: {} as { activeExternalDrivers?: string[] } };
vi.mock("../../src/hooks/useSettings", () => ({
  useSettings: () => settingsMock,
}));

import { useDrivers } from "../../src/hooks/useDrivers";

const listenMock = vi.mocked(listen);
const invokeMock = vi.mocked(invoke);

describe("useDrivers", () => {
  let handlers: Record<string, EventCallback<unknown>>;

  beforeEach(() => {
    handlers = {};
    listenMock.mockReset();
    invokeMock.mockReset();
    settingsMock.settings = {};
    listenMock.mockImplementation((event, handler) => {
      handlers[event as string] = handler as EventCallback<unknown>;
      return Promise.resolve(() => {});
    });
  });

  const emitPluginActivated = () => {
    handlers["tabularis://plugin-activated"]({
      event: "tabularis://plugin-activated",
      id: 1,
      payload: { pluginId: "postgresql" },
    });
  };

  it("re-fetches drivers and installed plugins when tabularis://plugin-activated fires", async () => {
    // Cold start: the force-install flow hasn't installed postgresql yet.
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_registered_drivers") return Promise.resolve([]);
      if (cmd === "get_installed_plugins") return Promise.resolve([]);
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const { result } = renderHook(() => useDrivers());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.installedPlugins).toEqual([]);

    // The backend's spawned background task finishes installing and
    // registering the plugin after this hook already loaded — simulated by
    // switching the mocked responses before firing the event.
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_registered_drivers") {
        return Promise.resolve([{ id: "postgresql", is_builtin: false }]);
      }
      if (cmd === "get_installed_plugins") {
        return Promise.resolve([{ id: "postgresql", name: "PostgreSQL", version: "1.0.0", description: "" }]);
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    emitPluginActivated();

    await waitFor(() => {
      expect(result.current.installedPlugins).toEqual([
        { id: "postgresql", name: "PostgreSQL", version: "1.0.0", description: "" },
      ]);
    });
    expect(result.current.allDrivers).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "postgresql" })]),
    );
  });

  it("unsubscribes from tabularis://plugin-activated on unmount", async () => {
    const unlisten = vi.fn();
    listenMock.mockImplementation((event, handler) => {
      handlers[event as string] = handler as EventCallback<unknown>;
      return Promise.resolve(unlisten);
    });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_registered_drivers") return Promise.resolve([]);
      if (cmd === "get_installed_plugins") return Promise.resolve([]);
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const { unmount } = renderHook(() => useDrivers());
    await waitFor(() => {
      expect(listenMock).toHaveBeenCalledWith(
        "tabularis://plugin-activated",
        expect.any(Function),
      );
    });

    unmount();
    expect(unlisten).toHaveBeenCalled();
  });
});
