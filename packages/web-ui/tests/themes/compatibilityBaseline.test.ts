import { createHash } from "node:crypto";
import type * as Monaco from "monaco-editor";
import { afterEach, describe, expect, it, vi } from "vitest";
import { themeRegistry } from "../../src/themes/themeRegistry";
import { exportTheme, importTheme } from "../../src/utils/themeManagement";
import builtinGolden from "../../../../tests/fixtures/themes/builtin-rendering.json";
import assetGolden from "../../../../tests/fixtures/themes/named-editor-assets.json";
import legacyFrontend from "../../../../tests/fixtures/themes/legacy-frontend.json";

const namedAssets = import.meta.glob<string>("../../src/themes/monaco/*.json", {
  query: "?raw",
  import: "default",
  eager: true,
});

// Captured from unmodified main at d044381c. These fixtures must not be
// regenerated from a changed resolver just to make a compatibility test pass.
describe("theme compatibility baseline", () => {
  afterEach(() => {
    document.documentElement.style.cssText = "";
    vi.restoreAllMocks();
  });

  it("keeps every builtin ID, order, descriptor and offline fallback", () => {
    expect(themeRegistry.getAllPresets()).toEqual(
      builtinGolden.builtinRendering.map(({ theme }) => theme),
    );
    expect(themeRegistry.getDefault().id).toBe("tabularis-dark");
  });

  it.each(builtinGolden.builtinRendering)(
    "preserves CSS, generated editor defaults and the actual editor asset for $theme.id",
    async (golden) => {
      // Isolate the existing ID-only Monaco cache so every observation comes
      // from defineTheme, not a definition cached by an earlier test.
      vi.resetModules();
      const { applyThemeToCSS, generateMonacoTheme, loadMonacoTheme } =
        await import("../../src/themes/themeUtils");
      const theme = themeRegistry.getPreset(golden.theme.id);
      expect(theme).toBeDefined();
      if (!theme) throw new Error(`Missing builtin ${golden.theme.id}`);

      const defineTheme = vi.fn<
        (id: string, definition: Monaco.editor.IStandaloneThemeData) => void
      >();
      const setTheme = vi.fn<(id: string) => void>();
      const editor = { editor: { defineTheme, setTheme } } as unknown as typeof Monaco;

      applyThemeToCSS(theme);
      const style = document.documentElement.style;
      const css = Object.fromEntries(
        Array.from(style).sort().map((key) => [key, style.getPropertyValue(key)]),
      );
      expect(css).toEqual(golden.css);
      expect(generateMonacoTheme(theme)).toEqual(golden.generatedEditor);

      loadMonacoTheme(theme, editor);
      expect(defineTheme).toHaveBeenCalledTimes(1);
      expect(defineTheme.mock.calls[0][0]).toBe(theme.id);
      expect(setTheme).toHaveBeenCalledExactlyOnceWith(theme.id);
      const digest = createHash("sha256")
        .update(JSON.stringify(defineTheme.mock.calls[0][1]))
        .digest("hex");
      expect(digest).toBe(golden.editorSha256);
    },
  );

  it("preserves all checked-in named editor assets, including the unused legacy asset", () => {
    const digests = Object.fromEntries(
      Object.entries(namedAssets).map(([path, content]) => [
        path.slice(path.lastIndexOf("/") + 1),
        createHash("sha256").update(content).digest("hex"),
      ]),
    );
    expect(digests).toEqual(assetGolden);
  });

  it("keeps standalone personal JSON visual data and attribution on import/export", () => {
    const serialized = JSON.stringify(legacyFrontend);
    const imported = importTheme(serialized, "custom-independent-copy");
    expect(imported).toMatchObject({
      id: "custom-independent-copy",
      name: legacyFrontend.name,
      author: legacyFrontend.author,
      version: legacyFrontend.version,
      isPreset: false,
      isReadOnly: false,
      colors: legacyFrontend.colors,
      typography: legacyFrontend.typography,
      layout: legacyFrontend.layout,
      monacoTheme: legacyFrontend.monacoTheme,
      taskbarIcon: legacyFrontend.taskbarIcon,
    });
    expect(JSON.parse(exportTheme(imported))).toEqual(imported);
    expect(JSON.stringify(legacyFrontend)).toBe(serialized);
  });
});
