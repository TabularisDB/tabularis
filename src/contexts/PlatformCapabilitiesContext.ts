import { createContext } from "react";
import type { PlatformCapabilities } from "../platform/capabilities";

export const PlatformCapabilitiesContext =
  createContext<PlatformCapabilities | null>(null);
