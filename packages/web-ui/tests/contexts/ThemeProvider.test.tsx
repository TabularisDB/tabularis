import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TabularisClient } from "../../src/api/client";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ThemeProvider } from "../../src/contexts/ThemeProvider";
import { useTheme } from "../../src/hooks/useTheme";
import { themeRegistry } from "../../src/themes/themeRegistry";
import { applyThemeToCSS } from "../../src/themes/themeUtils";
import { loadStartupConfig } from "../../src/utils/startupConfig";
import { builtinCatalog } from "../../src/utils/themeCatalog";
import type { NativeThemeCatalog, NativeThemeContribution } from "../../src/types/themeCatalog";
import type { Theme } from "../../src/types/theme";
import capabilities from "../../../../src-tauri/capabilities/default.json";

vi.mock("@tauri-apps/api/core");
vi.mock("@tauri-apps/api/event");
// The provider reaches migrated commands through the client; route them to the
// same invoke mock so every command is asserted in one place.
const mockClient = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../../src/hooks/useTabularisClient", () => ({
  useTabularisClient: () => mockClient,
}));
vi.mock("../../src/platform/environment", () => ({
  detectPlatformEnvironment: () => "tauri",
}));
const tauriWindow = vi.hoisted(() => ({ onThemeChanged: vi.fn(), setTheme: vi.fn(), theme: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => tauriWindow }));
vi.mock("../../src/themes/themeUtils", async (original) => ({ ...await original<typeof import("../../src/themes/themeUtils")>(), applyThemeToCSS: vi.fn() }));

let config: Record<string, unknown>;
let personal: NativeThemeContribution[];
let systemDark: boolean;
let mediaDark: boolean | undefined;
let portalTheme: "dark" | "light" | null | undefined;
let mediaListeners: Array<(event: { matches: boolean }) => void>;
let nativeListeners: Array<(event: { payload: "dark" | "light" | null }) => void>;
let events: Map<string, Set<() => void>>;
let identity: number;

