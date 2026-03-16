import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import * as React from "react";
import * as ReactJSXRuntime from "react/jsx-runtime";
import { invoke } from "@tauri-apps/api/core";
import i18n from "i18next";

import { PluginSlotContext } from "./PluginSlotContext";
import type { PluginSlotRegistryType } from "./PluginSlotContext";
import type { SlotContribution, SlotName, SlotContext } from "../types/pluginSlots";
import type { PluginManifest } from "../types/plugins";
import * as pluginApi from "../pluginApi";
import { useSettings } from "../hooks/useSettings";

interface PluginSlotProviderProps {
  children: React.ReactNode;
}

const VALID_SLOTS = new Set<string>([
  "row-edit-modal.field.after",
  "row-edit-modal.footer.before",
  "row-editor-sidebar.field.after",
  "row-editor-sidebar.header.actions",
  "data-grid.toolbar.actions",
  "data-grid.context-menu.items",
  "sidebar.footer.actions",
  "settings.plugin.actions",
]);

/**
 * Expose host globals so external plugin bundles (IIFE format) can access
 * React and the Tabularis plugin API without bundling their own copies.
 */
let globalsExposed = false;
function exposePluginGlobals() {
  if (globalsExposed) return;
  globalsExposed = true;
  (window as Record<string, unknown>).React = React;
  (window as Record<string, unknown>).ReactJSXRuntime = ReactJSXRuntime;
  (window as Record<string, unknown>).__TABULARIS_API__ = pluginApi;
}

/**
 * Loads translation files for a plugin and registers them in i18next.
 * Tries the current language first, then falls back to 'en'.
 * Missing locale files are silently skipped.
 * Each plugin's translations are registered under its own namespace (plugin id).
 */
async function loadPluginTranslations(pluginId: string): Promise<void> {
  const langs = Array.from(new Set([i18n.language?.split("-")[0], "en"])).filter(Boolean) as string[];
  for (const lang of langs) {
    if (i18n.hasResourceBundle(lang, pluginId)) continue;
    try {
      const raw = await invoke<string>("read_plugin_file", {
        pluginId,
        filePath: `locales/${lang}.json`,
      });
      const translations = JSON.parse(raw) as Record<string, unknown>;
      i18n.addResourceBundle(lang, pluginId, translations, true, true);
    } catch {
      // Locale file absent or invalid — silently skip.
    }
  }
}

/**
 * Load all UI extension contributions from a plugin's pre-built IIFE bundle.
 *
 * The bundle is expected to be built with:
 *   - format: 'iife', name: '__tabularis_plugin__'
 *   - externals: { react, react/jsx-runtime, @tabularis/plugin-api }
 *   - globals: { react: 'React', 'react/jsx-runtime': 'ReactJSXRuntime',
 *               '@tabularis/plugin-api': '__TABULARIS_API__' }
 */
async function loadExternalPluginContributions(
  manifest: PluginManifest,
): Promise<SlotContribution[]> {
  if (!manifest.ui_extensions?.length) return [];

  exposePluginGlobals();

  // Group entries by module path to load each bundle once.
  const byModule = new Map<string, typeof manifest.ui_extensions>();
  for (const entry of manifest.ui_extensions) {
    const list = byModule.get(entry.module) ?? [];
    list.push(entry);
    byModule.set(entry.module, list);
  }

  const contributions: SlotContribution[] = [];

  for (const [modulePath, entries] of byModule) {
    try {
      const source = await invoke<string>("read_plugin_file", {
        pluginId: manifest.id,
        filePath: modulePath,
      });

      // Execute the IIFE, passing React globals as parameters.
      // The bundle assigns its exports to the local `__tabularis_plugin__` var.
      // eslint-disable-next-line no-new-func
      const fn = new Function(
        "React",
        "ReactJSXRuntime",
        "__TABULARIS_API__",
        source + "\n return typeof __tabularis_plugin__ !== 'undefined' ? __tabularis_plugin__ : null;",
      );
      const raw = fn(React, ReactJSXRuntime, pluginApi) as unknown;
      // Support both direct export (`return Component`) and ES-module style (`return { default: Component }`).
      const component =
        typeof raw === "function"
          ? raw
          : (raw as { default?: unknown } | null)?.default ?? null;

      if (!component || typeof component !== "function") {
        console.warn(
          `[PluginSlot] Plugin "${manifest.id}" module "${modulePath}" has no default component export. Skipping.`,
        );
        continue;
      }

      for (const entry of entries) {
        if (!VALID_SLOTS.has(entry.slot)) {
          console.warn(`[PluginSlot] Plugin "${manifest.id}" declares unknown slot "${entry.slot}". Skipping.`);
          continue;
        }
        contributions.push({
          pluginId: manifest.id,
          slot: entry.slot as SlotName,
          component: component as React.ComponentType<{ context: SlotContext; pluginId: string }>,
          order: entry.order,
        });
      }
    } catch (err) {
      console.error(
        `[PluginSlot] Failed to load module "${modulePath}" for plugin "${manifest.id}":`,
        err,
      );
    }
  }

  return contributions;
}

export const PluginSlotProvider = ({ children }: PluginSlotProviderProps) => {
  const [contributions, setContributions] = useState<SlotContribution[]>([]);
  const { settings } = useSettings();
  const activeExternalDrivers = settings.activeExternalDrivers ?? [];
  // Stable serialized key so the effect re-runs only when the enabled set changes.
  const enabledKey = [...activeExternalDrivers].sort().join(",");
  const enabledKeyRef = useRef(enabledKey);
  enabledKeyRef.current = enabledKey;

  const register = useCallback((contribution: SlotContribution) => {
    setContributions((prev) => [...prev, contribution]);
    return () => {
      setContributions((prev) => prev.filter((c) => c !== contribution));
    };
  }, []);

  const getSlotContributions = useCallback(
    (slot: SlotName, context: SlotContext): SlotContribution[] => {
      return contributions
        .filter((c) => c.slot === slot)
        .filter((c) => !c.when || c.when(context))
        .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    },
    [contributions],
  );

  // Reload UI extensions whenever the set of enabled external plugins changes.
  useEffect(() => {
    let cancelled = false;
    const loaded: SlotContribution[] = [];

    (async () => {
      const enabledIds = new Set(enabledKeyRef.current.split(",").filter(Boolean));
      if (enabledIds.size === 0) return;

      for (const pluginId of enabledIds) {
        if (cancelled) break;
        try {
          const manifest = await invoke<PluginManifest>("get_plugin_manifest", { pluginId });
          await loadPluginTranslations(pluginId);
          const pluginContributions = await loadExternalPluginContributions(manifest);
          loaded.push(...pluginContributions);
        } catch (err) {
          console.error(`[PluginSlot] Failed to load UI extensions for plugin "${pluginId}":`, err);
        }
      }

      if (!cancelled) {
        setContributions(loaded);
      }
    })();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey]);

  const registerAll = useCallback((newContributions: SlotContribution[]) => {
    setContributions((prev) => [...prev, ...newContributions]);
    return () => {
      const toRemove = new Set(newContributions);
      setContributions((prev) => prev.filter((c) => !toRemove.has(c)));
    };
  }, []);

  const value: PluginSlotRegistryType = useMemo(
    () => ({ contributions, register, registerAll, getSlotContributions }),
    [contributions, register, registerAll, getSlotContributions],
  );

  return (
    <PluginSlotContext.Provider value={value}>
      {children}
    </PluginSlotContext.Provider>
  );
};
