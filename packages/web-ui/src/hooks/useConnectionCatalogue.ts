import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { PluginManifest, RegistryPluginWithStatus } from '../types/plugins';
import {
  builtinToCatalogueDriver,
  groupByEngine,
  localPluginToCatalogueDriver,
  paradigmFacets,
  toCatalogueDriver,
  type EngineGroup,
  type ParadigmFacet,
} from '../utils/connectionCatalogue';

const BUILTIN_META: Record<string, { engine: string; paradigms: string[] }> = {
  postgres: { engine: 'postgres', paradigms: ['sql'] },
  mysql: { engine: 'mysql', paradigms: ['sql'] },
  sqlite: { engine: 'sqlite', paradigms: ['sql'] },
};

export interface ConnectionCatalogue {
  groups: EngineGroup[];
  facets: ParadigmFacet[];
  loading: boolean;
  registryOffline: boolean;
  refresh: () => void;
}

export function useConnectionCatalogue(): ConnectionCatalogue {
  const [registry, setRegistry] = useState<RegistryPluginWithStatus[]>([]);
  const [registered, setRegistered] = useState<PluginManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [registryOffline, setRegistryOffline] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // setLoading lives inside the async IIFE (not the synchronous effect body)
      // to avoid a cascading render on refresh() per .rules/react.md #2.
      setLoading(true);
      try {
        const drivers = await invoke<PluginManifest[]>('get_registered_drivers');
        if (!cancelled) setRegistered(drivers);
      } catch {
        /* built-ins always have a fallback in useDrivers; ignore here */
      }
      try {
        const cat = await invoke<RegistryPluginWithStatus[]>('fetch_plugin_registry');
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
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return { groups, facets, loading, registryOffline, refresh };
}
