import assert from 'node:assert/strict';
import {selectProviderOption} from './select.mjs';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdtemp, mkdir, writeFile, rm, open} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

// Reuse the same refreshable profile reference as the installed plugin.
const apiKey = process.env.NEON_API_KEY;
const cliMode = process.env.NEON_MANAGEMENT_TEST_USE_CLI === '1';
const cliProfile = process.env.NEON_MANAGEMENT_TEST_CLI_PROFILE ?? 'DEFAULT';
assert(
    cliMode || (typeof apiKey === 'string' && apiKey),
    'Set NEON_API_KEY or NEON_MANAGEMENT_TEST_USE_CLI=1',
);
const projectId = process.env.NEON_ACCOUNT_TEST_PROJECT_ID ?? 'solitary-leaf-07190439';
const orgId = process.env.NEON_ACCOUNT_TEST_ORG_ID ?? 'org-empty-pine-21623834';
const branchName = process.env.NEON_ACCOUNT_TEST_BRANCH ?? 'production';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'tabularis-neon-management-'));
const config = join(temp, 'config', 'tabularis');
await mkdir(config, {recursive: true});
await writeFile(
    join(config, 'config.json'),
    JSON.stringify({
        activeExternalDrivers: ['neon'],
        autoConnectLastConnection: false,
        lastOpenConnectionIds: [],
        lastActiveConnectionId: null,
        language: 'en',
        showWelcome: false,
    }),
);
const origin = `http://127.0.0.1:${process.env.NEON_MANAGEMENT_TEST_PORT ?? 3050}`;
const password = randomBytes(32).toString('base64url');
const log = await open(join(temp, 'server.log'), 'w', 0o600);
const server = spawn(
    resolve(root, 'src-tauri/target/debug/tabularis'),
    [
        'web',
        '--host',
        '127.0.0.1',
        '--port',
        new URL(origin).port,
        '--no-open',
        '--auth',
        'password',
        '--allow-high-risk',
        '--public-url',
        origin,
        '--allowed-origin',
        origin,
        '--web-root',
        resolve(root, 'packages/web-ui/dist'),
    ],
    {
        env: {
            ...process.env,
            ...(cliMode
                ? {
                      NEON_CONFIG_DIR:
                          process.env.NEON_CONFIG_DIR ?? join(homedir(), '.config', 'neon'),
                  }
                : {}),
            XDG_CONFIG_HOME: join(temp, 'config'),
            TABULARIS_WEB_PASSWORD: password,
            TABULARIS_SECRET_STORE: 'file',
            TABULARIS_SECRET_KEY: randomBytes(32).toString('hex'),
            TABULARIS_SECRET_STORE_PATH: join(temp, 'secrets.json'),
        },
        stdio: ['ignore', log.fd, log.fd],
    },
);
let cookie;
let csrf;
let connectionId;
let connected = false;
let browser;
const results = [];
let activationFailure = false;

