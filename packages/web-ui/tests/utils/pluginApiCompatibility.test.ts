import {describe, expect, it} from 'vitest';
import {isPluginApiCompatible} from '@/utils/pluginApiCompatibility';
import {API_VERSION} from '@/pluginApiVersion';
import {readFileSync} from 'node:fs';

it('requires the native resource API for the updated Neon UI while retaining older plugins', () => {
    const manifest = JSON.parse(
        readFileSync('plugins/neon/.tabularium', 'utf8'),
    ) as {ui_extensions: {api_version: string}[]};
    for (const extension of manifest.ui_extensions) {
        expect(isPluginApiCompatible('0.2.0', extension.api_version)).toBe(false);
        expect(isPluginApiCompatible(API_VERSION, extension.api_version)).toBe(true);
    }
    expect(isPluginApiCompatible(API_VERSION, '0.2.0')).toBe(true);
    expect(isPluginApiCompatible(API_VERSION, '0.1.1')).toBe(true);
});

describe('pluginApiCompatibility', () => {
    it('should accept legacy declarations and compatible patch versions', () => {
        expect(isPluginApiCompatible('0.1.1')).toBe(true);
        expect(isPluginApiCompatible('0.1.1', '0.1.0')).toBe(true);
        expect(isPluginApiCompatible('0.1.1', '0.1.1')).toBe(true);
    });

    it('should reject newer, incompatible, and malformed API versions', () => {
        expect(isPluginApiCompatible('0.1.1', '0.1.2')).toBe(false);
        expect(isPluginApiCompatible('0.1.1', '0.2.0')).toBe(false);
        expect(isPluginApiCompatible('1.2.0', '2.0.0')).toBe(false);
        expect(isPluginApiCompatible('0.1.1', 'latest')).toBe(false);
    });

    it('should retain published API 0.1 bundles on the additive 0.2 host', () => {
        expect(isPluginApiCompatible('0.2.0', '0.1.0')).toBe(true);
        expect(isPluginApiCompatible('0.2.0', '0.1.1')).toBe(true);
        expect(isPluginApiCompatible('0.2.0', '0.1.2')).toBe(false);
        expect(isPluginApiCompatible('0.1.1', '0.2.0')).toBe(false);
        expect(isPluginApiCompatible('0.2.0', '0.2.0')).toBe(true);
        expect(isPluginApiCompatible('0.2.0', '0.2.1')).toBe(false);
        expect(isPluginApiCompatible('0.2.0', '0.3.0')).toBe(false);
    });

    it('should apply stable-major compatibility after version one', () => {
        expect(isPluginApiCompatible('1.3.0', '1.2.5')).toBe(true);
        expect(isPluginApiCompatible('1.2.0', '1.3.0')).toBe(false);
    });
});
