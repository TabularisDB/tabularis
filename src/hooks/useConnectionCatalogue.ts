import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PluginManifest, RegistryPluginWithStatus } from "../types/plugins";
import {
  builtinToCatalogueDriver,
  groupByEngine,
  localPluginToCatalogueDriver,
  paradigmFacets,
  toCatalogueDriver,
  type EngineGroup,
  type ParadigmFacet,
} from "../utils/connectionCatalogue";
import {
  fetchPluginRegistry,
  invalidatePluginRegistryCache,
} from "../utils/pluginRegistryFetch";

const BUILTIN_META: Record<string, { engine: string; paradigms: string[] }> = {
  postgres: { engine: "postgres", paradigms: ["sql"] },
  mysql: { engine: "mysql", paradigms: ["sql"] },
  sqlite: { engine: "sqlite", paradigms: ["sql"] },
};

export interface ConnectionCatalogue {
  groups: EngineGroup[];
  facets: ParadigmFacet[];
  loading: boolean;
  registryOffline: boolean;
  /** Raw registry catalogue entries, e.g. for resolving a plugin's repo_url. */
  registry: RegistryPluginWithStatus[];
  refresh: () => void;
}

export function useConnectionCatalogue(): ConnectionCatalogue {
  const [registry, setRegistry] = useState<RegistryPluginWithStatus[]>([]);
  const [registered, setRegistered] = useState<PluginManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [registryOffline, setRegistryOffline] = useState(false);
  const [nonce, setNonce] = useState(0);
  const forceRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const force = forceRef.current;
    forceRef.current = false;
    void (async () => {
      // setLoading lives inside the async IIFE (not the synchronous effect body)
      // to avoid a cascading render on refresh() per .rules/react.md #2.
      setLoading(true);
      try {
        const drivers = await invoke<PluginManifest[]>("get_registered_drivers");
        if (!cancelled) setRegistered(drivers);
      } catch {
        /* built-ins always have a fallback in useDrivers; ignore here */
      }
      try {
        const cat = await fetchPluginRegistry({ force });
        if (!cancelled) {
          setRegistry(cat);
          setRegistryOffline(false);
        }
      } catch {
        if (!cancelled) setRegistryOffline(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const groups = useMemo(() => {
    const builtinDrivers = registered
      .filter((d) => d.is_builtin === true)
      .map((m) => {
        const meta = BUILTIN_META[m.id] ?? { engine: m.id, paradigms: [] };
        return builtinToCatalogueDriver(m, meta.engine, meta.paradigms);
      });
    const registryDrivers = registry
      // built-ins are represented from manifests above; skip any registry echo.
      // hasOwnProperty (not `in`) so plugin ids like "constructor"/"toString"
      // aren't matched against Object.prototype and wrongly hidden.
      .filter((p) => !Object.prototype.hasOwnProperty.call(BUILTIN_META, p.id))
      .map(toCatalogueDriver);
    // Locally-installed plugin drivers the registry doesn't list (e.g.
    // `just dev-install`ed, not yet published). Without this they load and
    // show as enabled but are unreachable in the connection picker. Registry
    // entries win on engine collision (they carry downloads/verified/updates).
    const registryEngines = new Set(registryDrivers.map((d) => d.engine));
    const localDrivers = registered
      .filter((d) => d.is_builtin !== true)
      .map(localPluginToCatalogueDriver)
      .filter((d) => !registryEngines.has(d.engine));
    return groupByEngine([...builtinDrivers, ...registryDrivers, ...localDrivers]);
  }, [registered, registry]);

  const facets = useMemo(() => paradigmFacets(groups), [groups]);
  const refresh = useCallback(() => {
    invalidatePluginRegistryCache();
    forceRef.current = true;
    setNonce((n) => n + 1);
  }, []);

  // Background force-install can land after this hook already cached a
  // "not installed" catalogue — invalidate so the next mount/open shows
  // the new plugin without waiting for the soft TTL.
  useEffect(() => {
    let mounted = true;
    let cleanup: (() => void) | null = null;
    listen("tabularis://plugin-activated", () => {
      if (!mounted) return;
      invalidatePluginRegistryCache();
      forceRef.current = true;
      setNonce((n) => n + 1);
    })
      .then((unlisten) => {
        if (mounted) {
          cleanup = unlisten;
        } else {
          unlisten();
        }
      })
      .catch((err) => {
        console.warn(
          "Failed to subscribe to tabularis://plugin-activated:",
          err,
        );
      });
    return () => {
      mounted = false;
      cleanup?.();
    };
  }, []);

  return { groups, facets, loading, registryOffline, registry, refresh };
}