function legacy(id = "custom-one", base = "tabularis-dark"): NativeThemeContribution {
  const theme = { ...themeRegistry.getPreset(base)!, id, name: id, isPreset: false, isReadOnly: false };
  return { id, name: id, revision: "one", origin: { kind: "personal" }, readOnly: false, mode: base === "tabularis-light" ? "light" : "dark", format: "legacy", source: JSON.stringify(theme), available: true };
}
function installed(): NativeThemeContribution {
  return { id: `theme:${"a".repeat(64)}:fixture:dark`, name: "Package", revision: "one", origin: { kind: "installed", identity: { registryKey: "a".repeat(64), packageName: "fixture", variantId: "dark" }, packageVersion: "1.0.0" }, readOnly: true, mode: "dark", format: "v1", source: '{"schemaVersion":1,"mode":"dark"}', available: true };
}
function snapshot(): NativeThemeCatalog { return structuredClone({ themes: [...builtinCatalog().themes.map(({ entry }) => entry), ...personal], issues: [] }); }
function fireSystemThemeChange(dark: boolean) {
  systemDark = dark;
  mediaListeners.forEach((listener) => listener({ matches: dark }));
  nativeListeners.forEach((listener) => listener({ payload: dark ? "dark" : "light" }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const wrapper = ({ children }: { children: React.ReactNode }) => <ThemeProvider>{children}</ThemeProvider>;
async function mount() {
  const hook = renderHook(() => useTheme(), { wrapper });
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook;
}
function saves() { return vi.mocked(invoke).mock.calls.filter(([command]) => command === "save_config"); }

beforeEach(() => {
  vi.resetAllMocks();
  mockClient.call.mockImplementation((command: string, args: unknown) =>
    args === undefined ? invoke(command) : invoke(command, args as Record<string, unknown>));
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Macintosh");
  config = {}; personal = []; identity = 0;
  systemDark = false; mediaDark = undefined; portalTheme = undefined;
  mediaListeners = []; nativeListeners = []; events = new Map();
  localStorage.clear();
  tauriWindow.setTheme.mockResolvedValue(undefined);
  tauriWindow.theme.mockImplementation(async () => systemDark ? "dark" : "light");
  tauriWindow.onThemeChanged.mockImplementation(async (callback) => {
    nativeListeners.push(callback);
    return () => { nativeListeners = nativeListeners.filter((listener) => listener !== callback); };
  });
  vi.mocked(listen).mockImplementation(async (name, callback) => {
    const handler = () => callback({ event: name, id: 0, payload: undefined as never });
    const group = events.get(name) ?? new Set<() => void>();
    group.add(handler); events.set(name, group);
    return () => { group.delete(handler); };
  });
  Object.defineProperty(window, "matchMedia", { writable: true, value: (query: string) => ({
    matches: query === "(prefers-color-scheme: dark)" && (mediaDark ?? systemDark),
    addEventListener: (_: string, callback: (event: { matches: boolean }) => void) => { mediaListeners.push(callback); },
    removeEventListener: (_: string, callback: (event: { matches: boolean }) => void) => { mediaListeners = mediaListeners.filter((listener) => listener !== callback); },
  }) });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const data = args as Record<string, unknown> | undefined;
    if (command === "get_config") return structuredClone(config);
    if (command === "get_theme_catalog") return snapshot();
    if (command === "export_theme") return personal.find((entry) => entry.id === data?.themeId)?.source;
    if (command === "get_linux_system_theme" && portalTheme !== undefined) return portalTheme;
    if (command === "save_config") { config = { ...config, ...data?.config as Record<string, unknown> }; return; }
    if (command === "delete_custom_theme") { personal = personal.filter((entry) => entry.id !== data?.themeId); return; }
    if (command === "save_custom_theme") {
      const theme = data?.theme as Theme;
      personal = personal.map((entry) => entry.id === theme.id ? { ...entry, name: theme.name, revision: "updated", source: JSON.stringify(theme) } : entry);
      return;
    }
    if (command === "duplicate_personal_theme") {
      const base = snapshot().themes.find((entry) => entry.id === data?.themeId)!;
      const entry = { ...base, id: `custom-${++identity}`, name: data?.name as string, readOnly: false, origin: { kind: "personal" as const }, editor: data?.editor as NativeThemeContribution["editor"] };
      personal.push(entry); return structuredClone(entry);
    }
    if (command === "create_personal_theme") {
      const entry: NativeThemeContribution = { ...legacy(`custom-${++identity}`), name: data?.name as string, format: "v1", source: data?.source as string };
      personal.push(entry); return structuredClone(entry);
    }
    if (command === "update_personal_theme") {
      const previous = personal.find((entry) => entry.id === data?.themeId)!;
      if (previous.revision !== data?.expectedRevision) throw new Error("Stale revision");
      const entry = { ...previous, source: data?.source as string, name: data?.name as string, revision: "updated" };
      personal = personal.map((value) => value.id === entry.id ? entry : value); return structuredClone(entry);
    }
    if (command === "import_theme") {
      const value = JSON.parse(data?.themeJson as string) as Theme;
      const entry = { ...legacy(`custom-${++identity}`), name: value.name, source: JSON.stringify(value) };
      personal.push(entry); return { id: entry.id };
    }
    throw new Error(`Unexpected command: ${command}`);
  });
});

describe("ThemeProvider catalog and explicit persistence", () => {
  it("uses revision-checked snapshot updates with the explicit editor definition", async () => {
    const editor = { base: "vs-dark" as const, inherit: true, colors: {}, rules: [{ token: "string.sql", foreground: "0000ff" }] };
    personal = [{ ...legacy("custom-edit"), editor }];
    const { result } = await mount();
    vi.mocked(invoke).mockResolvedValueOnce({ ...personal[0], name: "Edited", revision: "new" });
    await act(async () => { await result.current.updatePersonalSource("custom-edit", "Edited", personal[0].source, "captured-original", editor); });
    expect(invoke).toHaveBeenCalledWith("update_personal_snapshot", { themeId: "custom-edit", name: "Edited", source: personal[0].source, expectedRevision: "captured-original", editor });
    expect(saves()).toHaveLength(0);
  });

  it("imports versioned snapshots through the native snapshot API without selecting them", async () => {
    const { result } = await mount();
    const entry = { ...legacy("custom-snapshot"), editor: { base: "vs-dark" as const, inherit: true, colors: {}, rules: [{ token: "string.sql", foreground: "ff0000" }] } };
    const document = JSON.stringify({ themeSnapshotVersion: 1, source: entry.source, editor: entry.editor });
    vi.mocked(invoke).mockResolvedValueOnce(entry);
    await act(async () => {
      const imported = await result.current.importTheme(document, "Snapshot");
      expect(imported.monacoTheme).toEqual(entry.editor);
    });
    expect(invoke).toHaveBeenCalledWith("create_personal_snapshot", { source: document, name: "Snapshot" });
    expect(saves()).toHaveLength(0);
  });

  it.each(["themeSnapshotVersion", "schemaVersion"])("does not reinterpret historical %s metadata as a discriminator", async (marker) => {
    const { result } = await mount();
    const source = JSON.stringify({ ...JSON.parse(legacy("custom-legacy").source), [marker]: "opaque" });
    await act(async () => { await result.current.importTheme(source); });
    expect(invoke).toHaveBeenCalledWith("import_theme", { themeJson: source });
    expect(saves()).toHaveLength(0);
  });

  it("passes an explicitly chosen legacy import name without rewriting its source in JavaScript", async () => {
    const { result } = await mount(); const source = legacy("custom-legacy").source;
    await act(async () => { await result.current.importTheme(source, "Chosen name"); });
    expect(invoke).toHaveBeenCalledWith("import_theme", { themeJson: source, name: "Chosen name" });
    expect(saves()).toHaveLength(0);
  });

  it("detects system defaults without writing an empty profile", async () => {
    const { result } = await mount();
    expect(result.current.currentTheme.id).toBe("tabularis-light");
    expect(saves()).toEqual([]);
  });
  it("loads a saved theme without resaving it", async () => {
    config.theme = "monokai";
    const { result } = await mount();
    expect(result.current.currentTheme.id).toBe("monokai"); expect(saves()).toEqual([]);
  });
  it.each([
    { saved: { theme: "monokai" }, dark: false, expected: "monokai" },
    { saved: { theme: "nord", followSystemTheme: true, darkThemeId: "monokai" }, dark: true, expected: "monokai" },
    { saved: { theme: "nord", followSystemTheme: true, lightThemeId: "tabularis-light" }, dark: false, expected: "tabularis-light" },
  ])("applies builtin $expected before catalog hydration (system dark: $dark)", async ({ saved, dark, expected }) => {
    config = saved; systemDark = dark;
    const pending = deferred<NativeThemeCatalog>();
    const native = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation((command, args) => command === "get_theme_catalog" ? pending.promise : native(command, args));
    const { result } = renderHook(() => useTheme(), { wrapper });
    await waitFor(() => expect(applyThemeToCSS).toHaveBeenCalledWith(expect.objectContaining({ id: expected })));
    expect(result.current.isLoading).toBe(true);
    expect(saves()).toEqual([]);
    await act(async () => pending.resolve(snapshot()));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.currentTheme.id).toBe(expected);
    expect(saves()).toEqual([]);
  });
  it("waits for an installed theme without applying or persisting a builtin replacement", async () => {
    personal = [installed()]; config.theme = personal[0].id;
    const pending = deferred<NativeThemeCatalog>();
    const native = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation((command, args) => command === "get_theme_catalog" ? pending.promise : native(command, args));
    const { result } = renderHook(() => useTheme(), { wrapper });
    await act(async () => { await loadStartupConfig(); });
    expect(result.current.isLoading).toBe(true);
    expect(applyThemeToCSS).not.toHaveBeenCalled();
    await act(async () => pending.resolve(snapshot()));
    expect(result.current.currentTheme.id).toBe(personal[0].id);
    expect(saves()).toEqual([]);
  });
  it("reads historical localStorage without migrating during hydration", async () => {
    const source = '{"activeThemeId":"monokai"}'; localStorage.setItem("tabularis_theme_settings", source);
    const { result } = await mount();
    expect(result.current.currentTheme.id).toBe("monokai"); expect(saves()).toEqual([]);
    expect(localStorage.getItem("tabularis_theme_settings")).toBe(source);
  });
  it("loads legacy personal contributions", async () => {
    personal = [legacy()]; config.theme = personal[0].id;
    const { result } = await mount();
    expect(result.current.currentTheme.id).toBe("custom-one"); expect(result.current.currentTheme.isReadOnly).toBe(false);
  });
  it("persists only explicit selection and clears legacy storage afterwards", async () => {
    localStorage.setItem("tabularis_theme_settings", '{"activeThemeId":"monokai"}');
    const { result } = await mount();
    await act(async () => result.current.setTheme("tabularis-dark"));
    expect(config.theme).toBe("tabularis-dark"); expect(saves()).toHaveLength(1);
    expect(localStorage.getItem("tabularis_theme_settings")).toBeNull();
  });
  it("creates and duplicates independent native-issued personal identities", async () => {
    const { result } = await mount();
    let first!: Theme; let second!: Theme;
    await act(async () => { first = await result.current.createCustomTheme("monokai", "One"); second = await result.current.duplicateTheme("monokai", "Two"); });
    expect(first.id).not.toBe(second.id); expect(first.isReadOnly).toBe(false);
    expect(invoke).toHaveBeenCalledWith("duplicate_personal_theme", expect.objectContaining({ themeId: "monokai", editor: expect.objectContaining({ rules: expect.any(Array) }) }));
  });
  it("updates legacy personal themes through the retained command", async () => {
    personal = [legacy()]; config.theme = personal[0].id;
    const { result } = await mount();
    await act(async () => result.current.updateCustomTheme({ ...result.current.currentTheme, name: "Edited" }));
    expect(result.current.currentTheme.name).toBe("Edited"); expect(saves()).toEqual([]);
  });
  it("refuses builtin and installed mutation even if caller flags claim ownership", async () => {
    personal = [installed()]; const { result } = await mount();
    for (const id of ["tabularis-dark", installed().id]) {
      const theme = result.current.allThemes.find((value) => value.id === id)!;
      await expect(result.current.updateCustomTheme({ ...theme, isPreset: false, isReadOnly: false })).rejects.toThrow("Cannot modify");
      await expect(result.current.deleteCustomTheme(id)).rejects.toThrow("Cannot delete");
    }
  });
  it("preserves explicit personal-delete replacement behavior", async () => {
    personal = [legacy()]; config.theme = personal[0].id;
    const { result } = await mount();
    await act(async () => result.current.deleteCustomTheme("custom-one"));
    expect(result.current.currentTheme.id).toBe("tabularis-dark"); expect(config.theme).toBe("tabularis-dark");
  });
  it("imports both legacy and v1 sources through native ownership boundaries", async () => {
    const { result } = await mount();
    await act(async () => {
      expect((await result.current.importTheme(legacy().source)).isPreset).toBe(false);
      expect((await result.current.importTheme('{"schemaVersion":1,"mode":"dark"}', "Original")).name).toBe("Original");
    });
    expect(personal).toHaveLength(2); expect(saves()).toEqual([]);
  });
  it("exports original raw source instead of a renderer projection", async () => {
    personal = [{ ...legacy(), source: legacy().source.replace(/}$/, ',"opaque":900719925474099312345}') }];
    const { result } = await mount();
    expect(await result.current.exportTheme(personal[0].id)).toBe(personal[0].source);
  });
  it("updates v1 leaves while retaining untouched author declarations", async () => {
    personal = [{ ...installed(), id: "custom-one", origin: { kind: "personal" }, readOnly: false }]; config.theme = "custom-one";
    const { result } = await mount();
    const theme = structuredClone(result.current.currentTheme); theme.colors.accent.primary = "#123456";
    await act(async () => result.current.updateCustomTheme(theme));
    expect(JSON.parse(personal[0].source).colors).toEqual({ accent: { primary: "#123456" } });
  });
});