async function rpc(command, payload) {
    const response = await fetch(`${origin}/api/v1/rpc/${command}`, {
        method: 'POST',
        headers: {origin, cookie, 'content-type': 'application/json', 'x-tabularis-csrf': csrf},
        body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!result.ok)
        throw new Error(`Core RPC ${command}: ${result.error?.message ?? response.status}`);
    return result.data;
}
const account = (operation, payload = {}) =>
    rpc('plugin_account', {pluginId: 'neon', operation, ...payload});
const call = (method, args = {}) => account('call', {method, args});
async function check(name, action) {
    await action();
    results.push({name, result: 'PASS'});
    console.log(`PASS ${name}`);
}

try {
    let ready = false;
    for (let attempt = 0; attempt < 300; attempt++) {
        if (server.exitCode !== null) throw new Error('Core web server exited before startup');
        try {
            if ((await fetch(`${origin}/login`)).ok) {
                ready = true;
                break;
            }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(ready, 'Core web server failed to start');
    const login = await fetch(`${origin}/api/v1/auth/login`, {
        method: 'POST',
        headers: {origin, 'content-type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({password}),
        redirect: 'manual',
    });
    assert.equal(login.status, 303);
    cookie = login.headers.get('set-cookie').split(';')[0];
    csrf = (await (await fetch(`${origin}/api/v1/session`, {headers: {cookie}})).json()).csrfToken;
    assert(csrf);
    await account('connect', {
        secrets: cliMode ? {NEON_CLI_AUTH: cliProfile} : {NEON_API_KEY: apiKey},
    });
    connected = true;

    const branchId = (await call('account_branches', {projectId})).branches.find(
        (item) => item.name === branchName,
    )?.id;
    assert(branchId, 'Requested branch was not found');
    const resources = await call('account_resources', {projectId, branchId});
    const database = resources.databases.find((item) => item.name === 'neondb')?.name;
    const role = resources.roles.find((item) => item.name === 'neondb_owner')?.name;
    assert(database && role, 'Test database/role missing');
    const saved = await account('import', {
        args: {projectId, branchId, database, role, createServiceCredentials: false},
    });
    connectionId = saved.id;
    const manage = (method, args = {}) => call(method, {...args, projectId, branchId});
    const slug = `ui${randomBytes(5).toString('hex')}`;
    const displayName = `Tabularis UI ${randomBytes(4).toString('hex')}`;
    const email = `tabularis-ui-${randomBytes(6).toString('hex')}@example.com`;
    let functionCreated = false;
    let userId;
    let page;
    async function waitDeployment(id) {
        for (let attempt = 0; attempt < 120; attempt++) {
            const result = await manage('account_function_get', {slug});
            if (result.deploymentId === String(id) && result.status === 'completed') return result;
            if (result.deploymentId === String(id) && result.status === 'failed')
                throw new Error('Disposable UI function deployment failed');
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        throw new Error('Disposable UI deployment did not finish');
    }
    try {
        browser = await chromium.launch({
            executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable',
            headless: true,
        });
        const context = await browser.newContext({
            colorScheme: 'dark',
            viewport: {width: 1280, height: 900},
            permissions: ['clipboard-read', 'clipboard-write'],
        });
        const split = cookie.indexOf('=');
        await context.addCookies([
            {
                name: cookie.slice(0, split),
                value: cookie.slice(split + 1),
                url: origin,
                httpOnly: true,
                sameSite: 'Strict',
            },
        ]);
        page = await context.newPage();
        page.setDefaultTimeout(20000);
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(origin);
        await page
            .getByRole('button', {name: 'Dismiss', exact: true})
            .click({timeout: 1000})
            .catch(() => {});
        await page.getByText(saved.name, {exact: true}).dblclick();
        const nav = page.locator('[data-slot="explorer.services"]');
        await nav.getByRole('button', {name: 'Functions', exact: true}).click();
        await check(
            'Functions list opens a native source tab and deploys a disposable function',
            async () => {
                await page.getByRole('button', {name: 'New function', exact: true}).click();
                await page.getByLabel('Function slug', {exact: true}).fill(slug);
                await page
                    .getByRole('region', {name: 'Function source', exact: true})
                    .locator('.monaco-editor')
                    .waitFor();
                const response = page.waitForResponse(
                    (response) =>
                        response.url().endsWith('/rpc/plugin_account') &&
                        response.request().postDataJSON()?.method === 'account_function_deploy',
                );
                await page.getByRole('button', {name: 'Deploy function', exact: true}).click();
                const envelope = await (await response).json();
                assert(envelope.ok, 'UI deploy failed');
                functionCreated = true;
                await waitDeployment(envelope.data.id);
                await page.getByLabel('Display name', {exact: true}).waitFor();
                await page.getByRole('button', {name: 'Refresh', exact: true}).click();
                await page.screenshot({
                    path: resolve(root, 'plugins/neon/artifacts/management-function-source.png'),
                });
            },
        );
        await check(
            'Function rename, configuration submission and invocation work in the native view',
            async () => {
                await page.getByRole('button', {name: 'Copy URL', exact: true}).click();
                await page.getByText('Function URL copied.', {exact: true}).waitFor();
                await page.getByLabel('Display name', {exact: true}).fill(displayName);
                await page.getByRole('button', {name: 'Rename', exact: true}).click();
                await page.getByText('Function display name updated.', {exact: true}).waitFor();
                await page.getByText('Environment and secrets', {exact: true}).click();
                await page
                    .getByLabel('Write-only environment changes (JSON)', {exact: true})
                    .fill('{"TABULARIS_UI_TEST":"enabled"}');
                const response = page.waitForResponse(
                    (response) =>
                        response.url().endsWith('/rpc/plugin_account') &&
                        response.request().postDataJSON()?.method === 'account_function_deploy',
                );
                await page
                    .getByRole('button', {name: 'Save environment changes', exact: true})
                    .click();
                const envelope = await (await response).json();
                assert(envelope.ok);
                await waitDeployment(envelope.data.id);
                assert.equal(
                    await page
                        .getByLabel('Write-only environment changes (JSON)', {exact: true})
                        .inputValue(),
                    '',
                );
                await page.getByText('Invoke function', {exact: true}).click();
                await selectProviderOption(
                    page,
                    page.getByLabel('HTTP method', {exact: true}),
                    'POST',
                    true,
                );
                await page
                    .getByLabel('Request body', {exact: true})
                    .fill('{"selectionCheck":true}');
                await page.getByRole('button', {name: 'Send request', exact: true}).click();
                await page
                    .locator('.neon-output')
                    .filter({hasText: 'Hello from Tabularis'})
                    .waitFor();
                await page.screenshot({
                    path: resolve(root, 'plugins/neon/artifacts/management-function-invoke.png'),
                });
            },
        );
        await check(
            'Auth identity creation and role changes work through the account API',
            async () => {
                await nav.getByRole('button', {name: 'Auth', exact: true}).click();
                await page.getByRole('button', {name: 'Add user', exact: true}).click();
                await page.getByLabel('Name', {exact: true}).fill(displayName);
                await page.getByLabel('Email', {exact: true}).fill(email);
                assert.equal(await page.locator('input[type="password"]').count(), 0);
                const response = page.waitForResponse(
                    (response) =>
                        response.url().endsWith('/rpc/plugin_account') &&
                        response.request().postDataJSON()?.method === 'account_auth_create_user',
                );
                await page.getByRole('button', {name: 'Create user', exact: true}).click();
                const envelope = await (await response).json();
                assert(envelope.ok, 'UI Auth create failed');
                userId = envelope.data.id;
                await page.getByRole('button', {name: displayName, exact: true}).click();
                await selectProviderOption(page, page.getByLabel('Role', {exact: true}), 'admin');
                await page.getByRole('button', {name: 'Save role', exact: true}).click();
                await page.getByText('Role updated.', {exact: true}).waitFor();
                await selectProviderOption(page, page.getByLabel('Role', {exact: true}), 'user');
                await page.getByRole('button', {name: 'Save role', exact: true}).click();
                await page.screenshot({
                    path: resolve(root, 'plugins/neon/artifacts/management-auth-user.png'),
                });
            },
        );
        try {
            await nav.getByRole('button', {name: 'Functions', exact: true}).click();
            await page.getByRole('button', {name: displayName, exact: true}).click();
            await selectProviderOption(
                page,
                page.getByLabel('Language', {exact: true}),
                'typescript',
            );
            const editor = page
                .getByRole('region', {name: 'Function source', exact: true})
                .locator('.monaco-editor');
            await editor.click({position: {x: 100, y: 40}});
            await page.keyboard.press('ControlOrMeta+A');
            await page.evaluate(
                (source) => navigator.clipboard.writeText(source),
                'export default { fetch(request: Request): Response { return Response.json({revision: 2, environment: process.env.TABULARIS_UI_TEST}); } };',
            );
            await page.keyboard.press('ControlOrMeta+V');
            const validation = page.waitForResponse(
                (response) =>
                    response.url().endsWith('/rpc/plugin_account') &&
                    response.request().postDataJSON()?.method === 'account_function_validate',
            );
            await page.getByRole('button', {name: 'Validate function', exact: true}).click();
            const checked = await (await validation).json();
            assert(checked.ok && checked.data.valid, 'Pasted source did not pass validation');
            await page.getByRole('button', {name: 'Deploy function', exact: true}).click();
            const response = page.waitForResponse(
                (response) =>
                    response.url().endsWith('/rpc/plugin_account') &&
                    response.request().postDataJSON()?.method === 'account_function_deploy',
            );
            await page.getByRole('button', {name: 'Confirm deployment', exact: true}).click();
            const envelope = await (await response).json();
            assert(
                envelope.ok,
                `Core deployment rejected: ${envelope.error?.message ?? 'unknown error'}`,
            );
            const deployment = envelope.data;
            const state = await waitDeployment(deployment.id);
            let activated = false;
            for (let attempt = 0; attempt < 6; attempt++) {
                const invoked = await manage('account_function_invoke', {slug, method: 'GET'});
                assert.equal(invoked.status, 200);
                let actual;
                try {
                    actual = JSON.parse(invoked.body);
                } catch {}
                if (actual?.revision === 2 && actual.environment === 'enabled') {
                    activated = true;
                    break;
                }
                if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 2000));
            }
            assert(
                activated,
                `Neon activation mismatch: current=${state.deploymentId}, active=${state.activeDeploymentId}; endpoint did not serve updated source/environment after six checks`,
            );
            console.log(
                'PASS Function browser: TypeScript redeployment and environment are live at the endpoint',
            );
        } catch (error) {
            activationFailure = true;
            console.error('FAIL Function redeployment activation:', error.message);
        }
        await nav.getByRole('button', {name: 'Auth', exact: true}).click();
        await page.getByRole('button', {name: displayName, exact: true}).click();
        await check(
            'Destructive Auth and Function actions require confirmation and delete only test resources',
            async () => {
                await page.getByRole('button', {name: 'Delete user', exact: true}).click();
                await page.getByRole('button', {name: 'Confirm deletion', exact: true}).click();
                await page.getByText('User deleted.', {exact: true}).waitFor();
                userId = undefined;
                await nav.getByRole('button', {name: 'Functions', exact: true}).click();
                await page.getByRole('button', {name: displayName, exact: true}).click();
                await page.locator('summary').filter({hasText: 'Delete function'}).click();
                await page.getByRole('button', {name: 'Delete function', exact: true}).click();
                await page.getByRole('button', {name: 'Confirm deletion', exact: true}).click();
                await page.getByText(`Function ${slug} deleted.`, {exact: true}).waitFor();
                functionCreated = false;
                assert.deepEqual(errors, []);
            },
        );
    } catch (error) {
        await page
            ?.screenshot({path: resolve(root, 'plugins/neon/artifacts/management-ui-failure.png')})
            .catch(() => {});
        throw error;
    } finally {
        if (userId) await manage('account_auth_delete_user', {userId}).catch(() => {});
        if (functionCreated) await manage('account_function_delete', {slug}).catch(() => {});
    }
    console.log(
        `${activationFailure ? 'PARTIAL' : 'PASS'} ${results.length} management browser checks passed; activation ${activationFailure ? 'failed' : 'passed'}; disposable resources removed`,
    );
    if (activationFailure) process.exitCode = 1;
} catch (error) {
    console.error(
        error instanceof Error
            ? apiKey
                ? error.message.replaceAll(apiKey, '[account credential]')
                : error.message
            : 'Management browser test failed',
    );
    process.exitCode = 1;
} finally {
    await browser?.close();
    if (connectionId && cookie && csrf)
        await rpc('delete_connection', {id: connectionId}).catch(() => {});
    if (connected && cookie && csrf) await account('disconnect').catch(() => {});
    server.kill('SIGTERM');
    if (server.exitCode === null && server.signalCode === null)
        await new Promise((resolve) => server.once('exit', resolve));
    await log.close();
    await rm(temp, {recursive: true, force: true});
}
