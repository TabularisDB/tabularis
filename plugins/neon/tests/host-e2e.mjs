import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import '../dist/env.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'tabularis-neon-host-'));
const config = join(temp, 'config', 'tabularis');
await mkdir(config, { recursive: true });
await writeFile(join(config, 'config.json'), JSON.stringify({ activeExternalDrivers: ['neon'], autoConnectLastConnection: false, lastOpenConnectionIds: [], lastActiveConnectionId: null, language: 'en' }));
const origin = `http://127.0.0.1:${process.env.NEON_HOST_E2E_PORT ?? 3048}`;
const password = randomBytes(32).toString('base64url');
const log = await open(join(temp, 'server.log'), 'w', 0o600);
const server = spawn(resolve(root, 'src-tauri/target/debug/tabularis'), ['web', '--host', '127.0.0.1', '--port', new URL(origin).port, '--no-open', '--auth', 'password', '--allow-high-risk', '--public-url', origin, '--allowed-origin', origin, '--web-root', resolve(root, 'packages/web-ui/dist')], {
  env: { ...process.env, XDG_CONFIG_HOME: join(temp, 'config'), TABULARIS_WEB_PASSWORD: password, TABULARIS_SECRET_STORE: 'file', TABULARIS_SECRET_KEY: randomBytes(32).toString('hex'), TABULARIS_SECRET_STORE_PATH: join(temp, 'secrets.json') },
  stdio: ['ignore', log.fd, log.fd],
});
let browser;
let cookie;
let csrf;
let connectionId;
const results = [];
async function rpc(command, payload) {
  const response = await fetch(`${origin}/api/v1/rpc/${command}`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json', 'x-tabularis-csrf': csrf }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!result.ok) throw new Error(`Core RPC ${command}: ${result.error?.message ?? response.status}`);
  return result.data;
}
async function check(name, action) { await action(); results.push({ name, result: 'PASS' }); console.log(`PASS ${name}`); }
const url = new URL(process.env.DATABASE_URL);
const params = { driver: 'neon', host: url.hostname, port: Number(url.port || 5432), username: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)), ssl_mode: 'verify-full', save_in_keychain: true };
const secrets = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(NEON_|AWS_)/.test(key)));
secrets.NEON_PROJECT_ID = 'solitary-leaf-07190439';
try {
  let ready = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    if (server.exitCode !== null) throw new Error('Core web server exited before startup');
    try { if ((await fetch(`${origin}/login`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, 'Core web server failed to start');
  const login = await fetch(`${origin}/api/v1/auth/login`, { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password }), redirect: 'manual' });
  assert.equal(login.status, 303);
  cookie = login.headers.get('set-cookie').split(';')[0];
  csrf = (await (await fetch(`${origin}/api/v1/session`, { headers: { cookie } })).json()).csrfToken;
  assert(csrf);
  await check('Core HTTP denies unauthenticated service calls', async () => {
    const response = await fetch(`${origin}/api/v1/rpc/call_plugin_extension`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 401);
  });
  const saved = await rpc('save_connection', { name: 'Neon Core E2E', params });
  connectionId = saved.id;
  const scope = { pluginId: 'neon', connectionId };
  await rpc('set_plugin_secrets', { ...scope, secrets });
  const extension = (method, args = {}) => rpc('call_plugin_extension', { ...scope, method, args });
  await check('Core resolves saved SQL credentials and write-only service bundle', async () => {
    const fields = await rpc('get_plugin_secret_fields', scope);
    assert(fields.includes('NEON_AI_GATEWAY_TOKEN'));
    const status = await extension('neon_status');
    assert.equal(status.services.filter(item => item.configured).length, 6);
    assert.equal(JSON.stringify(status).includes(secrets.NEON_AI_GATEWAY_TOKEN), false);
  });
  await check('All six Neon services work through the real Core web transport', async () => {
    assert((await extension('neon_auth_users')).rows.length > 0);
    assert((await extension('neon_demo_notes')).rows.length > 0);
    assert(Array.isArray(await extension('neon_storage_list')));
    assert((await extension('neon_ai_models')).data.length > 0);
    assert.equal((await extension('neon_function')).status, 200);
    assert((await extension('neon_realtime_snapshot', { query: 'SELECT id, title FROM tabularis_demo.notes LIMIT 2' })).length > 0);
  });
  await check('Connection retargeting clears the service credentials', async () => {
    await rpc('update_connection', { id: connectionId, name: saved.name, params: { ...params, driver: 'sqlite' } });
    await rpc('update_connection', { id: connectionId, name: saved.name, params });
    assert.deepEqual(await rpc('get_plugin_secret_fields', scope), []);
    await assert.rejects(extension('neon_ai_models'), /Missing NEON_AI_GATEWAY/);
    await rpc('set_plugin_secrets', { ...scope, secrets });
  });
  await check('Real Tabularis UI opens the Neon service panel and reads project data', async () => {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable', headless: true });
    const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1160, height: 754 } });
    const split = cookie.indexOf('=');
    await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: origin, httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.getByRole('button', { name: 'Maybe later', exact: true }).click({ timeout: 10000 }).catch(() => {});
    await page.getByText('Neon Core E2E', { exact: true }).dblclick();
    const launcher = page.locator('[data-slot="explorer.connection.actions"]').getByRole('button', { name: 'Neon workspace', exact: true });
    await launcher.waitFor({ timeout: 30000 });
    assert.equal(await page.locator('[data-slot="sidebar.footer.actions"] .neon-launch').count(), 0);
    const buttonBounds = await launcher.boundingBox();
    const explorerBounds = await launcher.locator('xpath=ancestor::aside').boundingBox();
    assert(buttonBounds && explorerBounds && buttonBounds.x >= explorerBounds.x && buttonBounds.x + buttonBounds.width <= explorerBounds.x + explorerBounds.width + 1, 'Launcher overflows the connection explorer');
    await page.screenshot({ path: fileURLToPath(new URL('../artifacts/core-neon-launcher.png', import.meta.url)) });
    await launcher.click();
    await page.getByRole('tab', { name: 'Overview', exact: true }).waitFor();
    await page.getByText('AI Gateway', { exact: true }).last().waitFor();
    await page.getByRole('tab', { name: 'Database', exact: true }).click();
    await page.locator('.neon-panel tbody tr').first().waitFor();
    await page.getByRole('tab', { name: 'Users', exact: true }).click();
    await page.locator('.neon-panel tbody tr').first().waitFor();
    await page.getByRole('tab', { name: 'Overview', exact: true }).click();
    await page.locator('.neon-panel .neon-service').nth(5).waitFor();
    const assertPanelLayout = async () => {
      const layout = await page.locator('.neon-panel').evaluate(panel => {
        const nav = panel.querySelector('.neon-nav').getBoundingClientRect();
        const head = panel.querySelector('.neon-head').getBoundingClientRect();
        const main = panel.querySelector('.neon-main').getBoundingClientRect();
        const bounds = panel.getBoundingClientRect();
        const wrapper = panel.parentElement;
        return { left: bounds.left, right: bounds.right, bottom: bounds.bottom, navTop: nav.top, headBottom: head.bottom, mainBottom: main.bottom, outerOverflow: wrapper.scrollHeight - wrapper.clientHeight, viewportWidth: innerWidth, viewportHeight: innerHeight };
      });
      assert(layout.left >= 0 && layout.right <= layout.viewportWidth && layout.bottom <= layout.viewportHeight, 'Dialog exceeds viewport');
      assert(layout.navTop >= layout.headBottom - 1, 'Navigation overlaps panel header');
      assert(layout.mainBottom <= layout.bottom + 1 && layout.outerOverflow <= 1, 'Nested modal overflow');
    };
    await assertPanelLayout();
    await page.setViewportSize({ width: 390, height: 700 });
    await assertPanelLayout();
    await page.screenshot({ path: fileURLToPath(new URL('../artifacts/core-neon-panel-mobile.png', import.meta.url)) });
    await page.setViewportSize({ width: 1160, height: 754 });
    await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL('../artifacts/core-neon-panel.png', import.meta.url)) });
    assert.deepEqual(errors, []);
  });
  await rpc('delete_connection', { id: connectionId }); connectionId = undefined;
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await writeFile(new URL('../artifacts/host-e2e.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
} catch (error) {
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: fileURLToPath(new URL('../artifacts/core-neon-failure.png', import.meta.url)) }).catch(() => {});
  console.error(error.message); process.exitCode = 1;
} finally {
  if (connectionId && cookie && csrf) await rpc('delete_connection', { id: connectionId }).catch(() => {});
  if (browser) await browser.close();
  server.kill('SIGTERM');
  if (server.exitCode === null && server.signalCode === null) await new Promise(resolve => server.once('exit', resolve));
  await log.close();
  await rm(temp, { recursive: true, force: true });
}