describe("preview, fallback and concurrency", () => {
  it("reports a committed deletion separately from a failed preference write", async () => {
    personal = [legacy("custom-deleted")]; config.theme = "custom-deleted";
    const { result } = await mount();
    const native = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation((command, args) => command === "save_config" ? Promise.reject(new Error("settings disk unavailable")) : native(command, args));
    await act(async () => { await expect(result.current.deleteCustomTheme("custom-deleted")).resolves.toBeUndefined(); });
    expect(personal).toEqual([]);
    expect(config.theme).toBe("custom-deleted");
    expect(result.current.catalog.issues.some((issue) => issue.message.includes("Personal theme deleted; preference update failed"))).toBe(true);
  });

  it("restores the latest saved selection on cancel, without writes or personal files", async () => {
    config.theme = "monokai"; const { result } = await mount();
    act(() => result.current.previewTheme("tabularis-light"));
    expect(result.current.currentTheme.id).toBe("tabularis-light"); expect(config.theme).toBe("monokai");
    act(() => result.current.cancelPreview());
    expect(result.current.currentTheme.id).toBe("monokai"); expect(saves()).toEqual([]); expect(personal).toEqual([]);
  });
  it("previews v1 source without importing it", async () => {
    const { result } = await mount();
    act(() => result.current.previewDefinition('{"schemaVersion":1,"mode":"dark"}', "Preview"));
    expect(result.current.selection.previewing).toBe(true); expect(personal).toEqual([]); expect(saves()).toEqual([]);
  });
  it("retains a missing package identity and restores it after reinstall", async () => {
    config.theme = installed().id; const { result } = await mount();
    expect(result.current.selection.missingId).toBe(installed().id);
    expect(result.current.settings.activeThemeId).toBe(installed().id);
    await act(async () => { personal = [installed()]; await result.current.refreshCatalog(); });
    expect(result.current.currentTheme.id).toBe(installed().id); expect(saves()).toEqual([]);
    await act(async () => { personal = [{ ...installed(), available: false }]; await result.current.refreshCatalog(); });
    expect(result.current.selection.missingId).toBe(installed().id); expect(config.theme).toBe(installed().id);
  });
  it("refreshes same-ID revisions without changing the stored choice", async () => {
    personal = [installed()]; config.theme = installed().id; const { result } = await mount();
    const previous = result.current.currentTheme;
    await act(async () => { personal[0] = { ...installed(), revision: "two", source: '{"schemaVersion":1,"mode":"dark","colors":{"accent":{"primary":"#123456"}}}' }; await result.current.refreshCatalog(); });
    expect(result.current.currentTheme).not.toBe(previous); expect(result.current.currentTheme.colors.accent.primary).toBe("#123456"); expect(saves()).toEqual([]);
  });
  it("discards older catalog responses", async () => {
    const { result } = await mount(); const older = deferred<NativeThemeCatalog>();
    const native = vi.mocked(invoke).getMockImplementation()!; let reads = 0;
    vi.mocked(invoke).mockImplementation((command, args) => command === "get_theme_catalog" && ++reads === 1 ? older.promise : native(command, args));
    let first!: Promise<unknown>;
    act(() => { first = result.current.refreshCatalog(); });
    await act(async () => { personal = [installed()]; await result.current.refreshCatalog(); });
    await act(async () => { older.resolve({ themes: [], issues: [] }); await first; });
    expect(result.current.allThemes.some((theme) => theme.id === installed().id)).toBe(true);
  });
  it("serializes explicit preference writes and does not commit a failed save", async () => {
    const { result } = await mount(); const pending = deferred<void>();
    const native = vi.mocked(invoke).getMockImplementation()!; let writes = 0;
    vi.mocked(invoke).mockImplementation((command, args) => command === "save_config" && ++writes === 1 ? pending.promise : native(command, args));
    let first!: Promise<void>; let second!: Promise<void>;
    act(() => { first = result.current.setTheme("monokai"); second = result.current.setTheme("tabularis-dark"); });
    await waitFor(() => expect(writes).toBe(1));
    await act(async () => { pending.reject(new Error("disk unavailable")); await expect(first).rejects.toThrow("disk unavailable"); await second; });
    expect(config.theme).toBe("tabularis-dark"); expect(result.current.currentTheme.id).toBe("tabularis-dark");
  });
  it("does not report a committed creation as failed when refresh is unavailable", async () => {
    const { result } = await mount();
    const native = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation((command, args) => command === "get_theme_catalog" ? Promise.reject(new Error("refresh unavailable")) : native(command, args));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await act(async () => expect(result.current.duplicateTheme("monokai", "Created")).resolves.toMatchObject({ name: "Created" }));
      expect(personal).toHaveLength(1);
      expect(result.current.catalog.issues.at(-1)?.message).toContain("committed");
    } finally { warning.mockRestore(); }
  });
  it("uses the editor's original revision rather than silently accepting a newer catalog revision", async () => {
    personal = [{ ...installed(), id: "personal", origin: { kind: "personal" }, readOnly: false }];
    const { result } = await mount();
    await act(async () => { personal[0].revision = "external-change"; await result.current.refreshCatalog(); });
    await expect(result.current.updatePersonalSource("personal", "Name", installed().source, "one")).rejects.toThrow("Stale revision");
  });
  it("refuses preference writes while initial hydration is pending", async () => {
    const pending = deferred<Record<string, unknown>>();
    const native = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation((command, args) => command === "get_config" ? pending.promise : native(command, args));
    const { result } = renderHook(() => useTheme(), { wrapper });
    await expect(result.current.updateSettings({ followSystemTheme: true })).rejects.toThrow("still loading");
    await act(async () => pending.resolve({ theme: "monokai" }));
    expect(result.current.currentTheme.id).toBe("monokai"); expect(saves()).toEqual([]);
  });
  it("cancels preview against the current OS mode rather than its opening mode", async () => {
    config = { theme: "monokai", followSystemTheme: true };
    const { result } = await mount();
    act(() => result.current.previewTheme("nord"));
    act(() => fireSystemThemeChange(true));
    expect(result.current.currentTheme.id).toBe("nord");
    act(() => result.current.cancelPreview());
    expect(result.current.currentTheme.id).toBe("tabularis-dark"); expect(config.theme).toBe("monokai"); expect(saves()).toEqual([]);
  });
  it("shares StrictMode config hydration with other boot consumers and cleans duplicate subscriptions", async () => {
    const pending = deferred<Record<string, unknown>>();
    const native = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation((command, args) => command === "get_config" ? pending.promise : native(command, args));
    const sharedConfig = loadStartupConfig(mockClient as unknown as TabularisClient);
    const { result, unmount } = renderHook(() => useTheme(), { wrapper, reactStrictMode: true });
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "get_config")).toHaveLength(1);
    await act(async () => pending.resolve({ theme: "monokai" }));
    await expect(sharedConfig).resolves.toEqual({ theme: "monokai" });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.currentTheme.id).toBe("monokai"); expect(saves()).toEqual([]);
    expect(events.get("theme-catalog-changed")?.size).toBe(1);
    unmount(); expect(events.get("theme-catalog-changed")?.size).toBe(0);
  });
  it("unsubscribes catalog and system events on unmount", async () => {
    config.followSystemTheme = true; const { unmount } = await mount(); unmount();
    expect(events.get("theme-catalog-changed")?.size).toBe(0); expect(nativeListeners).toHaveLength(0);
  });
});

