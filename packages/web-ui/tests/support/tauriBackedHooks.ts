/**
 * Hook replacements for tests written against the Tauri APIs.
 *
 * `vi.mock("<src>/hooks/useTabularisClient", () => import("<tests>/support/tauriBackedHooks"))`
 * (and likewise for `usePlatformCapabilities`) routes the component's client and
 * platform calls through the `@tauri-apps/*` mocks from `tests/setup.ts`, so
 * assertions on `invoke`, `listen` or `openUrl` keep describing the desktop
 * transport without mounting the real providers.
 */
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { TauriPlatformCapabilities } from "../../src/platform/tauriCapabilities";
import type { TabularisClient } from "../../src/api/client";

function forward(command: string, request: unknown) {
  return request === undefined
    ? invoke(command)
    : invoke(command, request as Record<string, unknown>);
}

export const tauriBackedClient = {
  call: forward,
  callUnmigrated: forward,
  subscribe: (event: string, handler: (payload: unknown) => void) =>
    listen(event, ({ payload }) => handler(payload)),
  emit: (event: string, payload: unknown) => emit(event, payload),
  readPluginAsset: (pluginId: string, filePath: string) =>
    invoke("read_plugin_file", { pluginId, filePath }),
} as unknown as TabularisClient;

const platform = new TauriPlatformCapabilities();

export function useTabularisClient() {
  return tauriBackedClient;
}

export function usePlatformCapabilities() {
  return platform;
}
