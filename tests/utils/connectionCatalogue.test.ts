import { describe, it, expect } from 'vitest';
import {
  toCatalogueDriver,
  builtinToCatalogueDriver,
  localPluginToCatalogueDriver,
  groupByEngine,
  paradigmFacets,
  filterCatalogue,
  resolveEngineSelection,
} from '../../src/utils/connectionCatalogue';
import type { RegistryPluginWithStatus, PluginManifest } from '../../src/types/plugins';

const registryPlugin = (over: Partial<RegistryPluginWithStatus> = {}): RegistryPluginWithStatus => ({
  id: 'firestore',
  name: 'Firestore',
  description: '',
  author: '',
  homepage: '',
  latest_version: '1.2.0',
  releases: [],
  installed_version: null,
  update_available: false,
  platform_supported: true,
  engine: 'firestore',
  paradigms: ['document'],
  verified: true,
  downloads: 42,
  ...over,
});

describe('connectionCatalogue', () => {
  describe('toCatalogueDriver', () => {
    it('maps a registry plugin to a catalogue driver', () => {
      const d = toCatalogueDriver(registryPlugin());
      expect(d).toMatchObject({
        slug: 'firestore',
        engine: 'firestore',
        paradigms: ['document'],
        verified: true,
        installed: false,
        installedVersion: null,
        latestVersion: '1.2.0',
        isBuiltin: false,
        platformSupported: true,
        downloads: 42,
      });
    });

    it('falls back to the slug as engine when engine is missing', () => {
      const d = toCatalogueDriver(registryPlugin({ engine: null, paradigms: [] }));
      expect(d.engine).toBe('firestore');
      expect(d.paradigms).toEqual([]);
    });

    it('marks installed when installed_version is set', () => {
      const d = toCatalogueDriver(registryPlugin({ installed_version: '1.1.0' }));
      expect(d.installed).toBe(true);
      expect(d.installedVersion).toBe('1.1.0');
    });
  });

  describe('builtinToCatalogueDriver', () => {
    it('maps a built-in manifest as installed + verified', () => {
      const manifest = {
        id: 'postgres',
        name: 'PostgreSQL',
        version: '1.0.0',
        description: '',
        default_port: 5432,
        is_builtin: true,
        capabilities: {} as PluginManifest['capabilities'],
      } as PluginManifest;
      const d = builtinToCatalogueDriver(manifest, 'postgres', ['sql']);
      expect(d).toMatchObject({
        slug: 'postgres',
        engine: 'postgres',
        paradigms: ['sql'],
        verified: true,
        installed: true,
        isBuiltin: true,
        platformSupported: true,
      });
    });
  });

  describe('localPluginToCatalogueDriver', () => {
    it('maps a locally-installed plugin as installed, unverified, non-builtin', () => {
      const manifest = {
        id: 'meilisearch',
        name: 'Meilisearch',
        version: '0.1.0',
        description: '',
        default_port: 7700,
        is_builtin: false,
        engine: 'meilisearch',
        paradigms: ['search', 'document', 'vector'],
        capabilities: {} as PluginManifest['capabilities'],
      } as PluginManifest;
      const d = localPluginToCatalogueDriver(manifest);
      expect(d).toMatchObject({
        slug: 'meilisearch',
        engine: 'meilisearch',
        paradigms: ['search', 'document', 'vector'],
        verified: false,
        installed: true,
        isBuiltin: false,
        installedVersion: '0.1.0',
      });
      // It groups under its primary paradigm ('search'), not 'other'.
      expect(groupByEngine([d])[0].primaryParadigm).toBe('search');
    });

    it('falls back to the plugin id when engine is absent', () => {
      const manifest = {
        id: 'acme',
        name: 'Acme',
        version: '0.1.0',
        description: '',
        default_port: null,
        is_builtin: false,
        capabilities: {} as PluginManifest['capabilities'],
      } as PluginManifest;
      expect(localPluginToCatalogueDriver(manifest).engine).toBe('acme');
    });
  });

  describe('groupByEngine', () => {
    it('collapses drivers sharing an engine into one group', () => {
      const a = toCatalogueDriver(registryPlugin({ id: 'firestore-a', engine: 'firestore', paradigms: ['document'] }));
      const b = toCatalogueDriver(registryPlugin({ id: 'firestore-b', engine: 'firestore', paradigms: ['document', 'vector'], verified: false }));
      const groups = groupByEngine([a, b]);
      expect(groups).toHaveLength(1);
      expect(groups[0].engine).toBe('firestore');
      expect(groups[0].drivers).toHaveLength(2);
      expect(groups[0].verified).toBe(true); // any driver verified
      expect(groups[0].primaryParadigm).toBe('document');
      expect(groups[0].secondaryParadigms).toContain('vector');
    });

    it('uses "other" as primary paradigm when none declared', () => {
      const d = toCatalogueDriver(registryPlugin({ id: 'weird', engine: 'weird', paradigms: [] }));
      const groups = groupByEngine([d]);
      expect(groups[0].primaryParadigm).toBe('other');
    });
  });

  describe('paradigmFacets', () => {
    it('counts engines per paradigm, multi-model counted in each', () => {
      const groups = groupByEngine([
        toCatalogueDriver(registryPlugin({ id: 'pg', engine: 'postgres', paradigms: ['sql'] })),
        toCatalogueDriver(registryPlugin({ id: 'surreal', engine: 'surreal', paradigms: ['document', 'graph'] })),
      ]);
      const facets = paradigmFacets(groups);
      const byKey = Object.fromEntries(facets.map((f) => [f.key, f.count]));
      expect(byKey.sql).toBe(1);
      expect(byKey.document).toBe(1);
      expect(byKey.graph).toBe(1);
    });
  });

  describe('filterCatalogue', () => {
    const groups = () => groupByEngine([
      toCatalogueDriver(registryPlugin({ id: 'pg', name: 'PostgreSQL', engine: 'postgres', paradigms: ['sql'], verified: true, installed_version: '1.0.0' })),
      toCatalogueDriver(registryPlugin({ id: 'qdrant', name: 'Qdrant', engine: 'qdrant', paradigms: ['vector'], verified: false })),
    ]);

    it('matches search against name and engine', () => {
      expect(filterCatalogue(groups(), { search: 'qdr', paradigms: [], verifiedOnly: false, installedOnly: false })).toHaveLength(1);
    });

    it('filters by paradigm (OR)', () => {
      const r = filterCatalogue(groups(), { search: '', paradigms: ['vector'], verifiedOnly: false, installedOnly: false });
      expect(r.map((g) => g.engine)).toEqual(['qdrant']);
    });

    it('filters by verified and installed toggles', () => {
      const v = filterCatalogue(groups(), { search: '', paradigms: [], verifiedOnly: true, installedOnly: false });
      expect(v.map((g) => g.engine)).toEqual(['postgres']);
      const i = filterCatalogue(groups(), { search: '', paradigms: [], verifiedOnly: false, installedOnly: true });
      expect(i.map((g) => g.engine)).toEqual(['postgres']);
    });
  });

  describe('resolveEngineSelection', () => {
    const grp = (drivers: ReturnType<typeof toCatalogueDriver>[]) => groupByEngine(drivers)[0];

    it('connects directly when one installed driver', () => {
      const g = grp([toCatalogueDriver(registryPlugin({ id: 'pg', engine: 'postgres', installed_version: '1.0.0' }))]);
      expect(resolveEngineSelection(g)).toEqual({ mode: 'connect', driver: g.drivers[0] });
    });

    it('asks to install when one driver, not installed', () => {
      const g = grp([toCatalogueDriver(registryPlugin({ id: 'pg', engine: 'postgres' }))]);
      expect(resolveEngineSelection(g)).toEqual({ mode: 'install', driver: g.drivers[0] });
    });

    it('asks to pick when multiple drivers', () => {
      const g = grp([
        toCatalogueDriver(registryPlugin({ id: 'fs-a', engine: 'firestore' })),
        toCatalogueDriver(registryPlugin({ id: 'fs-b', engine: 'firestore' })),
      ]);
      expect(resolveEngineSelection(g)).toEqual({ mode: 'pick-driver' });
    });
  });
});