describe("native and portal system theme compatibility", () => {
  it("grants native theme changes to the application's main window", () => {
    expect(capabilities.windows).toContain("main"); expect(capabilities.permissions).toContain("core:window:allow-set-theme");
  });
  it("uses the Linux portal even when GTK and WebKit follow the application theme", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("X11; Linux x86_64");
    portalTheme = "dark"; config = { followSystemTheme: true, theme: "tabularis-light" }; mediaDark = false;
    tauriWindow.setTheme.mockImplementation(async (theme: string | null) => { systemDark = theme === "dark"; mediaDark = systemDark; });
    const { result, unmount } = await mount();
    expect(result.current.currentTheme.id).toBe("tabularis-dark"); expect(tauriWindow.theme).not.toHaveBeenCalled();
    await act(async () => { portalTheme = "light"; events.get("linux-system-theme-changed")?.forEach((callback) => callback()); });
    expect(result.current.currentTheme.id).toBe("tabularis-light"); expect(tauriWindow.setTheme).toHaveBeenLastCalledWith("light");
    await act(async () => { portalTheme = null; systemDark = true; events.get("linux-system-theme-changed")?.forEach((callback) => callback()); });
    expect(result.current.currentTheme.id).toBe("tabularis-dark"); expect(saves()).toEqual([]);
    unmount(); expect(mediaListeners).toHaveLength(0);
  });
  it("falls back to the native theme when the Linux portal is unavailable", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("X11; Linux x86_64");
    systemDark = true; mediaDark = false; config.followSystemTheme = true;
    const { result } = await mount(); expect(result.current.currentTheme.id).toBe("tabularis-dark");
  });
  it("re-resolves a null native event through the media fallback", async () => {
    config.followSystemTheme = true; const { result } = await mount();
    await act(async () => { tauriWindow.theme.mockResolvedValue(null); mediaDark = true; nativeListeners.forEach((listener) => listener({ payload: null })); });
    expect(result.current.currentTheme.id).toBe("tabularis-dark");
  });
  it("keeps the native mode authoritative over a conflicting media query", async () => {
    systemDark = true; mediaDark = false; config = { theme: "tabularis-light", followSystemTheme: true };
    const { result } = await mount(); expect(result.current.currentTheme.id).toBe("tabularis-dark");
    expect(result.current.settings.activeThemeId).toBe("tabularis-light"); expect(tauriWindow.setTheme).toHaveBeenLastCalledWith(null);
  });
  it("uses media queries outside the native runtime", async () => {
    mediaDark = true; tauriWindow.theme.mockRejectedValue(new Error("unavailable")); tauriWindow.onThemeChanged.mockRejectedValue(new Error("unavailable")); config.followSystemTheme = true;
    const { result } = await mount(); expect(result.current.currentTheme.id).toBe("tabularis-dark");
    act(() => mediaListeners.forEach((listener) => listener({ matches: false })));
    expect(result.current.currentTheme.id).toBe("tabularis-light");
  });
  it("persists explicit system-mode settings, not subsequent OS changes", async () => {
    config.theme = "tabularis-dark"; const { result } = await mount();
    await act(async () => result.current.updateSettings({ followSystemTheme: true }));
    expect(result.current.currentTheme.id).toBe("tabularis-light"); expect(saves()).toHaveLength(1);
    act(() => fireSystemThemeChange(true)); expect(result.current.currentTheme.id).toBe("tabularis-dark"); expect(saves()).toHaveLength(1);
    expect(config.theme).toBe("tabularis-dark");
  });
  it("uses per-mode fallbacks without overwriting missing choices", async () => {
    config = { followSystemTheme: true, theme: "monokai", lightThemeId: "missing-light", darkThemeId: "missing-dark" };
    const { result } = await mount(); expect(result.current.currentTheme.id).toBe("tabularis-light");
    act(() => fireSystemThemeChange(true)); expect(result.current.currentTheme.id).toBe("tabularis-dark");
    expect(result.current.settings.lightThemeId).toBe("missing-light"); expect(config.darkThemeId).toBe("missing-dark"); expect(saves()).toEqual([]);
  });
  it("ignores system changes in static mode", async () => {
    config.theme = "monokai"; const { result } = await mount(); act(() => fireSystemThemeChange(true)); expect(result.current.currentTheme.id).toBe("monokai");
  });
  it("replaces a deleted personal system pick with the matching mode", async () => {
    personal = [legacy("custom-light", "tabularis-light")]; config = { theme: "custom-light", followSystemTheme: true, lightThemeId: "custom-light" };
    const { result } = await mount(); expect(result.current.currentTheme.id).toBe("custom-light");
    await act(async () => result.current.deleteCustomTheme("custom-light"));
    expect(result.current.currentTheme.id).toBe("tabularis-light"); expect(result.current.settings.lightThemeId).toBe("tabularis-light");
  });
});
