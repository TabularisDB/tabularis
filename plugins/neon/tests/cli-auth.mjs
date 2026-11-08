import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cliSetup, cliCredential} from '../dist/cliAuth.js';
import {extension} from '../dist/scope.js';
import {account} from '../dist/account.js';

const directory = await mkdtemp(join(tmpdir(), 'neon-cli-bridge-'));
const executable = join(directory, 'neon');
const credentialPath = join(directory, 'credentials.json');
const log = join(directory, 'calls.jsonl');
const originalEnv = {...process.env};
const expires = () => Date.now() + 3600000;
const credential = () => ({
    access_token: 'private-initial-token',
    refresh_token: 'private-refresh-token',
    expires_at: expires(),
});
const row = () => ({
    name: 'DEFAULT',
    auth: 'oauth',
    storage: 'file',
    file: 'ok',
    credentials: credentialPath,
});
const fixture = `#!${process.execPath}
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({args,pid:process.pid,ci:process.env.CI,key: process.env.NEON_API_KEY,profile:process.env.NEON_PROFILE,config:process.env.NEON_CONFIG_DIR,browser:process.env.BROWSER,desktop:process.env.XDG_CURRENT_DESKTOP})+'\\n');
if (args[0] === '--version') { console.log(process.env.FIXTURE_VERSION || '8.15.1'); process.exit(); }
if (args[0] === 'profile') { console.log(process.env.FIXTURE_PROFILES); process.exit(); }
if (args[0] === 'me') {
 if (process.env.FIXTURE_MODE === 'signed-out') { console.error('private-token '+process.env.FIXTURE_CREDENTIAL); process.exit(1); }
 if (process.env.FIXTURE_MODE === 'flood') { console.error('private-token'.repeat(20000)); process.exit(1); }
 const stored = JSON.parse(readFileSync(process.env.FIXTURE_CREDENTIAL));
 stored.access_token = 'private-refreshed-token'; stored.expires_at = Date.now()+3600000;
 writeFileSync(process.env.FIXTURE_CREDENTIAL, JSON.stringify(stored));
 console.log(JSON.stringify({email:'user@example.com',access_token:'must-not-leak'})); process.exit();
}
if (args[0] === 'login') {
 if (process.env.CI !== 'false') { console.error('Cannot run interactive auth in CI'); process.exit(1); }
 if (process.env.FIXTURE_MODE === 'partial-url') {
  process.stderr.write('Auth Url: https://oauth2.neon.tech/oauth2/auth?state=');
  setTimeout(()=>process.stderr.write('complete&client_id=official-cli\\n'), 200);
 } else console.error('Auth Url: '+(process.env.FIXTURE_URL || 'https://oauth2.neon.tech/oauth2/auth?state=opaque&client_id=official-cli'));
 if (process.env.FIXTURE_MODE === 'login-fail') { console.error('private-token'); process.exit(1); }
 if (process.env.FIXTURE_MODE === 'login-complete') { process.exit(); }
 setInterval(()=>{},1000);
}
`;
await writeFile(executable, fixture, {mode: 0o700});
// An executable without an extension must be ESM independently of the host's working directory.
await writeFile(join(directory, 'package.json'), '{"type":"module"}');

