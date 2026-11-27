import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const pnpmCommand = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'pnpm';
const buildArguments =
    process.platform === 'win32'
        ? ['/d', '/s', '/c', 'pnpm --filter @tabularis/web-ui build']
        : ['--filter', '@tabularis/web-ui', 'build'];
const forwardedArguments = process.argv.slice(2);

const build = spawnSync(pnpmCommand, buildArguments, {
    cwd: rootDir,
    stdio: 'inherit',
});

if (build.error) {
    console.error(`Failed to start the Web UI build: ${build.error.message}`);
    process.exit(1);
}
if (build.status !== 0) {
    process.exit(build.status ?? 1);
}

const server = spawnSync(
    'cargo',
    [
        'run',
        '--manifest-path',
        'src-tauri/Cargo.toml',
        '--',
        'web',
        '--web-root',
        join(rootDir, 'packages/web-ui/dist'),
        ...forwardedArguments,
    ],
    {cwd: rootDir, stdio: 'inherit'},
);

if (server.error) {
    console.error(`Failed to start the Web server: ${server.error.message}`);
    process.exit(1);
}
process.exit(server.status ?? 1);
