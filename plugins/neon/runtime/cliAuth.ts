import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {open} from 'node:fs/promises';
import {constants, existsSync, readFileSync} from 'node:fs';
import {delimiter, isAbsolute, join} from 'node:path';
import type {Params} from './database.js';

export const cliSetupMethods = new Set([
    'account_cli_status',
    'account_cli_use',
    'account_cli_login_start',
    'account_cli_login_poll',
    'account_cli_login_cancel',
]);
const commandTimeout = 12000;
const loginLifetime = 5 * 60 * 1000;
const outputLimit = 128 * 1024;
interface Profile {
    name: string;
    auth: string;
    storage: string;
    file: string;
    credentials: string;
}
interface LoginResult {
    id: string;
    status: 'waiting' | 'complete' | 'failed';
    browserOpened: boolean;
    authUrl?: string;
    profile?: string;
    error?: string;
}
interface LoginJob {
    result: LoginResult;
    child: ChildProcessWithoutNullStreams;
    timer: NodeJS.Timeout;
    expires: number;
}
let job: LoginJob | undefined;

function profileName(value: unknown = 'DEFAULT'): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value))
        throw new Error('Invalid Neon CLI profile');
    return value;
}

function childEnvironment(): NodeJS.ProcessEnv {
    const env = {
        ...process.env,
        NO_COLOR: '1',
        CI: 'true',
        NEON_API_HOST: 'https://console.neon.tech/api/v2',
        NEON_OAUTH_HOST: 'https://oauth2.neon.tech',
    };
    // Account selection must come only from the explicitly linked profile.
    for (const key of [
        'NEON_API_KEY',
        'NEON_PROFILE',
        'NEONCTL_API_KEY',
        'NEONCTL_PROFILE',
        'NODE_OPTIONS',
        'NODE_DEBUG',
        'DEBUG',
    ])
        delete (env as NodeJS.ProcessEnv)[key];
    if (process.platform === 'linux') {
        // xdg-open otherwise chooses the desktop's handler even when BROWSER is set.
        Object.assign(env, {
            XDG_CURRENT_DESKTOP: 'X-Generic',
            BROWSER: '/bin/true',
            DISPLAY: '',
            WAYLAND_DISPLAY: '',
            XDG_RUNTIME_DIR: '',
        });
    }
    return env;
}

function launch(args: string[]): ChildProcessWithoutNullStreams {
    const env = childEnvironment();
    // Only an explicit login action may run interactive auth; probes and refresh stay noninteractive.
    if (args[0] === 'login') env.CI = 'false';
    const options = {shell: false, windowsHide: true, env, stdio: 'pipe' as const};
    if (process.platform === 'win32') {
        for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
            const binary = join(directory, 'neon.exe');
            if (existsSync(binary)) return spawn(binary, [...args, '--no-analytics'], options);
            // npm's .cmd shim needs a shell. Invoke the package's advertised CLI entry with Node instead.
            if (!existsSync(join(directory, 'neon.cmd'))) continue;
            const packageDirectory = join(directory, 'node_modules', 'neon');
            try {
                const metadata: unknown = JSON.parse(
                    readFileSync(join(packageDirectory, 'package.json'), 'utf8'),
                );
                if (!metadata || typeof metadata !== 'object') continue;
                const pkg = metadata as {name?: string; bin?: {neon?: string}};
                const entry = join(packageDirectory, 'dist', 'cli.js');
                if (pkg.name === 'neon' && pkg.bin?.neon === 'dist/cli.js' && existsSync(entry))
                    return spawn(process.execPath, [entry, ...args, '--no-analytics'], options);
            } catch {
                /* A different installation may be available later in PATH. */
            }
        }
    }
    return spawn('neon', [...args, '--no-analytics'], options);
}

function kill(child: ChildProcessWithoutNullStreams): void {
    child.kill('SIGTERM');
    const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
    }, 1000);
    timer.unref();
}

async function run(
    args: string[],
    timeout = 2000,
): Promise<{ok: boolean; output: string; missing: boolean}> {
    return new Promise((resolve) => {
        const child = launch(args);
        child.stdin.end();
        let output = '';
        let bytes = 0;
        let finished = false;
        const finish = (ok: boolean, missing = false) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            resolve({ok, output: ok ? output : '', missing});
        };
        const timer = setTimeout(() => {
            kill(child);
            finish(false);
        }, timeout);
        for (const stream of [child.stdout, child.stderr])
            stream.on('data', (chunk: Buffer) => {
                bytes += chunk.length;
                if (bytes > outputLimit) {
                    kill(child);
                    finish(false);
                } else if (stream === child.stdout) output += chunk.toString('utf8');
            });
        child.once('error', (error: NodeJS.ErrnoException) =>
            finish(false, error.code === 'ENOENT'),
        );
        child.once('close', (code) => finish(code === 0));
    });
}

