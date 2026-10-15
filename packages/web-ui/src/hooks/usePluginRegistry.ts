import { useContext } from "react";
import { PluginRegistryContext } from "../contexts/PluginRegistryContext";

export function usePluginRegistry() {
  const context = useContext(PluginRegistryContext);
  if (!context)
    throw new Error(
      "usePluginRegistry must be used within PluginRegistryProvider",
    );
  return context;
}
