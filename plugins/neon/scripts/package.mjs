import {cp, readFile, writeFile, mkdir, mkdtemp, rm, rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, '.tabularium'), 'utf8'));
const temp = await mkdtemp(join(tmpdir(), 'tabularis-neon-package-'));
// Stage on the destination filesystem so the final rename also works across mount points.
const archiveStage = await mkdtemp(join(root, '.package-'));
const pendingArchive = join(archiveStage, 'bundle.zip');
try {
    for (const file of [
        'dist',
        'locales',
        '.tabularium',
        'README.md',
        'LICENSE',
        'assets',
        'package.json',
        'pnpm-lock.yaml',
    ])
        await cp(join(root, file), join(temp, file), {recursive: true});
    await mkdir(join(temp, 'ui'), {recursive: true});
    await cp(join(root, 'ui/dist'), join(temp, 'ui/dist'), {recursive: true});
    // A hoisted production tree preserves transitive resolution after ZIP extraction, without symlinks.
    const installed = spawnSync(
        process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
        [
            'install',
            '--ignore-workspace',
            '--prod',
            '--prefer-offline',
            '--frozen-lockfile',
            '--ignore-scripts',
            '--node-linker=hoisted',
        ],
        {cwd: temp, encoding: 'utf8', env: {...process.env, CI: 'true'}},
    );
    if (installed.status !== 0)
        throw new Error(
            `Production dependency staging failed: ${installed.stderr || installed.stdout}`,
        );
    await writeFile(join(temp, 'package.json'), JSON.stringify({type: 'module'}) + '\n');
    await rm(join(temp, 'pnpm-lock.yaml'), {force: true});
    const archive = join(root, `neon-${manifest.version}-${process.platform}-${process.arch}.zip`);
    // All runtime dependencies are now regular files inside this staging directory.
    const result = spawnSync('zip', ['-qr', pendingArchive, '.'], {cwd: temp, encoding: 'utf8'});
    if (result.status !== 0) throw new Error('ZIP creation failed; install zip and retry');
    await rename(pendingArchive, archive);
    console.log(`Plugin archive created: ${archive} (Node.js 22+ required on destination)`);
} finally {
    await rm(temp, {recursive: true, force: true});
    await rm(archiveStage, {recursive: true, force: true});
}
