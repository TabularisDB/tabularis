import type { PlatformCapabilities } from "./capabilities";

let activePlatformCapabilities: PlatformCapabilities | null = null;

export function registerActivePlatformCapabilities(
  capabilities: PlatformCapabilities,
): void {
  activePlatformCapabilities = capabilities;
}

export function getActivePlatformCapabilities(): PlatformCapabilities {
  if (!activePlatformCapabilities) {
    throw new Error("Platform capabilities have not been registered");
  }
  return activePlatformCapabilities;
}

export function writeActiveClipboard(text: string): Promise<void> {
  if (activePlatformCapabilities) {
    return activePlatformCapabilities.writeClipboard(text);
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return Promise.reject(new Error("Clipboard access is unavailable"));
}
