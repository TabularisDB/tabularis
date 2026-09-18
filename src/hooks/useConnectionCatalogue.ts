import { invoke } from '@tauri-apps/api/core';
import { useDrivers } from './useDrivers';
import { useSettings } from './useSettings';
import { createAsyncResource } from '../utils/asyncResource';
import { useEffect, useMemo, useSyncExternalStore } from 'react';

import type { RegistryPluginWithStatus } from '../types/plugins';
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
  /** Raw registry catalogue entries, e.g. for resolving a plugin's repo_url. */
  registry: RegistryPluginWithStatus[];
  refresh: () => void;
}

const catalogues = new Map<string, ReturnType<typeof createCatalogue>>();

function createCatalogue() {
  return createAsyncResource<RegistryPluginWithStatus[]>([], () => invoke("fetch_plugin_registry"));
}

export function useConnectionCatalogue(enabled = true): ConnectionCatalogue {
  const { settings } = useSettings();
  const { allDrivers: registered } = useDrivers();
  const registryKey = settings.tabulariumRegistryUrl ?? "default";
  const resource = useMemo(() => {
    let resource = catalogues.get(registryKey);
    if (!resource) {
      resource = createCatalogue();
      catalogues.set(registryKey, resource);
    }
    return resource;
  }, [registryKey]);
  const { data: registry, loading, error } = useSyncExternalStore(resource.subscribe, resource.getSnapshot);
  useEffect(() => {
    if (enabled) void resource.load();
  }, [enabled, resource]);

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
  const refresh = resource.refresh;

  return { groups, facets, loading: enabled && loading, registryOffline: error !== null, registry, refresh };
}