async function installation(): Promise<{
    installed: boolean;
    version: string | null;
    supported: boolean;
}> {
    const result = await run(['--version']);
    const version = result.ok
        ? (result.output.trim().match(/^(?:neon(?:ctl)?\s+)?v?(\d+\.\d+\.\d+)$/)?.[1] ?? null)
        : null;
    const parts = version?.split('.').map(Number);
    // Older `me` implementations can start a browser; fail closed on unverified majors.
    const supported =
        !!parts && parts[0] === 8 && (parts[1] > 15 || (parts[1] === 15 && parts[2] >= 1));
    return {installed: !result.missing, version, supported};
}

async function profiles(): Promise<Profile[]> {
    const result = await run(['profile', 'list', '--output', 'json']);
    if (!result.ok) throw new Error('Neon CLI profiles are unavailable');
    try {
        const rows: unknown = JSON.parse(result.output);
        if (!Array.isArray(rows)) throw new Error();
        return rows.filter(
            (row): row is Profile =>
                !!row &&
                typeof row === 'object' &&
                ['name', 'auth', 'storage', 'file', 'credentials'].every(
                    (key) => typeof row[key] === 'string',
                ),
        );
    } catch {
        throw new Error('Neon CLI profiles are unavailable');
    }
}

async function selectedProfile(name: string): Promise<Profile> {
    const selected = (await profiles()).find((row) => row.name === name);
    if (!selected) throw new Error('Neon CLI profile was not found');
    if (selected.storage === 'keyring')
        throw new Error(
            'Neon CLI keyring profiles cannot be reused yet. Use an account API key or sign in with a separate Tabularis profile.',
        );
    if (
        selected.storage !== 'file' ||
        !isAbsolute(selected.credentials) ||
        selected.file !== 'ok' ||
        !['oauth', 'api key'].includes(selected.auth)
    )
        throw new Error('Neon CLI profile has no reusable credentials');
    return selected;
}

async function readCredential(profile: Profile, allowRefreshable = false): Promise<string> {
    try {
        const file = await open(profile.credentials, constants.O_RDONLY | constants.O_NONBLOCK);
        let value: unknown;
        try {
            const metadata = await file.stat();
            if (!metadata.isFile() || metadata.size > outputLimit) throw new Error();
            const buffer = Buffer.alloc(outputLimit + 1);
            const {bytesRead} = await file.read(buffer, 0, buffer.length, 0);
            if (bytesRead > outputLimit) throw new Error();
            value = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
        } finally {
            await file.close();
        }
        if (!value || typeof value !== 'object') throw new Error();
        const stored = value as Record<string, unknown>;
        const key =
            profile.auth === 'api key' && stored.type === 'api_key'
                ? stored.api_key
                : profile.auth === 'oauth' && (stored.type === undefined || stored.type === 'oauth')
                  ? stored.access_token
                  : undefined;
        if (typeof key !== 'string' || !key.trim() || /[\r\n\0]/.test(key)) throw new Error();
        if (
            profile.auth === 'oauth' &&
            (typeof stored.expires_at !== 'number' ||
                !Number.isFinite(stored.expires_at) ||
                (stored.expires_at <= Date.now() &&
                    !(
                        allowRefreshable &&
                        typeof stored.refresh_token === 'string' &&
                        stored.refresh_token.length > 0
                    )))
        )
            throw new Error();
        return key;
    } catch {
        throw new Error(
            'Neon CLI credential is unavailable. Sign in again or use an account API key.',
        );
    }
}

/** Called only for a host credential explicitly linked to NEON_CLI_AUTH. */
export async function cliCredential(value: unknown): Promise<string> {
    const name = profileName(value);
    if (!(await installation()).supported)
        throw new Error('Install Neon CLI 8.15.1 or a newer 8.x release to reuse its login');
    const selected = await selectedProfile(name);
    // Organization/project API keys can access their resources without permission for /users/me.
    if (selected.auth === 'api key') return readCredential(selected);
    if (!(await run(['me', '--profile', name, '--output', 'json'], commandTimeout)).ok)
        throw new Error(
            'Neon CLI login is unavailable or expired. Sign in again or use an account API key.',
        );
    // The official CLI owns refresh and rotation. Read the current credential after it completes.
    return readCredential(await selectedProfile(name));
}

async function status(args: Params) {
    const installed = await installation();
    const result = {
        installed: installed.installed,
        version: installed.version,
        authenticated: false,
        canReuse: false,
        profile: null as string | null,
    };
    if (!installed.installed)
        return {
            ...result,
            reasonCode: 'missing',
            reason: 'Install the official Neon CLI to sign in through your browser.',
        };
    if (!installed.supported)
        return {
            ...result,
            reasonCode: installed.version ? 'unsupported-version' : 'unavailable',
            reason: 'Install Neon CLI 8.15.1 or a newer 8.x release to reuse its login.',
        };
    const name = profileName(args.profile);
    let names: string[] = [];
    try {
        const rows = await profiles();
        names = rows
            .map((row) => row.name)
            .filter((value) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value));
        const metadata = {...result, profiles: names};
        const selected = rows.find((row) => row.name === name);
        if (!selected)
            return {
                ...metadata,
                reasonCode: 'signed-out',
                reason: 'Sign in with the Neon CLI first.',
            };
        if (selected.storage === 'keyring')
            return {
                ...metadata,
                profile: name,
                reasonCode: 'keyring',
                reason: 'Neon CLI keyring profiles cannot be reused yet. Use an account API key or sign in with a separate Tabularis profile.',
            };
        await selectedProfile(name);
        // Local discovery never refreshes or opens a browser; Use login validates with `me`.
        await readCredential(selected, true);
        return {...metadata, profile: name, authenticated: true, canReuse: true};
    } catch {
        return {
            ...result,
            profiles: names,
            reasonCode: 'unavailable',
            reason: 'Sign in with the Neon CLI, or use an account API key.',
        };
    }
}

