import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import i18n from "i18next";

import { PluginSlotContext } from "./PluginSlotContext";
import type { PluginSlotRegistryType } from "./PluginSlotContext";
import type { SlotContribution, SlotName, SlotContext } from "../types/pluginSlots";
import { VALID_SLOTS } from "../types/pluginSlots";
import type { PluginManifest } from "../types/plugins";
import { SandboxedPluginFrame } from "../plugins/sandbox/SandboxedPluginFrame";
import { useSettings } from "../hooks/useSettings";
import {
  disposePluginExplainParsers,
  loadPluginExplainParsers,
} from "../utils/pluginExplainLoader";

interface PluginSlotProviderProps {
  children: ReactNode;
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

async function loadExternalPluginContributions(
  manifest: PluginManifest,
): Promise<SlotContribution[]> {
  if (!manifest.ui_extensions?.length) return [];
  // Create one iframe-backed component per module. Plugin source is loaded by
  // the isolated guest page and is never evaluated in the main app window.
  const byModule = new Map<string, typeof manifest.ui_extensions>();
  for (const entry of manifest.ui_extensions) {
    const list = byModule.get(entry.module) ?? [];
    list.push(entry);
    byModule.set(entry.module, list);
  }

  const contributions: SlotContribution[] = [];
  for (const [modulePath, entries] of byModule) {
    const component: SlotContribution["component"] = ({ context, pluginId }) => (
      <SandboxedPluginFrame pluginId={pluginId} module={modulePath} context={context} />
    );
    for (const entry of entries) {
      if (!VALID_SLOTS.has(entry.slot)) continue;
      contributions.push({
        pluginId: manifest.id,
        slot: entry.slot as SlotName,
        component,
        order: entry.order,
        when: entry.driver ? (ctx: SlotContext) => ctx.driver === entry.driver : undefined,
      });
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
  const loadedExplainFormatsRef = useRef<string[]>([]);

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

  // Reload plugin-owned UI and EXPLAIN extensions whenever the enabled set changes.
  useEffect(() => {
    let cancelled = false;
    const loadedContributions: SlotContribution[] = [];
    const loadedExplainFormats: string[] = [];

    for (const format of new Set(loadedExplainFormatsRef.current)) {
      disposePluginExplainParsers([format]);
    }
    loadedExplainFormatsRef.current = [];

    void (async () => {
      const enabledIds = enabledKey.split(",").filter(Boolean).sort();
      // Keep the contribution update asynchronous when no plugins are enabled.
      await Promise.resolve();

      for (const pluginId of enabledIds) {
        if (cancelled) break;
        try {
          const manifest = await invoke<PluginManifest>("get_plugin_manifest", { pluginId });
          await loadPluginTranslations(pluginId);
          const parserFormats = await loadPluginExplainParsers(manifest, () => !cancelled);
          if (cancelled) {
            for (const format of new Set(parserFormats)) {
              disposePluginExplainParsers([format]);
            }
            break;
          }
          loadedExplainFormats.push(...parserFormats);
          loadedExplainFormatsRef.current = loadedExplainFormats;

          const pluginContributions = await loadExternalPluginContributions(manifest);
          loadedContributions.push(...pluginContributions);
        } catch (err) {
          console.error(`[PluginSlot] Failed to load extensions for plugin "${pluginId}":`, err);
        }
      }

      if (!cancelled) {
        setContributions(loadedContributions);
      }
    })();

    return () => {
      cancelled = true;
      for (const format of new Set(loadedExplainFormats)) {
        disposePluginExplainParsers([format]);
      }
      if (loadedExplainFormatsRef.current === loadedExplainFormats) {
        loadedExplainFormatsRef.current = [];
      }
    };
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