async function reset(mode = '') {
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv, {
        PATH: directory,
        NEON_API_KEY: 'ambient-secret',
        NEON_PROFILE: 'ambient-profile',
        NEON_CONFIG_DIR: directory,
        FIXTURE_LOG: log,
        FIXTURE_CREDENTIAL: credentialPath,
        FIXTURE_PROFILES: JSON.stringify([row()]),
        FIXTURE_MODE: mode,
    });
    await writeFile(credentialPath, JSON.stringify(credential()));
    await writeFile(log, '');
}
async function calls() {
    return (await readFile(log, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}
async function settled(id) {
    for (let i = 0; i < 100; i++) {
        const result = await cliSetup('account_cli_login_poll', {id});
        if (result.authUrl || result.status !== 'waiting') return result;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Fixture did not start');
}
after(async () => {
    Object.assign(process.env, originalEnv);
    await rm(directory, {recursive: true, force: true});
});

test('missing CLI is safe and does not try install or login', async () => {
    await reset();
    process.env.PATH = join(directory, 'missing');
    assert.deepEqual(await cliSetup('account_cli_status', {}), {
        installed: false,
        version: null,
        authenticated: false,
        canReuse: false,
        profile: null,
        reasonCode: 'missing',
        reason: 'Install the official Neon CLI to sign in through your browser.',
    });
});
test('unverified CLI versions fail closed before profile or auth commands', async () => {
    await reset();
    process.env.FIXTURE_VERSION = '7.0.0';
    assert.equal((await cliSetup('account_cli_status', {})).canReuse, false);
    await assert.rejects(cliSetup('account_cli_use', {}), /8.15.1/);
    assert((await calls()).every((call) => call.args[0] === '--version'));
});
test('status reads local metadata only and returns no token or credential path', async () => {
    await reset();
    const status = await cliSetup('account_cli_status', {});
    assert.equal(status.canReuse, true);
    assert.equal(status.profile, 'DEFAULT');
    const serialized = JSON.stringify(status);
    for (const value of [credentialPath, 'private-', 'refresh_token'])
        assert(!serialized.includes(value));
    assert.deepEqual(
        (await calls()).map((call) => call.args[0]),
        ['--version', 'profile', 'profile'],
    );
});
test('expired millisecond timestamps without refresh credentials are not advertised as reusable', async () => {
    await reset();
    await writeFile(
        credentialPath,
        JSON.stringify({access_token: 'private-expired', expires_at: Date.now() - 60000}),
    );
    assert.equal((await cliSetup('account_cli_status', {})).canReuse, false);
});
test('named CLI profiles are discoverable without returning credential paths', async () => {
    await reset();
    process.env.FIXTURE_PROFILES = JSON.stringify([
        {...row(), name: 'DEFAULT', file: 'missing', auth: '-'},
        {...row(), name: 'work'},
    ]);
    const status = await cliSetup('account_cli_status', {profile: 'work'});
    assert.deepEqual(status.profiles, ['DEFAULT', 'work']);
    assert.equal(status.profile, 'work');
    assert.equal(status.canReuse, true);
    assert(!JSON.stringify(status).includes(credentialPath));
});
test('stored organization API-key profiles do not require the user-only me endpoint', async () => {
    await reset('signed-out');
    process.env.FIXTURE_PROFILES = JSON.stringify([{...row(), auth: 'api key'}]);
    await writeFile(credentialPath, JSON.stringify({type: 'api_key', api_key: 'private-org-key'}));
    assert.equal(await cliCredential('DEFAULT'), 'private-org-key');
    assert(!(await calls()).some((call) => call.args[0] === 'me'));
});
test('a refreshable expired session can be selected without opening a browser', async () => {
    await reset();
    await writeFile(credentialPath, JSON.stringify({...credential(), expires_at: 1}));
    assert.equal((await cliSetup('account_cli_status', {})).canReuse, true);
    assert.deepEqual(await cliSetup('account_cli_use', {}), {profile: 'DEFAULT'});
    assert.equal(
        (await JSON.parse(await readFile(credentialPath, 'utf8'))).access_token,
        'private-refreshed-token',
    );
});
test('explicit reuse invokes safe me, strips ambient identity, and honors config directory', async () => {
    await reset();
    assert.equal(await cliCredential('DEFAULT'), 'private-refreshed-token');
    const invoked = await calls();
    assert(
        invoked.some(
            (call) =>
                JSON.stringify(call.args) ===
                JSON.stringify([
                    'me',
                    '--profile',
                    'DEFAULT',
                    '--output',
                    'json',
                    '--no-analytics',
                ]),
        ),
    );
    assert(
        invoked.every(
            (call) =>
                call.key === undefined && call.profile === undefined && call.config === directory,
        ),
    );
    if (process.platform === 'linux')
        assert(
            invoked.every((call) => call.browser === '/bin/true' && call.desktop === 'X-Generic'),
        );
});
test('signed-out CLI and remote failure produce sanitized errors', async () => {
    await reset('signed-out');
    await assert.rejects(
        cliSetup('account_cli_use', {}),
        (error) => !error.message.includes('private-') && !error.message.includes(directory),
    );
    assert(!(await calls()).some((call) => call.args[0] === 'login'));
});
test('CLI token refresh occurs on each opted-in account request; API key mode stays isolated', async () => {
    await reset();
    const fetcher = async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        assert.equal(request.headers.get('authorization'), 'Bearer private-refreshed-token');
        return Response.json(
            request.url.includes('/organizations') ? {organizations: []} : {projects: []},
        );
    };
    await account('account_projects', {}, {NEON_CLI_AUTH: 'DEFAULT'}, fetcher);
    await account('account_projects', {}, {NEON_CLI_AUTH: 'DEFAULT'}, fetcher);
    assert.equal((await calls()).filter((call) => call.args[0] === 'me').length, 2);
    await writeFile(log, '');
    await account('account_projects', {}, {NEON_API_KEY: 'explicit-api-key'}, async () =>
        Response.json({organizations: [], projects: []}),
    );
    await assert.rejects(account('account_projects', {}, {}), /API key is required/);
    await assert.rejects(
        account('account_projects', {}, {NEON_API_KEY: 'explicit', NEON_CLI_AUTH: 'DEFAULT'}),
        /Choose one/,
    );
    assert.deepEqual(await calls(), []);
});
test('unsupported keyring and malformed profiles fail without credential or path exposure', async () => {
    await reset();
    process.env.FIXTURE_PROFILES = JSON.stringify([
        {...row(), storage: 'keyring', credentials: 'keyring'},
    ]);
    const status = await cliSetup('account_cli_status', {});
    assert.equal(status.canReuse, false);
    assert.match(status.reason, /keyring/);
    await assert.rejects(cliSetup('account_cli_use', {}), /keyring/);
    assert(!(await calls()).some((call) => call.args[0] === 'me'));
    process.env.FIXTURE_PROFILES = 'invalid private-token';
    assert.equal((await cliSetup('account_cli_status', {})).canReuse, false);
});
test('oversized CLI output is bounded and sanitized', async () => {
    await reset('flood');
    await assert.rejects(
        cliCredential('DEFAULT'),
        (error) => !error.message.includes('private-token'),
    );
});
test('setup scope accepts only explicit setup methods and empty credentials', async () => {
    await reset();
    const envelope = {
        context: {plugin_id: 'neon', scope: 'account-setup'},
        args: {},
        secrets: {},
        method: 'account_cli_status',
    };
    assert.equal((await extension(envelope)).canReuse, true);
    for (const request of [
        {...envelope, method: 'account_projects'},
        {...envelope, secrets: {NEON_CLI_AUTH: 'DEFAULT'}},
        {...envelope, params: {}},
        {...envelope, context: {...envelope.context, connection_id: 'x'}},
        {...envelope, args: {executable: '/tmp/evil'}},
    ])
        await assert.rejects(extension(request));
    await assert.rejects(cliSetup('account_cli_use', {profile: '--api-key=evil'}), /Invalid/);
    await assert.rejects(cliSetup('account_cli_login_poll', {id: 'unknown'}), /not found/);
});
test('login job uses a new profile, exposes only validated URL, supports cancellation and bounds concurrency', async () => {
    await reset();
    const first = await cliSetup('account_cli_login_start', {});
    const waiting = await settled(first.id);
    assert.equal(waiting.status, 'waiting');
    assert.match(waiting.authUrl, /^https:\/\/oauth2\.neon\.tech\/oauth2\/auth/);
    assert.equal((await cliSetup('account_cli_login_start', {})).id, first.id);
    const login = (await calls()).find((call) => call.args[0] === 'login');
    assert.match(login.args[2], /^tabularis-/);
    assert.notEqual(login.args[2], 'DEFAULT');
    assert.equal(await cliSetup('account_cli_login_cancel', {id: first.id}), null);
    assert.match((await cliSetup('account_cli_login_poll', {id: first.id})).error, /cancelled/);
});
test('login failures never forward raw CLI stderr', async () => {
    await reset('login-fail');
    const started = await cliSetup('account_cli_login_start', {});
    let result = await settled(started.id);
    while (result.status === 'waiting') {
        await new Promise((resolve) => setTimeout(resolve, 10));
        result = await cliSetup('account_cli_login_poll', {id: started.id});
    }
    assert.equal(result.status, 'failed');
    assert(!JSON.stringify(result).includes('private-'));
});
test('malicious authorization URLs are omitted', async () => {
    await reset();
    process.env.FIXTURE_URL =
        'https://oauth2.neon.tech.evil.test/oauth2/auth?access_token=private-token';
    const started = await cliSetup('account_cli_login_start', {});
    await new Promise((resolve) => setTimeout(resolve, 100));
    const result = await cliSetup('account_cli_login_poll', {id: started.id});
    assert.equal(result.authUrl, undefined);
    await cliSetup('account_cli_login_cancel', {id: started.id});
});
test('successful job returns a profile reference only', async () => {
    await reset('login-complete');
    const started = await cliSetup('account_cli_login_start', {});
    let result = await settled(started.id);
    while (result.status === 'waiting') {
        await new Promise((resolve) => setTimeout(resolve, 10));
        result = await cliSetup('account_cli_login_poll', {id: started.id});
    }
    assert.equal(result.status, 'complete');
    assert.match(result.profile, /^tabularis-/);
    assert.equal(result.authUrl, undefined);
    assert(!JSON.stringify(result).includes('private-'));
});

test('local CLI command timeout is bounded', async (t) => {
    await reset();
    t.mock.timers.enable({apis: ['setTimeout']});
    const pending = cliSetup('account_cli_status', {});
    t.mock.timers.tick(2000);
    const status = await pending;
    assert.equal(status.canReuse, false);
    assert.equal(status.version, null);
    t.mock.timers.reset();
});
test('login jobs expire without returning raw output', async (t) => {
    await reset();
    t.mock.timers.enable({apis: ['setTimeout']});
    const started = await cliSetup('account_cli_login_start', {});
    t.mock.timers.tick(5 * 60 * 1000);
    const result = await cliSetup('account_cli_login_poll', {id: started.id});
    assert.equal(result.status, 'failed');
    assert.match(result.error, /timed out/);
    assert.equal(result.authUrl, undefined);
    t.mock.timers.reset();
});

test('a partial authorization URL is withheld until its complete line arrives', async () => {
    await reset('partial-url');
    const started = await cliSetup('account_cli_login_start', {});
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await cliSetup('account_cli_login_poll', {id: started.id})).authUrl, undefined);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.match(
        (await cliSetup('account_cli_login_poll', {id: started.id})).authUrl,
        /state=complete/,
    );
    await cliSetup('account_cli_login_cancel', {id: started.id});
});
test('host stdin end and termination signals kill only its owned login child', async () => {
    for (const signal of ['stdin-end', 'SIGTERM', 'SIGINT']) {
        await reset();
        const host = spawn(
            process.execPath,
            [
                '--input-type=module',
                '-e',
                `import {cliSetup} from ${JSON.stringify(new URL('../dist/cliAuth.js', import.meta.url).href)}; process.stdin.resume(); await cliSetup('account_cli_login_start', {});`,
            ],
            {env: process.env, stdio: 'pipe'},
        );
        let pid;
        for (let i = 0; i < 100; i++) {
            pid = (await calls()).find((call) => call.args[0] === 'login')?.pid;
            if (pid) break;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert(pid, 'owned fixture login started');
        const exited = once(host, 'exit');
        if (signal === 'stdin-end') host.stdin.end();
        else host.kill(signal);
        await exited;
        let running = true;
        for (let i = 0; i < 100; i++) {
            try {
                process.kill(pid, 0);
                if (
                    process.platform === 'linux' &&
                    /\) Z /.test(await readFile(`/proc/${pid}/stat`, 'utf8'))
                ) {
                    running = false;
                    break;
                }
            } catch {
                running = false;
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(running, false, `${signal} did not leave a running login process`);
    }
});
