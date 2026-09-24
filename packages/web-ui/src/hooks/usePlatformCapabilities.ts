import { useContext } from "react";
import { PlatformCapabilitiesContext } from "../contexts/PlatformCapabilitiesContext";

export function usePlatformCapabilities() {
  const capabilities = useContext(PlatformCapabilitiesContext);

  if (!capabilities) {
    throw new Error(
      "usePlatformCapabilities must be used within PlatformCapabilitiesProvider",
    );
  }

  return capabilities;
}
