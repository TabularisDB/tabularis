import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, copyFile, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {unzipSync, strFromU8} from 'fflate';

test('release packaging replaces old archives and excludes local credentials', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neon-package-test-'));
    const workspace = await mkdtemp(
        join(fileURLToPath(new URL('../', import.meta.url)), '.package-test-workspace-'),
    );
    await writeFile(
        join(workspace, 'package.json'),
        JSON.stringify({private: true, packageManager: 'pnpm@10.30.3'}),
    );
    await writeFile(join(workspace, 'pnpm-workspace.yaml'), 'packages: []\n');
    try {
        for (const dir of ['scripts', 'dist', 'locales', 'ui/dist', 'node_modules', 'assets'])
            await mkdir(join(root, dir), {recursive: true});
        await copyFile(
            new URL('../scripts/package.mjs', import.meta.url),
            join(root, 'scripts/package.mjs'),
        );
        await writeFile(join(root, '.tabularium'), JSON.stringify({id: 'neon', version: '0.2.0'}));
        await writeFile(
            join(root, 'package.json'),
            JSON.stringify({type: 'module', packageManager: 'pnpm@10.30.3'}),
        );
        await writeFile(
            join(root, 'pnpm-lock.yaml'),
            "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n",
        );
        for (const file of [
            'dist/driver.js',
            'ui/dist/index.js',
            'README.md',
            'LICENSE',
            'assets/icon.svg',
        ])
            await writeFile(join(root, file), 'public release fixture');
        await writeFile(join(root, '.env.local'), 'DO_NOT_PUBLISH=secret');
        await writeFile(join(root, 'obsolete-secret.txt'), 'obsolete');
        const name = `neon-0.2.0-${process.platform}-${process.arch}.zip`;
        assert.equal(spawnSync('zip', ['-q', name, 'obsolete-secret.txt'], {cwd: root}).status, 0);
        const archiveTempRoot = workspace;
        const packaged = spawnSync(process.execPath, [join(root, 'scripts/package.mjs')], {
            encoding: 'utf8',
            env: {
                ...process.env,
                TMPDIR: archiveTempRoot,
                TMP: archiveTempRoot,
                TEMP: archiveTempRoot,
            },
        });
        assert.equal(packaged.status, 0, packaged.stderr);
        const files = unzipSync(new Uint8Array(await readFile(join(root, name))));
        assert(!files['obsolete-secret.txt'], 'Old archive members must not survive');
        assert(!files['.env.local'], 'Local credentials must not be packaged');
        assert(files['dist/driver.js']);
        assert(files['ui/dist/index.js']);
        assert.equal(strFromU8(files['LICENSE']), 'public release fixture');
    } finally {
        await rm(root, {recursive: true, force: true});
        await rm(workspace, {recursive: true, force: true});
    }
});
