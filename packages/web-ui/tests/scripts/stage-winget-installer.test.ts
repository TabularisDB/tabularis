import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
// Release scripts run directly in Node and do not participate in the app build.
// @ts-expect-error JavaScript release script has no declaration file.
import {stageWingetInstaller} from '../../../../scripts/stage-winget-installer.mjs';

const directories: string[] = [];
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'tabularis-winget-'));
    directories.push(root);
    const nsis = join(root, 'src-tauri/target/release/bundle/nsis');
    mkdirSync(nsis, {recursive: true});
    return {root, nsis};
}
afterEach(() => {
    for (const root of directories.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('WinGet release installer', () => {
    it('stages only the requested version and leaves the original bundle intact', () => {
        const {root, nsis} = fixture();
        writeFileSync(join(nsis, 'tabularis_0.27.0_x64-setup.exe'), 'managed build');
        writeFileSync(join(nsis, 'tabularis_0.26.0_x64-setup.exe'), 'old build');
        const asset = stageWingetInstaller('v0.27.0', root);
        expect(asset).toBe('tabularis_0.27.0_winget_x64-setup.exe');
        expect(readFileSync(join(root, asset), 'utf8')).toBe('managed build');
        expect(readFileSync(join(nsis, 'tabularis_0.27.0_x64-setup.exe'), 'utf8')).toBe(
            'managed build',
        );
        const workflow = readFileSync(resolve('.github/workflows/winget.yml'), 'utf8');
        const pattern = workflow.match(/installers-regex: '([^']+)'/)?.[1];
        expect(pattern).toBeDefined();
        const regex = new RegExp(pattern!);
        expect(regex.test(asset)).toBe(true);
        expect(regex.test('tabularis_0.27.0_x64-setup.exe')).toBe(false);
        expect(regex.test('tabularis_0.27.0_x64-portable.exe')).toBe(false);
    });

    it('fails instead of uploading an installer from another version', () => {
        const {root, nsis} = fixture();
        writeFileSync(join(nsis, 'tabularis_0.26.0_x64-setup.exe'), 'old build');
        expect(() => stageWingetInstaller('v0.27.0', root)).toThrow();
        expect(existsSync(join(root, 'tabularis_0.27.0_winget_x64-setup.exe'))).toBe(false);
    });

    it.each([undefined, 'v0.27.0-beta.1', '0.27.0', '../installer', 'v0.27'])(
        'rejects an invalid or prerelease tag %s before copying',
        (tag) => {
            const {root} = fixture();
            expect(() => stageWingetInstaller(tag, root)).toThrow('Expected a stable release tag');
        },
    );
});
