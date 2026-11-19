import {describe, expect, it} from 'vitest';
import {removedPluginKey, withoutRemovedPlugins} from '@/utils/pluginRemoval';
import type {RegistryPluginWithStatus} from '@/types/plugins';

const entry = (overrides: Partial<RegistryPluginWithStatus>): RegistryPluginWithStatus => ({
    id: 'csv',
    name: 'CSV',
    description: '',
    author: '',
    homepage: '',
    installed_version: '1.0.0',
    latest_version: '2.0.0',
    update_available: true,
    platform_supported: true,
    releases: [],
    ...overrides,
});

describe('pluginRemoval', () => {
    describe('removedPluginKey', () => {
        it('keeps kinds apart so a theme and a driver can share an id', () => {
            expect(removedPluginKey('driver', 'ayu')).not.toBe(removedPluginKey('theme', 'ayu'));
        });
    });

    describe('withoutRemovedPlugins', () => {
        it('returns the registry untouched when nothing was removed', () => {
            const registry = [entry({})];
            expect(withoutRemovedPlugins(registry, new Set(), [])).toBe(registry);
        });

        it('clears the installed version and the update of a removed driver', () => {
            const other = entry({id: 'redis'});
            const [csv, redis] = withoutRemovedPlugins(
                [entry({}), other],
                new Set([removedPluginKey('driver', 'csv')]),
                [{id: 'redis'}],
            );
            expect(csv).toMatchObject({installed_version: null, update_available: false});
            expect(csv.latest_version).toBe('2.0.0');
            expect(redis).toBe(other);
        });

        it('treats entries without a kind, and cloud packages, as drivers', () => {
            const removed = new Set([removedPluginKey('driver', 'csv')]);
            for (const kind of [undefined, 'driver', 'cloud'])
                expect(
                    withoutRemovedPlugins([entry({kind})], removed, [])[0].installed_version,
                ).toBeNull();
        });

        it('only drops the kind that was removed', () => {
            const theme = entry({id: 'ayu', kind: 'theme'});
            const driver = entry({id: 'ayu'});
            const result = withoutRemovedPlugins(
                [theme, driver],
                new Set([removedPluginKey('theme', 'ayu')]),
                [],
            );
            expect(result[0].installed_version).toBeNull();
            expect(result[1]).toBe(driver);
        });

        it('keeps the registry claim for a driver that is on disk again', () => {
            const csv = entry({});
            expect(
                withoutRemovedPlugins([csv], new Set([removedPluginKey('driver', 'csv')]), [
                    {id: 'csv'},
                ])[0],
            ).toBe(csv);
        });

        it('leaves a removed package the registry already reports as not installed', () => {
            const csv = entry({installed_version: null, update_available: false});
            expect(
                withoutRemovedPlugins([csv], new Set([removedPluginKey('driver', 'csv')]), [])[0],
            ).toBe(csv);
        });

        it('drops removed AI providers too', () => {
            const provider = entry({id: 'community-ai', kind: 'ai-assistant'});
            expect(
                withoutRemovedPlugins(
                    [provider],
                    new Set([removedPluginKey('ai-assistant', 'community-ai')]),
                    [],
                )[0].installed_version,
            ).toBeNull();
        });
    });
});
