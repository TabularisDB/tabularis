import type { ComponentType } from "react";
import type { UIExtensionManifestEntry, PluginManifest } from "../types/plugins";
import type { SlotContribution, SlotComponentProps, SlotName } from "../types/pluginSlots";
import { VALID_SLOTS } from "../types/pluginSlots";

function validateSlotName(slot: string): SlotName | null {
  return VALID_SLOTS.has(slot) ? (slot as SlotName) : null;
}

/**
 * Loads a single UI extension module dynamically.
 * Returns a SlotContribution if successful, null if the module fails to load.
 */
export async function loadUIExtensionModule(
  pluginId: string,
  entry: UIExtensionManifestEntry,
  moduleLoader: (modulePath: string) => Promise<{ default: ComponentType<SlotComponentProps> }>,
): Promise<SlotContribution | null> {
  const slotName = validateSlotName(entry.slot);
  if (!slotName) {
    console.warn(
      `[PluginSlot] Plugin "${pluginId}" declares unknown slot "${entry.slot}". Skipping.`,
    );
    return null;
  }

  try {
    const mod = await moduleLoader(entry.module);
    if (!mod.default || typeof mod.default !== "function") {
      console.warn(
        `[PluginSlot] Plugin "${pluginId}" module "${entry.module}" does not export a default component. Skipping.`,
      );
      return null;
    }

    return {
      pluginId,
      slot: slotName,
      component: mod.default,
      order: entry.order,
    };
  } catch (err) {
    console.error(
      `[PluginSlot] Failed to load UI extension module "${entry.module}" for plugin "${pluginId}":`,
      err,
    );
    return null;
  }
}

/**
 * Loads all UI extension modules declared in a plugin manifest.
 * Returns an array of successfully loaded SlotContributions.
 */
export async function loadPluginUIExtensions(
  manifest: PluginManifest,
  moduleLoader: (modulePath: string) => Promise<{ default: ComponentType<SlotComponentProps> }>,
): Promise<SlotContribution[]> {
  if (!manifest.ui_extensions || manifest.ui_extensions.length === 0) {
    return [];
  }

  const results = await Promise.allSettled(
    manifest.ui_extensions.map((entry) =>
      loadUIExtensionModule(manifest.id, entry, moduleLoader),
    ),
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<SlotContribution | null> => r.status === "fulfilled",
    )
    .map((r) => r.value)
    .filter((c): c is SlotContribution => c !== null);
}
