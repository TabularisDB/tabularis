import type { PluginManifest, RegistryPluginWithStatus } from '../types/plugins';

/** Flattened, UI-ready view of one driver (registry or built-in). */
export interface CatalogueDriver {
  slug: string;
  name: string;
  engine: string;
  paradigms: string[];
  verified: boolean;
  installed: boolean;
  installedVersion: string | null;
  latestVersion: string;
  isBuiltin: boolean;
  platformSupported: boolean;
  downloads: number | null;
  updateAvailable: boolean;
  icon: string | null;
  color: string | null;
}

export function toCatalogueDriver(p: RegistryPluginWithStatus): CatalogueDriver {
  const engine = p.engine && p.engine.length > 0 ? p.engine : p.id;
  return {
    slug: p.id,
    name: p.name,
    engine,
    paradigms: p.paradigms ?? [],
    verified: p.verified ?? false,
    installed: p.installed_version != null,
    installedVersion: p.installed_version ?? null,
    latestVersion: p.latest_version,
    isBuiltin: false,
    platformSupported: p.platform_supported,
    downloads: p.downloads ?? null,
    updateAvailable: p.update_available,
    icon: p.icon ?? null,
    color: null,
  };
}

/**
 * Build a catalogue entry for a locally-installed plugin driver that the
 * registry doesn't know about (e.g. a `just dev-install`ed plugin). These would
 * otherwise be invisible in the picker even though the driver is loaded.
 */
export function localPluginToCatalogueDriver(manifest: PluginManifest): CatalogueDriver {
  const engine =
    manifest.engine && manifest.engine.length > 0 ? manifest.engine : manifest.id;
  return {
    slug: manifest.id,
    name: manifest.name,
    engine,
    paradigms: manifest.paradigms ?? [],
    verified: false,
    installed: true,
    installedVersion: manifest.version,
    latestVersion: manifest.version,
    isBuiltin: false,
    platformSupported: true,
    downloads: null,
    updateAvailable: false,
    icon: manifest.icon ?? null,
    color: manifest.color ?? null,
  };
}

export function builtinToCatalogueDriver(
  manifest: PluginManifest,
  engine: string,
  paradigms: string[],
): CatalogueDriver {
  return {
    slug: manifest.id,
    name: manifest.name,
    engine,
    paradigms,
    verified: true,
    installed: true,
    installedVersion: manifest.version,
    latestVersion: manifest.version,
    isBuiltin: true,
    platformSupported: true,
    downloads: null,
    updateAvailable: false,
    icon: manifest.icon ?? null,
    color: manifest.color ?? null,
  };
}

export interface EngineGroup {
  engine: string;
  displayName: string;
  primaryParadigm: string;
  secondaryParadigms: string[];
  drivers: CatalogueDriver[];
  installed: boolean;
  verified: boolean;
  /** false when no driver in the group has an installable build for the current platform. */
  platformSupported: boolean;
  downloads: number | null;
}

export interface CatalogueFilter {
  search: string;
  paradigms: string[];
  verifiedOnly: boolean;
  installedOnly: boolean;
}

export interface ParadigmFacet {
  key: string;
  label: string;
  count: number;
}

export interface EngineSelection {
  mode: 'connect' | 'install' | 'pick-driver';
  driver?: CatalogueDriver;
}

export function groupByEngine(drivers: CatalogueDriver[]): EngineGroup[] {
  const map = new Map<string, CatalogueDriver[]>();
  for (const d of drivers) {
    const list = map.get(d.engine) ?? [];
    list.push(d);
    map.set(d.engine, list);
  }
  const groups: EngineGroup[] = [];
  for (const [engine, list] of map) {
    const representative = list.find((d) => d.paradigms.length > 0) ?? list[0];
    const primaryParadigm = representative.paradigms[0] ?? 'other';
    const allParadigms = new Set<string>();
    for (const d of list) for (const p of d.paradigms) allParadigms.add(p);
    allParadigms.delete(primaryParadigm);
    const downloads = list.reduce<number | null>(
      (acc, d) => (d.downloads == null ? acc : (acc ?? 0) + d.downloads),
      null,
    );
    groups.push({
      engine,
      displayName: representative.name,
      primaryParadigm,
      secondaryParadigms: [...allParadigms],
      drivers: list,
      installed: list.some((d) => d.installed),
      verified: list.some((d) => d.verified),
      platformSupported: list.some((d) => d.platformSupported),
      downloads,
    });
  }
  // Section order in the catalogue follows Map-insertion order over this list,
  // so the sort here drives it. Builtin engines (MySQL, PostgreSQL, SQLite)
  // come first — surfacing the SQL section first, the common case — and engines
  // with no paradigm metadata ('other', mostly legacy-registry plugins) sink to
  // the end so the catalogue doesn't lead with a wall of 'Other'. Everything
  // else is alphabetical.
  return groups.sort(
    (a, b) =>
      Number(b.drivers.some((d) => d.isBuiltin)) -
        Number(a.drivers.some((d) => d.isBuiltin)) ||
      Number(a.primaryParadigm === 'other') -
        Number(b.primaryParadigm === 'other') ||
      a.displayName.localeCompare(b.displayName),
  );
}

export function paradigmFacets(groups: EngineGroup[]): ParadigmFacet[] {
  const counts = new Map<string, number>();
  for (const g of groups) {
    const seen = new Set<string>([g.primaryParadigm, ...g.secondaryParadigms]);
    for (const p of seen) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: labelForParadigm(key), count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function labelForParadigm(key: string): string {
  if (key === 'sql') return 'SQL';
  if (key === 'nosql') return 'NoSQL';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function filterCatalogue(groups: EngineGroup[], f: CatalogueFilter): EngineGroup[] {
  const term = f.search.trim().toLowerCase();
  return groups.filter((g) => {
    if (term && !g.displayName.toLowerCase().includes(term) && !g.engine.toLowerCase().includes(term)) {
      return false;
    }
    if (f.paradigms.length > 0) {
      const groupParadigms = new Set([g.primaryParadigm, ...g.secondaryParadigms]);
      if (!f.paradigms.some((p) => groupParadigms.has(p))) return false;
    }
    if (f.verifiedOnly && !g.verified) return false;
    if (f.installedOnly && !g.installed) return false;
    return true;
  });
}

export function resolveEngineSelection(group: EngineGroup): EngineSelection {
  if (group.drivers.length === 0) return { mode: 'pick-driver' };
  if (group.drivers.length > 1) return { mode: 'pick-driver' };
  const driver = group.drivers[0];
  return driver.installed ? { mode: 'connect', driver } : { mode: 'install', driver };
}