function authorizationUrl(output: string): string | undefined {
    /* eslint-disable no-control-regex -- The official CLI can delimit its auth URL with ANSI escapes. */
    const candidate = output.match(/Auth Url:\s*(https:\/\/[^\s\u001b]+)(?=\r?\n|\u001b)/)?.[1];
    /* eslint-enable no-control-regex */
    if (!candidate || candidate.length > 8192) return;
    try {
        const url = new URL(candidate);
        if (
            url.origin === 'https://oauth2.neon.tech' &&
            url.pathname === '/oauth2/auth' &&
            !url.port &&
            !url.username &&
            !url.password &&
            !url.hash
        )
            return url.href;
    } catch {
        /* Ignore unrelated or malformed CLI output. */
    }
}

function stopJob(error: string): void {
    if (!job || job.result.status !== 'waiting') return;
    job.result = {
        id: job.result.id,
        status: 'failed',
        browserOpened: job.result.browserOpened,
        error,
    };
    clearTimeout(job.timer);
    kill(job.child);
}

async function startLogin(): Promise<LoginResult> {
    if (job && job.result.status === 'waiting') return {...job.result};
    if (!(await installation()).supported)
        throw new Error('Install Neon CLI 8.15.1 or a newer 8.x release to sign in');
    // Checking metadata first prevents the CLI from replacing credentials under broken profiles.
    await profiles();
    if (job && job.result.status === 'waiting') return {...job.result};
    const profile = `tabularis-${randomUUID()}`;
    const child = launch(['login', '--profile', profile]);
    child.stdin.end();
    const current: LoginJob = {
        result: {id: randomUUID(), status: 'waiting', browserOpened: process.platform !== 'linux'},
        child,
        timer: setTimeout(() => {
            if (job === current) stopJob('Neon CLI sign-in timed out. Please try again.');
        }, loginLifetime),
        expires: Date.now() + loginLifetime,
    };
    current.timer.unref();
    job = current;
    let output = '';
    let bytes = 0;
    for (const stream of [child.stdout, child.stderr])
        stream.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > outputLimit) {
                if (job === current) stopJob('Neon CLI sign-in produced too much output.');
                return;
            }
            if (current.result.status !== 'waiting') return;
            output += chunk.toString('utf8');
            const authUrl = authorizationUrl(output);
            if (authUrl) current.result.authUrl = authUrl;
        });
    child.once('error', () => {
        if (job === current) stopJob('Neon CLI sign-in could not start.');
    });
    child.once('close', (code) => {
        clearTimeout(current.timer);
        output = '';
        if (current.result.status !== 'waiting') return;
        current.result =
            code === 0
                ? {
                      id: current.result.id,
                      status: 'complete',
                      browserOpened: current.result.browserOpened,
                      profile,
                  }
                : {
                      id: current.result.id,
                      status: 'failed',
                      browserOpened: current.result.browserOpened,
                      error: 'Neon CLI sign-in failed. Please try again.',
                  };
    });
    return {...current.result};
}

export async function cliSetup(method: string, args: Params): Promise<unknown> {
    if (!cliSetupMethods.has(method)) throw new Error('Unsupported Neon account setup method');
    if (
        Object.keys(args).some(
            (key) =>
                !(
                    method === 'account_cli_status' || method === 'account_cli_use'
                        ? ['profile']
                        : method === 'account_cli_login_poll' ||
                            method === 'account_cli_login_cancel'
                          ? ['id']
                          : []
                ).includes(key),
        )
    )
        throw new Error('Invalid Neon CLI setup arguments');
    if (method === 'account_cli_status') return status(args);
    if (method === 'account_cli_use') {
        const profile = profileName(args.profile);
        await cliCredential(profile);
        return {profile};
    }
    if (method === 'account_cli_login_start') return startLogin();
    if (
        typeof args.id !== 'string' ||
        !job ||
        args.id !== job.result.id ||
        Date.now() > job.expires + 60000
    )
        throw new Error('Neon CLI sign-in was not found. Start a new sign-in.');
    if (method === 'account_cli_login_cancel') {
        stopJob('Neon CLI sign-in was cancelled.');
        return null;
    }
    return {...job.result};
}

process.stdin.once('end', () => stopJob('Neon CLI sign-in was cancelled.'));
process.once('exit', () => {
    job?.child.kill('SIGKILL');
});
for (const [signal, exitCode] of [
    ['SIGTERM', 143],
    ['SIGINT', 130],
] as const)
    process.once(signal, () => {
        job?.child.kill('SIGKILL');
        process.exit(exitCode);
    });
