import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

for (const layout of ['squashfs-root/usr', 'AppDir']) {
    test(`verifies ${layout} assets and rejects a missing executable`, () => {
        const fixture = mkdtempSync(path.join(tmpdir(), 'tabularis-package-'));
        try {
            const scripts = path.join(fixture, 'scripts/web');
            const source = path.join(fixture, 'packages/web-ui/dist');
            const payload = path.join(fixture, 'payload', layout);
            const web = path.join(payload, 'lib/tabularis/web-ui');
            for (const dir of [
                scripts,
                source,
                web,
                path.join(web, 'assets'),
                path.join(payload, 'bin'),
            ]) {
                mkdirSync(dir, {recursive: true});
            }
            const script = path.join(scripts, 'verify-linux-web-package.sh');
            cpSync(path.join(root, 'scripts/web/verify-linux-web-package.sh'), script);
            writeFileSync(path.join(source, 'index.html'), 'packaged index');
            writeFileSync(path.join(web, 'index.html'), 'packaged index');
            writeFileSync(path.join(web, 'assets/app.js'), 'app');
            const binary = path.join(payload, 'bin/tabularis');
            writeFileSync(binary, '#!/bin/sh\nexit 0\n', {mode: 0o755});
            const artifact = path.join(fixture, 'fixture.AppImage');
            writeFileSync(artifact, '#!/bin/sh\ncp -R "$PACKAGE_FIXTURE"/* .\n', {mode: 0o755});
            const run = () =>
                spawnSync('bash', [script, 'assets', artifact], {
                    encoding: 'utf8',
                    env: {...process.env, PACKAGE_FIXTURE: path.join(fixture, 'payload')},
                });
            const valid = run();
            assert.equal(valid.status, 0, valid.stderr);
            rmSync(binary);
            const missing = run();
            assert.notEqual(missing.status, 0);
            assert.match(missing.stderr, /Packaged Tabularis executable is missing/);
        } finally {
            rmSync(fixture, {recursive: true, force: true});
        }
    });
}
