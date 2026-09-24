import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskManager } from "../../src/hooks/useTaskManager";

const mocks = vi.hoisted(() => {
  const call = vi.fn();
  return { call, client: { call } };
});

vi.mock("../../src/hooks/useTabularisClient", () => ({
  useTabularisClient: () => mocks.client,
}));

const processFixture = {
  plugin_id: "postgres-driver",
  plugin_name: "PostgreSQL Driver",
  pid: 4100,
  cpu_percent: -1,
  memory_bytes: 2048,
  disk_read_bytes: 128,
  disk_write_bytes: 64,
  status: "running" as const,
  children: [],
};

const statsFixture = {
  cpu_percent: 12.5,
  memory_used: 4096,
  memory_total: 8192,
  disk_read_bytes: 256,
  disk_write_bytes: 128,
  process_count: 4,
  tabularis: null,
};

describe("useTaskManager", () => {
  beforeEach(() => {
    mocks.call.mockReset();
    mocks.call.mockImplementation((command: string) => {
      if (command === "get_process_list") return Promise.resolve([processFixture]);
      if (command === "get_system_stats") return Promise.resolve(statsFixture);
      return Promise.resolve(null);
    });
  });

  it("polls process and system snapshots through TabularisClient", async () => {
    const { result, unmount } = renderHook(() => useTaskManager());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.call).toHaveBeenCalledWith("get_process_list", undefined);
    expect(mocks.call).toHaveBeenCalledWith("get_system_stats", undefined);
    expect(result.current.processes[0].cpu_percent).toBe(0);
    expect(result.current.systemStats).toEqual(statsFixture);

    unmount();
  });

  it("runs destructive plugin actions through their local-admin client commands", async () => {
    const { result, unmount } = renderHook(() => useTaskManager());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.killProcess("postgres-driver");
      await result.current.restartProcess("postgres-driver");
    });

    expect(mocks.call).toHaveBeenCalledWith("kill_plugin_process", {
      pluginId: "postgres-driver",
    });
    expect(mocks.call).toHaveBeenCalledWith("restart_plugin_process", {
      pluginId: "postgres-driver",
    });
    unmount();
  });
});
