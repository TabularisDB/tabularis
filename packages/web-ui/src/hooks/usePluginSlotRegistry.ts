import { useContext } from "react";

import { PluginSlotContext } from "../contexts/PluginSlotContext";
import type { PluginSlotRegistryType } from "../contexts/PluginSlotContext";

export function usePluginSlotRegistry(): PluginSlotRegistryType {
  const context = useContext(PluginSlotContext);
  if (!context) {
    throw new Error("usePluginSlotRegistry must be used within a PluginSlotProvider");
  }
  return context;
}
