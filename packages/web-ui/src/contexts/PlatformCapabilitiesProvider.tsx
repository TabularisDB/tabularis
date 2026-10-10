import type { ReactNode } from "react";
import type { PlatformCapabilities } from "../platform/capabilities";
import { PlatformCapabilitiesContext } from "./PlatformCapabilitiesContext";

interface PlatformCapabilitiesProviderProps {
  children: ReactNode;
  capabilities: PlatformCapabilities;
}

export function PlatformCapabilitiesProvider({
  children,
  capabilities,
}: PlatformCapabilitiesProviderProps) {
  return (
    <PlatformCapabilitiesContext.Provider value={capabilities}>
      {children}
    </PlatformCapabilitiesContext.Provider>
  );
}
