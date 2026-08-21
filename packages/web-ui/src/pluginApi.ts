/**
 * @tabularis/plugin-api
 *
 * Public API surface for plugin UI extensions.
 * Plugin components import these hooks to interact with the host application.
 */

// Plugin hooks
export { usePluginQuery, usePluginConnection, usePluginToast, usePluginSetting, usePluginModal, usePluginTheme, usePluginTranslation, openUrl } from "./hooks/usePluginApi";

// Types
export type { SlotComponentProps, SlotContext, SlotName } from "./types/pluginSlots";
export type { PluginModalOptions } from "./contexts/PluginModalContext";

// Slot registration helper — must be exposed via __TABULARIS_API__ so plugin
// IIFE bundles that externalize @tabularis/plugin-api can call defineSlot().
export function defineSlot(slot: string, component: unknown): { readonly __slot: string; readonly component: unknown } {
  return { __slot: slot, component } as const;
}
