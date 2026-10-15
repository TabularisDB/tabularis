import { createContext } from "react";

import type { SlotContribution, SlotName, SlotContext } from "../types/pluginSlots";

export interface PluginSlotRegistryType {
  /** All registered contributions */
  contributions: SlotContribution[];
  /** Register a new contribution. Returns an unregister function. */
  register: (contribution: SlotContribution) => () => void;
  /** Register multiple contributions at once. Returns an unregister-all function. */
  registerAll: (contributions: SlotContribution[]) => () => void;
  /** Get sorted, filtered contributions for a given slot */
  getSlotContributions: (slot: SlotName, context: SlotContext) => SlotContribution[];
}

export const PluginSlotContext = createContext<PluginSlotRegistryType | undefined>(undefined);
