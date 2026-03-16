/**
 * @tabularis/plugin-api
 *
 * Public API surface for plugin UI extensions.
 * Plugin components import these hooks to interact with the host application.
 */

// Plugin hooks
export { usePluginQuery, usePluginConnection, usePluginToast, usePluginSetting, usePluginTheme, usePluginTranslation } from "./hooks/usePluginApi";

// Types
export type { SlotComponentProps, SlotContext, SlotName } from "./types/pluginSlots";
