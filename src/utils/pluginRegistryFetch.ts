import { invoke } from "@tauri-apps/api/core";

import type { RegistryPluginWithStatus } from "../types/plugins";

/** Frontend soft TTL — backend also caches; this mainly avoids thrashing. */
const FRONTEND_TTL_MS = 15 * 60 * 1000;

let memoryCache: {
  data: RegistryPluginWithStatus[];
  at: number;
} | null = null;

/** In-flight request shared by concurrent catalogue mounts. */
let inflight: Promise<RegistryPluginWithStatus[]> | null = null;
/** Whether the current inflight request is a forced network refresh. */
let inflightForce = false;

/**
 * Fetch the plugin registry catalogue.
 * Default: return process cache / coalesce concurrent calls.
 * `force: true`: bypass caches and re-hit the network (Settings Refresh,
 * post-install, etc.). Concurrent force calls still share one invoke.
 */
export async function fetchPluginRegistry(options?: {
  force?: boolean;
}): Promise<RegistryPluginWithStatus[]> {
  const force = options?.force === true;

  if (
    !force &&
    memoryCache &&
    Date.now() - memoryCache.at < FRONTEND_TTL_MS
  ) {
    return memoryCache.data;
  }

  // Soft callers may join any in-flight fetch. Force callers only join an
  // in-flight force (joining a soft fetch after install would keep stale
  // install flags).
  if (inflight && (!force || inflightForce)) {
    return inflight;
  }

  const request = invoke<RegistryPluginWithStatus[]>("fetch_plugin_registry", {
    force,
  })
    .then((data) => {
      memoryCache = { data, at: Date.now() };
      return data;
    })
    .finally(() => {
      if (inflight === request) {
        inflight = null;
        inflightForce = false;
      }
    });

  inflight = request;
  inflightForce = force;
  return request;
}

/** Drop the frontend cache (e.g. after install when callers force-refresh). */
export function invalidatePluginRegistryCache(): void {
  memoryCache = null;
}
