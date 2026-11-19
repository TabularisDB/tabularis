import {expect, it, vi} from 'vitest';
import type {NativeThemeContribution} from '@/types/themeCatalog';
import {resolveNativeCatalog} from '@/utils/themeCatalog';
import {parseThemePackageManifest} from '@/utils/themePackageValidation';

it('resolves installed themes and validates manifests without dynamic code evaluation', () => {
    const installed: NativeThemeContribution = {
        id: `theme:${'a'.repeat(64)}:fixture:dark`,
        name: 'Fixture Dark',
        mode: 'dark',
        revision: '1',
        source: '{"schemaVersion":1,"mode":"dark","colors":{"accent":{"primary":"#ff82b1"}}}',
        format: 'v1',
        readOnly: true,
        available: true,
        origin: {
            kind: 'installed',
            identity: {registryKey: 'a'.repeat(64), packageName: 'fixture', variantId: 'dark'},
            packageVersion: '1.0.0',
        },
    };
    const manifestJson = JSON.stringify({
        id: 'fixture',
        name: 'Fixture',
        version: '1.0.0',
        kind: 'theme',
        min_runtime_version: '0.26.0',
        theme_schema_version: 1,
        theme_variants: [{id: 'dark', name: 'Dark', file: 'themes/dark.json'}],
    });

    vi.stubGlobal('Function', function blockedFunction() {
        throw new EvalError('Dynamic code evaluation is blocked by CSP');
    });
    let catalog;
    let manifest;
    try {
        catalog = resolveNativeCatalog({themes: [installed], issues: []});
        manifest = parseThemePackageManifest(manifestJson);
    } finally {
        vi.unstubAllGlobals();
    }

    expect(catalog.issues).toEqual([]);
    expect(catalog.themes[0]?.resolved.theme.colors.accent.primary).toBe('#ff82b1');
    expect(manifest.id).toBe('fixture');
});
