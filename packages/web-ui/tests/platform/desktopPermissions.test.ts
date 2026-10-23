import {readFileSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

interface Capability {
    windows: string[];
    permissions: Array<string | {identifier: string}>;
    remote?: unknown;
}

const directory = resolve(import.meta.dirname, '../../../../src-tauri/capabilities');
const capabilities = readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(resolve(directory, name), 'utf8')) as Capability);

function grants(permission: string) {
    return capabilities.filter((capability) =>
        capability.permissions.some(
            (entry) => (typeof entry === 'string' ? entry : entry.identifier) === permission,
        ),
    );
}

describe('desktop platform ACL', () => {
    it('allows editor and result windows to create the secondary webview windows', () => {
        const allowed = grants('core:webview:allow-create-webview-window');
        for (const window of ['main', 'connection-window-*', 'results-window-*']) {
            expect(allowed.flatMap((capability) => capability.windows)).toContain(window);
        }
        expect(allowed.every((capability) => !capability.remote)).toBe(true);
        expect(allowed.flatMap((capability) => capability.windows)).not.toContain('*');
    });

    it('allows binary and UTF-8 exports from detached editors, results, and diagrams without adding filesystem scopes', () => {
        const allowed = grants('fs:allow-write-file');
        for (const window of ['main', 'connection-window-*', 'results-window-*', 'er-diagram*']) {
            expect(allowed.flatMap((capability) => capability.windows)).toContain(window);
        }
        for (const capability of allowed) {
            expect(capability.permissions).toEqual(['fs:allow-write-file']);
            expect(capability.remote).toBeUndefined();
            expect(capability.windows).not.toContain('*');
        }
    });
});
