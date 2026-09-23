import { beforeEach, expect, it, vi } from "vitest";
import { listenForSystemThemeChanges } from "../../src/utils/themeSystemEvents";

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
