import { createContext } from "react";
import type { RegistryPluginWithStatus } from "../types/plugins";

export interface PluginRegistryState {
  plugins: RegistryPluginWithStatus[];
  updates: RegistryPluginWithStatus[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export const PluginRegistryContext = createContext<
  PluginRegistryState | undefined
>(undefined);
