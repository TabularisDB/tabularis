import { describe, it, expect, vi } from "vitest";
import { loadUIExtensionModule, loadPluginUIExtensions } from "../../src/utils/pluginModuleLoader";
import type { PluginManifest } from "../../src/types/plugins";
import type { SlotComponentProps } from "../../src/types/pluginSlots";

const DummyComponent = (() => null) as React.FC<SlotComponentProps>;

describe("pluginModuleLoader", () => {
  describe("loadUIExtensionModule", () => {
    it("should load a valid module for a known slot", async () => {
      const loader = vi.fn().mockResolvedValue({ default: DummyComponent });

      const result = await loadUIExtensionModule("test-plugin", {
        slot: "data-grid.toolbar.actions",
        module: "./ui/MyButton.tsx",
        order: 50,
      }, loader);

      expect(result).not.toBeNull();
      expect(result?.pluginId).toBe("test-plugin");
      expect(result?.slot).toBe("data-grid.toolbar.actions");
      expect(result?.component).toBe(DummyComponent);
      expect(result?.order).toBe(50);
      expect(loader).toHaveBeenCalledWith("./ui/MyButton.tsx");
    });

    it("should return null for an unknown slot name", async () => {
      const loader = vi.fn().mockResolvedValue({ default: DummyComponent });

      const result = await loadUIExtensionModule("test-plugin", {
        slot: "unknown.slot.name",
        module: "./ui/Something.tsx",
      }, loader);

      expect(result).toBeNull();
      expect(loader).not.toHaveBeenCalled();
    });

    it("should return null when module has no default export", async () => {
      const loader = vi.fn().mockResolvedValue({ namedExport: DummyComponent });

      const result = await loadUIExtensionModule("test-plugin", {
        slot: "sidebar.footer.actions",
        module: "./ui/Bad.tsx",
      }, loader);

      expect(result).toBeNull();
    });

    it("should return null when module loading throws", async () => {
      const loader = vi.fn().mockRejectedValue(new Error("Module not found"));

      const result = await loadUIExtensionModule("test-plugin", {
        slot: "sidebar.footer.actions",
        module: "./ui/Missing.tsx",
      }, loader);

      expect(result).toBeNull();
    });
  });

  describe("loadPluginUIExtensions", () => {
    it("should return empty array for manifest without ui_extensions", async () => {
      const manifest: PluginManifest = {
        id: "test",
        name: "Test",
        version: "1.0.0",
        description: "Test plugin",
        default_port: null,
        capabilities: {
          schemas: false,
          views: false,
          routines: false,
          file_based: false,
          folder_based: false,
          identifier_quote: '"',
          alter_primary_key: false,
        },
      };
      const loader = vi.fn();

      const result = await loadPluginUIExtensions(manifest, loader);
      expect(result).toEqual([]);
      expect(loader).not.toHaveBeenCalled();
    });

    it("should load multiple valid extensions and skip invalid ones", async () => {
      const manifest: PluginManifest = {
        id: "geo-plugin",
        name: "Geo Plugin",
        version: "1.0.0",
        description: "Geometry plugin",
        default_port: null,
        capabilities: {
          schemas: false,
          views: false,
          routines: false,
          file_based: false,
          folder_based: false,
          identifier_quote: '"',
          alter_primary_key: false,
        },
        ui_extensions: [
          { slot: "row-editor-sidebar.field.after", module: "./ui/GeoPreview.tsx", order: 50 },
          { slot: "invalid.slot", module: "./ui/Bad.tsx" },
          { slot: "data-grid.toolbar.actions", module: "./ui/ToolbarBtn.tsx" },
        ],
      };

      const loader = vi.fn().mockResolvedValue({ default: DummyComponent });

      const result = await loadPluginUIExtensions(manifest, loader);

      expect(result).toHaveLength(2);
      expect(result[0]?.slot).toBe("row-editor-sidebar.field.after");
      expect(result[0]?.order).toBe(50);
      expect(result[1]?.slot).toBe("data-grid.toolbar.actions");
      // Invalid slot should not trigger loader
      expect(loader).toHaveBeenCalledTimes(2);
    });

    it("should handle module loading failures gracefully", async () => {
      const manifest: PluginManifest = {
        id: "fail-plugin",
        name: "Fail Plugin",
        version: "1.0.0",
        description: "Test",
        default_port: null,
        capabilities: {
          schemas: false,
          views: false,
          routines: false,
          file_based: false,
          folder_based: false,
          identifier_quote: '"',
          alter_primary_key: false,
        },
        ui_extensions: [
          { slot: "sidebar.footer.actions", module: "./ui/Good.tsx" },
          { slot: "sidebar.footer.actions", module: "./ui/Broken.tsx" },
        ],
      };

      const loader = vi.fn()
        .mockResolvedValueOnce({ default: DummyComponent })
        .mockRejectedValueOnce(new Error("Network error"));

      const result = await loadPluginUIExtensions(manifest, loader);

      expect(result).toHaveLength(1);
      expect(result[0]?.pluginId).toBe("fail-plugin");
    });
  });
});
