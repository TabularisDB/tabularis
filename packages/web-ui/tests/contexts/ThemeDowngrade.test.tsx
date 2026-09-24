import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useContext, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ThemeProvider as OldProvider } from "../../../../tests/fixtures/themes/pre-feature/contexts/ThemeProvider";
import { ThemeContext as OldContext } from "../../../../tests/fixtures/themes/pre-feature/contexts/ThemeContext";

const native = vi.hoisted(() => ({ invoke: vi.fn(), setTheme: vi.fn(async () => undefined) }));
vi.mock("../../src/hooks/useTabularisClient", () => import("../support/tauriBackedHooks"));
vi.mock("../../src/hooks/usePlatformCapabilities", () => import("../support/tauriBackedHooks"));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ theme: async () => "dark", setTheme: native.setTheme, onThemeChanged: async () => () => undefined }) }));
vi.mock("../../src/utils/systemTheme", () => ({ isLinuxDesktop: () => false }));
let config: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); config = {};
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  native.invoke.mockImplementation(async (command, args) => {
    if (command === "get_config") return { ...config };
    if (command === "get_all_themes") return [];
    if (command === "save_config") { Object.assign(config, args.config); return; }
    throw new Error(`Unexpected pre-feature command: ${command}`);
  });
});
afterAll(() => vi.unstubAllGlobals());
const wrapper = ({ children }: { children: ReactNode }) => <OldProvider>{children}</OldProvider>;

describe("pre-feature downgrade hazard replay (not a compatibility pass)", () => {
  it("keeps the frozen pre-feature provider source unchanged", () => {
    const source = readFileSync("tests/fixtures/themes/pre-feature/contexts/ThemeProvider.tsx", "utf8").replace(/\r\n/g, "\n");
    expect(createHash("sha256").update(source).digest("hex")).toBe("629b003667c130e7a279d85f298aeb6fc099be92c2cf774d44760125cc4b1d9a");
  });
  it.each([`theme:${"a".repeat(64)}:fixture-theme:dark`, "custom-modern-only"])("proves the old client overwrites unavailable selection %s with its fallback", async (id) => {
    config = { theme: id, editorTheme: id, unrelated: "retained" };
    const { result } = renderHook(() => useContext(OldContext), { wrapper });
    await waitFor(() => expect(result.current?.isLoading).toBe(false));
    await waitFor(() => expect(config.theme).toBe("tabularis-dark"));
    expect(native.invoke).toHaveBeenCalledWith("save_config", { config: { theme: "tabularis-dark" } });
    expect(config.editorTheme).toBe(id); expect(config.unrelated).toBe("retained");
    expect(result.current?.currentTheme.id).toBe("tabularis-dark");
  });
  it("retains a pre-feature builtin identity", async () => {
    config = { theme: "monokai" };
    const { result } = renderHook(() => useContext(OldContext), { wrapper });
    await waitFor(() => expect(result.current?.isLoading).toBe(false));
    expect(result.current?.currentTheme.id).toBe("monokai"); expect(config.theme).toBe("monokai");
  });
});
