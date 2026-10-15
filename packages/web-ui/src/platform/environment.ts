import { isTauri } from "@tauri-apps/api/core";
import type { PlatformEnvironment } from "./capabilities";

export type TauriRuntimeProbe = () => boolean;

/** The single runtime-host check used when application composition selects adapters. */
export function detectPlatformEnvironment(
  probe: TauriRuntimeProbe = isTauri,
): PlatformEnvironment {
  return probe() ? "tauri" : "browser";
}
