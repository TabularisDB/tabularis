import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsProvider } from "../../src/contexts/KeybindingsProvider";
import { useKeybindings } from "../../src/hooks/useKeybindings";

const client = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../../src/hooks/useTabularisClient", () => ({
  useTabularisClient: () => client,
}));

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(KeybindingsProvider, null, children);

describe("KeybindingsProvider", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    client.call.mockImplementation((command: string) => {
      if (command === "get_keybindings") {
        return Promise.resolve({
          open_settings: {
            mac: { key: ",", metaKey: true },
            win: { key: ",", ctrlKey: true },
          },
        });
      }
      if (command === "save_keybindings") return Promise.resolve(null);
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
  });

  it("loads and saves overrides through the active client", async () => {
    const { result } = renderHook(() => useKeybindings(), { wrapper });

    await waitFor(() => {
      expect(result.current.overrides.open_settings).toBeDefined();
    });

    await act(async () => {
      await result.current.saveOverride(
        "open_settings",
        { key: "s", metaKey: true },
        { key: "s", ctrlKey: true },
      );
    });

    expect(client.call).toHaveBeenCalledWith("save_keybindings", {
      keybindings: {
        open_settings: {
          mac: { key: "s", metaKey: true },
          win: { key: "s", ctrlKey: true },
        },
      },
    });
  });
});
