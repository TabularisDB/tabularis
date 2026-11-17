import {describe, expect, it} from 'vitest';
import {normalizeWebBasePath, webPath} from '@/utils/webBasePath';

describe('normalizeWebBasePath', () => {
    it.each([
        ['', '/'],
        ['/', '/'],
        ['/tabularis', '/tabularis/'],
        ['/tools/database/', '/tools/database/'],
    ])('normalizes %j to %j', (input, expected) => {
        expect(normalizeWebBasePath(input)).toBe(expected);
    });

    it.each([
        'relative',
        '//example.com',
        'https://example.com',
        '/a?b',
        '/a#b',
        '/a/../b',
        '/./',
        '/a//b',
        '/a%2fb',
        '/a\\b',
    ])('rejects %j', (input) => {
        expect(() => normalizeWebBasePath(input)).toThrow('TABULARIS_BASE_PATH');
    });
});

describe('webPath', () => {
    it('keeps root deployments unchanged', () => {
        expect(webPath('/api/v1/session', '/')).toBe('/api/v1/session');
    });

    it('prefixes nested routes without changing query strings or encoded identifiers', () => {
        expect(webPath('/connections?connect=team%2Fdb#details', '/tools/database/')).toBe(
            '/tools/database/connections?connect=team%2Fdb#details',
        );
        expect(webPath('logo.svg', '/tools/database')).toBe('/tools/database/logo.svg');
        expect(webPath('/', '/tools/database')).toBe('/tools/database/');
    });
});

it('uses the trusted runtime meta for every URL boundary', async () => {
    const {runtimeWebBasePath, webPath} = await import('@/utils/webBasePath');
    const meta = document.createElement('meta');
    meta.name = 'tabularis-public-base';
    document.head.append(meta);
    try {
        for (const prefix of ['/', '/workspaces/a/', '/workspaces/b/']) {
            meta.content = prefix;
            expect(runtimeWebBasePath()).toBe(prefix);
            expect(webPath('/api/v1/session')).toBe(`${prefix}api/v1/session`);
            expect(webPath('/api/v1/assets/plugins/demo/index.js')).toBe(
                `${prefix}api/v1/assets/plugins/demo/index.js`,
            );
        }
        meta.content = '//evil.example/';
        expect(() => runtimeWebBasePath()).toThrow();
    } finally {
        meta.remove();
    }
});
