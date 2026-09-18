import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useConnectionCatalogue } from "../../src/hooks/useConnectionCatalogue";

vi.mock("../../src/hooks/useDrivers", () => ({ useDrivers: () => ({ allDrivers: [] }) }));
vi.mock("../../src/hooks/useSettings", () => ({ useSettings: () => ({ settings: {} }) }));

describe("useConnectionCatalogue", () => {
  it("does not fetch for a passive reader, shares active readers, and refreshes all readers", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    const passive = renderHook(() => useConnectionCatalogue(false));
    expect(invoke).not.toHaveBeenCalled();
    const first = renderHook(() => useConnectionCatalogue());
    const second = renderHook(() => useConnectionCatalogue());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(second.result.current.loading).toBe(false);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("fetch_plugin_registry");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("offline"));
    await act(async () => { await first.result.current.refresh(); });
    await waitFor(() => expect(passive.result.current.registryOffline).toBe(true));
    expect(second.result.current.registryOffline).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
