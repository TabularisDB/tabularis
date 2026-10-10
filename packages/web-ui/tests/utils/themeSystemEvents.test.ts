import { beforeEach, expect, it, vi } from "vitest";
import { listenForTauriSystemThemeChanges as listenForSystemThemeChanges } from "../../src/platform/tauriCapabilities";
import {
  getSystemIsDark,
  listenForSystemThemeChanges as listenThroughActivePlatform,
} from "../../src/utils/themeSystemEvents";
import { registerActivePlatformCapabilities } from "../../src/platform/activeCapabilities";
import type { PlatformCapabilities } from "../../src/platform/capabilities";

const native = vi.hoisted(() => ({ theme: vi.fn(), onThemeChanged: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
vi.mock("../../src/utils/systemTheme", () => ({ isLinuxDesktop: () => false }));
beforeEach(() => vi.resetAllMocks());

it("reads the current OS mode when follow-system is enabled later", async () => {
  native.theme.mockResolvedValue("dark");
  native.onThemeChanged.mockResolvedValue(vi.fn());
  const change = vi.fn();
  const stop = await listenForSystemThemeChanges(change);
  expect(change).toHaveBeenLastCalledWith(true);
  stop();
});

it("does not allow a delayed initial read to override a newer event", async () => {
  let complete!: (mode: string) => void;
  let changed!: (event: { payload: string }) => void;
  native.theme.mockImplementation(() => new Promise<string>((resolve) => { complete = resolve; }));
  native.onThemeChanged.mockImplementation(async (callback) => { changed = callback; return vi.fn(); });
  const change = vi.fn();
  const subscription = listenForSystemThemeChanges(change);
  await vi.waitFor(() => expect(complete).toBeDefined());
  changed({ payload: "light" }); complete("dark");
  const stop = await subscription;
  expect(change).toHaveBeenCalledTimes(1); expect(change).toHaveBeenLastCalledWith(false);
  stop();
});

it("delegates to the registered platform", async () => {
  const stop = vi.fn();
  const platform = {
    getSystemIsDark: vi.fn().mockResolvedValue(true),
    listenForSystemThemeChanges: vi.fn().mockResolvedValue(stop),
  };
  registerActivePlatformCapabilities(platform as unknown as PlatformCapabilities);
  const change = vi.fn();
  await expect(getSystemIsDark()).resolves.toBe(true);
  await expect(listenThroughActivePlatform(change)).resolves.toBe(stop);
  expect(platform.listenForSystemThemeChanges).toHaveBeenCalledWith(change);
});
