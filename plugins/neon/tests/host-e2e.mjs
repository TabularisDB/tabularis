import assert from 'node:assert/strict';
import {selectProviderOption, providerOptions} from './select.mjs';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdtemp, mkdir, readFile, writeFile, rm, open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import '../dist/env.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'tabularis-neon-host-'));
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
    }),
);
const origin = `http://127.0.0.1:${process.env.NEON_HOST_E2E_PORT ?? 3048}`;
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
            XDG_CONFIG_HOME: join(temp, 'config'),
            TABULARIS_WEB_PASSWORD: password,
            TABULARIS_SECRET_STORE: 'file',
            TABULARIS_SECRET_KEY: randomBytes(32).toString('hex'),
            TABULARIS_SECRET_STORE_PATH: join(temp, 'secrets.json'),
        },
        stdio: ['ignore', log.fd, log.fd],
    },
);
let browser;
let cookie;
let csrf;
let connectionId;
const results = [];
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
async function check(name, action) {
    await action();
    results.push({name, result: 'PASS'});
    console.log(`PASS ${name}`);
}
const url = new URL(process.env.DATABASE_URL);
const params = {
    driver: 'neon',
    host: url.hostname,
    port: Number(url.port || 5432),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    ssl_mode: 'verify-full',
    save_in_keychain: true,
};
const secrets = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => /^(NEON_|AWS_)/.test(key)),
);
secrets.NEON_PROJECT_ID = 'solitary-leaf-07190439';
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
    await check('Core HTTP denies unauthenticated service calls', async () => {
        const response = await fetch(`${origin}/api/v1/rpc/call_plugin_extension`, {
            method: 'POST',
            headers: {origin, 'content-type': 'application/json'},
            body: '{}',
        });
        assert.equal(response.status, 401);
    });
    const saved = await rpc('save_connection', {name: 'Neon Core E2E', params});
    connectionId = saved.id;
    const scope = {pluginId: 'neon', connectionId};
    await rpc('set_plugin_secrets', {...scope, secrets});
    const extension = (method, args = {}) => rpc('call_plugin_extension', {...scope, method, args});
    await check('Core resolves saved SQL credentials and write-only service bundle', async () => {
        const fields = await rpc('get_plugin_secret_fields', scope);
        assert(fields.includes('NEON_AI_GATEWAY_TOKEN'));
        const status = await extension('neon_status');
        assert.equal(status.services.filter((item) => item.configured).length, 6);
        assert.equal(JSON.stringify(status).includes(secrets.NEON_AI_GATEWAY_TOKEN), false);
    });
    await check('All six Neon services work through the real Core web transport', async () => {
        assert((await extension('neon_auth_users')).rows.length > 0);
        assert((await extension('neon_demo_notes')).rows.length > 0);
        assert(Array.isArray(await extension('neon_storage_list')));
        assert((await extension('neon_ai_models')).data.length > 0);
        assert.equal((await extension('neon_function')).status, 200);
        assert(
            (
                await extension('neon_realtime_snapshot', {
                    query: 'SELECT id, title FROM tabularis_demo.notes LIMIT 2',
                })
            ).length > 0,
        );
    });
    await check('Connection retargeting clears the service credentials', async () => {
        await rpc('update_connection', {
            id: connectionId,
            name: saved.name,
            params: {...params, driver: 'sqlite'},
        });
        await rpc('update_connection', {id: connectionId, name: saved.name, params});
        assert.deepEqual(await rpc('get_plugin_secret_fields', scope), []);
        await assert.rejects(extension('neon_ai_models'), /Missing NEON_AI_GATEWAY/);
        await rpc('set_plugin_secrets', {...scope, secrets});
    });
    await check(
        'Provider workspace tab opens, refocuses, restores and returns safely to SQL',
        async () => {
            browser = await chromium.launch({
                executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable',
                headless: true,
            });
            const context = await browser.newContext({
                colorScheme: 'dark',
                viewport: {width: 1160, height: 754},
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
            const page = await context.newPage();
            page.setDefaultTimeout(20000);
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await page.goto(origin);
            await page
                .getByRole('button', {name: 'Maybe later', exact: true})
                .click({timeout: 10000})
                .catch(() => {});
            await page
                .getByRole('button', {name: 'Dismiss', exact: true})
                .click()
                .catch(() => {});
            let failedEditorImport = false;
            let blockEditorImport = true;
            await page.route('**/assets/ConnectionEditorRoute-*.js', async (route) => {
                if (blockEditorImport) {
                    failedEditorImport = true;
                    await route.fulfill({status: 503, contentType: 'text/javascript', body: ''});
                } else await route.continue();
            });
            await page.getByText('Neon Core E2E', {exact: true}).dblclick();
            await page
                .getByRole('heading', {name: 'The editor could not be loaded', exact: true})
                .waitFor();
            assert(failedEditorImport, 'Editor module failure was not exercised');
            assert.equal(
                await page.getByRole('button', {name: 'Close current tab', exact: true}).count(),
                0,
            );
            await page.screenshot({
                path: fileURLToPath(
                    new URL('../artifacts/editor-import-recovery.png', import.meta.url),
                ),
            });
            await page.getByRole('button', {name: 'Back to connections', exact: true}).click();
            await page
                .locator(`[data-connection-id="${connectionId}"]`)
                .getByText('Neon Core E2E', {exact: true})
                .dblclick();
            await page
                .getByRole('heading', {name: 'The editor could not be loaded', exact: true})
                .waitFor();
            blockEditorImport = false;
            await page.getByRole('button', {name: 'Reload app', exact: true}).click();
            const services = page.locator('[data-slot="explorer.services"]');
            const overview = services.getByRole('button', {name: 'Overview', exact: true});
            await overview.waitFor({timeout: 30000});
            console.log(
                'PASS failed editor import shows recovery UI; Back and Reload preserve the connection and restore the editor',
            );
            assert.equal(
                await page.locator('[data-provider-action]').count(),
                0,
                'Provider card remains in native explorer',
            );
            assert.equal(
                await page.locator('[data-slot="explorer.connection.actions"]').count(),
                1,
                'Branch selector is missing from the connection header',
            );
            await page.screenshot({
                path: fileURLToPath(
                    new URL('../artifacts/core-neon-launcher.png', import.meta.url),
                ),
            });
            await overview.click();
            await page.locator('.neon-panel .neon-service').nth(5).waitFor();
            assert.equal(
                await page.locator('[data-plugin-workspace] [role="tablist"]').count(),
                0,
                'Provider has duplicate internal navigation',
            );
            await services.getByRole('button', {name: 'Auth', exact: true}).click();
            await page
                .locator('[data-workspace-header]')
                .getByRole('heading', {name: 'Auth', exact: true})
                .waitFor();
            await page
                .getByRole('list', {name: 'Auth users', exact: true})
                .getByRole('button')
                .first()
                .waitFor();
            assert.equal(
                await services
                    .getByRole('button', {name: 'Auth', exact: true})
                    .getAttribute('aria-pressed'),
                'true',
            );
            assert.equal(
                await services.getByRole('button', {name: 'Database', exact: true}).count(),
                0,
                'Redundant demo Database service remains in the explorer',
            );
            assert.equal(
                await page.getByRole('button', {name: 'Neon · Auth', exact: true}).count(),
                1,
            );
            const objectKey = `tabularis-host-native/${randomBytes(8).toString('hex')}.txt`;
            await extension('neon_storage_put', {key: objectKey, body: 'Native storage selection'});
            try {
                await services.getByRole('button', {name: 'Storage', exact: true}).click();
                await page.getByLabel('Object prefix (optional)', {exact: true}).fill(objectKey);
                await page.getByRole('button', {name: 'List objects', exact: true}).click();
                await page.getByRole('region', {name: 'Service data', exact: true}).waitFor();
                await selectProviderOption(
                    page,
                    page.getByLabel('Existing object', {exact: true}),
                    objectKey,
                );
                assert.equal(
                    await page.getByLabel('Object key', {exact: true}).inputValue(),
                    objectKey,
                );
                await page.getByRole('button', {name: 'Read object', exact: true}).click();
                await page
                    .locator('.neon-output')
                    .filter({hasText: 'Native storage selection'})
                    .waitFor();
                await page
                    .getByLabel('Text content', {exact: true})
                    .fill('Updated through native storage UI');
                await page.getByRole('button', {name: 'Save object', exact: true}).click();
                await page
                    .locator('.neon-panel .neon-confirmation')
                    .getByRole('button', {name: 'Confirm', exact: true})
                    .click();
                await page.getByText('Object saved.', {exact: true}).waitFor();
                assert.equal(
                    (await extension('neon_storage_get', {key: objectKey})).body,
                    'Updated through native storage UI',
                );
                await page.getByRole('button', {name: 'Delete object', exact: true}).click();
                await page
                    .locator('.neon-panel .neon-confirmation')
                    .getByRole('button', {name: 'Confirm', exact: true})
                    .click();
                await page.getByText('Object deleted.', {exact: true}).waitFor();
                console.log('PASS Storage browser: select, read, confirmed upload and deletion');
                await page.screenshot({
                    path: fileURLToPath(
                        new URL('../artifacts/core-neon-storage.png', import.meta.url),
                    ),
                });
            } finally {
                await extension('neon_storage_delete', {key: objectKey});
            }

            await services.getByRole('button', {name: 'Auth', exact: true}).click();
            assert.equal(
                await page.getByRole('button', {name: 'Neon · Auth', exact: true}).count(),
                1,
                'Service duplicate tab created',
            );
            assert.equal(
                await page.locator('.monaco-editor:visible').count(),
                0,
                'SQL editor rendered over provider service',
            );
            await page.getByRole('button', {name: 'Console', exact: true}).click();
            await page.locator('[data-plugin-workspace]').waitFor({state: 'detached'});
            await page.locator('.monaco-editor:visible').first().waitFor();
            await overview.click();
            await page.locator('.neon-panel .neon-service').nth(5).waitFor();
            let persisted = false;
            for (let attempt = 0; attempt < 100; attempt++) {
                const preferences = await rpc('load_editor_preferences', {connectionId});
                const workspaces =
                    preferences?.tabs?.filter((tab) => tab.type === 'plugin-workspace') ?? [];
                const active = workspaces.find((tab) => tab.workspaceId === 'services');
                if (workspaces.length === 3 && active && preferences.active_tab_id === active.id) {
                    persisted = true;
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            assert(persisted, 'Service tab metadata was not persisted');
            await page.reload();
            await page.locator('.neon-panel .neon-service').nth(5).waitFor();
            const assertNativeLayout = async () => {
                const layout = await page.locator('[data-plugin-workspace]').evaluate((panel) => {
                    const bounds = panel.getBoundingClientRect();
                    const header = panel
                        .querySelector('[data-workspace-header]')
                        .getBoundingClientRect();
                    const content = panel
                        .querySelector('[data-workspace-content]')
                        .getBoundingClientRect();
                    return {
                        left: bounds.left,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        headerHeight: header.height,
                        contentTop: content.top,
                        headerBottom: header.bottom,
                        viewportWidth: innerWidth,
                        viewportHeight: innerHeight,
                    };
                });
                assert(
                    layout.left >= 0 &&
                        layout.right <= layout.viewportWidth + 1 &&
                        layout.bottom <= layout.viewportHeight + 1,
                    'Native service exceeds editor pane',
                );
                assert(layout.headerHeight <= 64, 'Provider hero header remains');
                assert(
                    layout.contentTop >= layout.headerBottom - 1,
                    'Native toolbar overlaps service content',
                );
            };
            await assertNativeLayout();
            await page.getByRole('button', {name: 'Collapse Explorer', exact: true}).click();
            await page.setViewportSize({width: 390, height: 700});
            await assertNativeLayout();
            await page.screenshot({
                path: fileURLToPath(
                    new URL('../artifacts/core-neon-panel-mobile.png', import.meta.url),
                ),
            });
            await page.setViewportSize({width: 1160, height: 754});
            await page.getByRole('button', {name: /expand explorer/i}).click();
            await page.screenshot({
                path: fileURLToPath(new URL('../artifacts/core-neon-panel.png', import.meta.url)),
            });
            for (const theme of ['tabularis-light', 'high-contrast', 'tabularis-dark']) {
                await rpc('save_config', {config: {theme, followSystemTheme: false}});
                await page.reload();
                await page.locator('.neon-panel .neon-service').nth(5).waitFor();
                await assertNativeLayout();
                const refresh = page
                    .locator('.neon-panel')
                    .getByRole('button', {name: 'Refresh', exact: true});
                await page.keyboard.press('Tab');
                await refresh.focus();
                const style = await refresh.evaluate((button) => {
                    const computed = getComputedStyle(button);
                    const color = (token) => {
                        const probe = document.createElement('span');
                        probe.style.color = getComputedStyle(document.documentElement)
                            .getPropertyValue(token)
                            .trim();
                        return probe.style.color;
                    };
                    return {
                        background: computed.backgroundColor,
                        input: color('--bg-input'),
                        foreground: computed.color,
                        text: color('--text-primary'),
                        outline: computed.outlineColor,
                        focus: color('--border-focus'),
                        outlineWidth: computed.outlineWidth,
                        radius: computed.borderRadius,
                    };
                });
                assert.equal(style.background, style.input, `${theme}: input fill bypasses theme`);
                assert.equal(style.foreground, style.text, `${theme}: button text bypasses theme`);
                assert.equal(style.outline, style.focus, `${theme}: keyboard focus bypasses theme`);
                assert.equal(style.outlineWidth, '2px', `${theme}: keyboard focus is missing`);
                if (theme === 'high-contrast')
                    assert.equal(style.radius, '0px', 'Plugin ignores square theme corners');
                const selected = await page
                    .locator('[data-slot="explorer.services"] [aria-pressed="true"]')
                    .evaluate((button) => {
                        const computed = getComputedStyle(button);
                        const color = (token) => {
                            const probe = document.createElement('span');
                            probe.style.color = getComputedStyle(document.documentElement)
                                .getPropertyValue(token)
                                .trim();
                            return probe.style.color;
                        };
                        return {
                            background: computed.backgroundColor,
                            accent: color('--accent-primary'),
                            foreground: computed.color,
                            inverse: color('--text-inverse'),
                            icon: getComputedStyle(button.querySelector('svg')).color,
                        };
                    });
                assert.equal(
                    selected.background,
                    selected.accent,
                    `${theme}: selected service uses an unverified fill`,
                );
                assert.equal(
                    selected.foreground,
                    selected.inverse,
                    `${theme}: selected service has no guaranteed contrast`,
                );
                assert.equal(
                    selected.icon,
                    selected.inverse,
                    `${theme}: selected service icon has no guaranteed contrast`,
                );
                await page.screenshot({
                    path: fileURLToPath(
                        new URL(`../artifacts/core-neon-${theme}.png`, import.meta.url),
                    ),
                });
            }
            console.log(
                'PASS Plugin theme, square corners and keyboard focus in light, high-contrast and dark themes',
            );
            await page
                .locator('[data-slot="explorer.services"]')
                .getByRole('button', {name: 'Auth', exact: true})
                .click();
            await page
                .getByRole('list', {name: 'Auth users', exact: true})
                .getByRole('button')
                .first()
                .waitFor();
            await page.screenshot({
                path: fileURLToPath(
                    new URL('../artifacts/core-neon-auth-grid.png', import.meta.url),
                ),
            });
            const nav = page.locator('[data-slot="explorer.services"]');
            await nav.getByRole('button', {name: 'AI Gateway', exact: true}).click();
            await page.getByRole('button', {name: 'Load models', exact: true}).click();
            await page.waitForFunction(() => {
                const model = document.querySelector('#neon-model');
                return model && !model.disabled;
            });
            const modelOptions = await providerOptions(
                page,
                page.getByLabel('Model', {exact: true}),
            );
            const chatModel =
                modelOptions.find((value) => /gpt-4o-mini|llama.*(8b|small)|haiku/i.test(value)) ??
                modelOptions.find((value) => !/embed|codex|pro|image/i.test(value));
            assert(chatModel, 'No chat model is enabled');
            await selectProviderOption(page, page.getByLabel('Model', {exact: true}), chatModel);
            await page
                .getByLabel('Prompt', {exact: true})
                .fill('Reply with exactly: Tabularis Neon OK');
            await page.getByRole('button', {name: 'Send prompt', exact: true}).click();
            await page.locator('.neon-answer').waitFor();
            assert((await page.locator('.neon-answer').innerText()).length > 0);
            console.log('PASS AI Gateway browser: enabled chat model, prompt and real response');
            await page.screenshot({
                path: fileURLToPath(new URL('../artifacts/core-neon-ai.png', import.meta.url)),
            });
            await nav.getByRole('button', {name: 'Functions', exact: true}).click();
            await page.getByRole('button', {name: 'Invoke hello function', exact: true}).click();
            await page
                .locator('.neon-output')
                .filter({hasText: 'Hello from Neon Functions'})
                .waitFor();
            await page.screenshot({
                path: fileURLToPath(
                    new URL('../artifacts/core-neon-functions.png', import.meta.url),
                ),
            });
            await nav.getByRole('button', {name: 'Realtime', exact: true}).click();
            await page.getByRole('button', {name: 'Read live snapshot', exact: true}).click();
            await page
                .getByText('Snapshot received. The subscription is now closed.', {exact: true})
                .waitFor();
            await page.screenshot({
                path: fileURLToPath(
                    new URL('../artifacts/core-neon-realtime.png', import.meta.url),
                ),
            });
            await nav.getByRole('button', {name: 'Connection / Setup', exact: true}).click();
            await page
                .getByLabel('Import .env lines or a JSON object', {exact: true})
                .fill(await readFile(resolve(root, 'plugins/neon/.env.local'), 'utf8'));
            await page
                .getByRole('button', {name: 'Replace keyring credentials', exact: true})
                .click();
            await page
                .getByText('Credentials saved. The pasted draft has been cleared.', {exact: true})
                .waitFor();
            assert.equal(
                await page
                    .getByLabel('Import .env lines or a JSON object', {exact: true})
                    .inputValue(),
                '',
            );
            assert((await rpc('get_plugin_secret_fields', scope)).includes('NEON_AUTH_JWKS_URL'));
            await page.screenshot({
                path: fileURLToPath(new URL('../artifacts/core-neon-setup.png', import.meta.url)),
            });
            await rpc('set_plugin_secrets', {...scope, secrets: {NEON_BRANCH: 'production'}});
            await nav.getByRole('button', {name: 'Overview', exact: true}).click();
            await page
                .locator('.neon-panel')
                .getByRole('button', {name: 'Configure Storage', exact: true})
                .click();
            await page
                .locator('[data-workspace-header]')
                .getByRole('heading', {name: 'Connection / Setup', exact: true})
                .waitFor();

            assert.deepEqual(errors, []);
        },
    );
    await rpc('delete_connection', {id: connectionId});
    connectionId = undefined;
    await mkdir(new URL('../artifacts/', import.meta.url), {recursive: true});
    await writeFile(
        new URL('../artifacts/host-e2e.json', import.meta.url),
        JSON.stringify({at: new Date().toISOString(), results}, null, 2),
    );
} catch (error) {
    await mkdir(new URL('../artifacts/', import.meta.url), {recursive: true});
    if (browser)
        for (const context of browser.contexts())
            for (const page of context.pages())
                await page
                    .screenshot({
                        path: fileURLToPath(
                            new URL('../artifacts/core-neon-failure.png', import.meta.url),
                        ),
                    })
                    .catch(() => {});
    console.error(error.message);
    process.exitCode = 1;
} finally {
    if (connectionId && cookie && csrf)
        await rpc('delete_connection', {id: connectionId}).catch(() => {});
    if (browser) await browser.close();
    server.kill('SIGTERM');
    if (server.exitCode === null && server.signalCode === null)
        await new Promise((resolve) => server.once('exit', resolve));
    await log.close();
    await rm(temp, {recursive: true, force: true});
}
