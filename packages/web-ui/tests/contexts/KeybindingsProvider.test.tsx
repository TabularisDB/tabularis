import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsProvider } from "../../src/contexts/KeybindingsProvider";
import { useKeybindings } from "../../src/hooks/useKeybindings";
import type { UserOverrides } from "../../src/utils/keybindings";

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

describe("KeybindingsProvider persistence failures", () => {
  const originalOverrides: UserOverrides = {
    open_settings: {
      mac: { metaKey: true, key: ",", code: "Comma" },
      win: { ctrlKey: true, key: ",", code: "Comma" },
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    client.call.mockImplementation((command: string) => {
      if (command === "get_keybindings") {
        return Promise.resolve(originalOverrides);
      }
      if (command === "save_keybindings") {
        return Promise.reject(new Error("disk full"));
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
  });

  it("should restore the previous override when persistence fails", async () => {
    const { result } = renderHook(() => useKeybindings(), { wrapper });
    await waitFor(() =>
      expect(result.current.overrides).toEqual(originalOverrides),
    );

    let saveError: unknown;
    await act(async () => {
      try {
        await result.current.saveOverride(
          "open_settings",
          { metaKey: true, key: "k", code: "KeyK" },
          { ctrlKey: true, key: "k", code: "KeyK" },
        );
      } catch (error) {
        saveError = error;
      }
    });

    expect(saveError).toEqual(new Error("disk full"));
    expect(result.current.overrides).toEqual(originalOverrides);
  });

  it("should restore a removed override when reset persistence fails", async () => {
    const { result } = renderHook(() => useKeybindings(), { wrapper });
    await waitFor(() =>
      expect(result.current.overrides).toEqual(originalOverrides),
    );

    let resetError: unknown;
    await act(async () => {
      try {
        await result.current.resetOverride("open_settings");
      } catch (error) {
        resetError = error;
      }
    });

    expect(resetError).toEqual(new Error("disk full"));
    expect(result.current.overrides).toEqual(originalOverrides);
  });
});
