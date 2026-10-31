import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, open } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// CLI credentials are test-only and opt-in; the installed plugin never reads this file.
let apiKey = process.env.NEON_API_KEY;
if (!apiKey && process.env.NEON_ACCOUNT_TEST_USE_CLI === '1') {
  const auth = JSON.parse(await readFile(join(homedir(), '.config/neon/credentials.json'), 'utf8'));
  apiKey = auth.access_token;
}
assert(typeof apiKey === 'string' && apiKey, 'Set NEON_API_KEY or explicitly permit the current CLI token with NEON_ACCOUNT_TEST_USE_CLI=1');
const projectId = process.env.NEON_ACCOUNT_TEST_PROJECT_ID ?? 'solitary-leaf-07190439';
const orgId = process.env.NEON_ACCOUNT_TEST_ORG_ID ?? 'org-empty-pine-21623834';
const branchName = process.env.NEON_ACCOUNT_TEST_BRANCH ?? 'production';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'tabularis-neon-account-'));
const config = join(temp, 'config', 'tabularis');
await mkdir(config, { recursive: true });
await writeFile(join(config, 'config.json'), JSON.stringify({ activeExternalDrivers: ['neon'], autoConnectLastConnection: false, lastOpenConnectionIds: [], lastActiveConnectionId: null, language: 'en', showWelcome: false }));
const origin = `http://127.0.0.1:${process.env.NEON_ACCOUNT_TEST_PORT ?? 3049}`;
const password = randomBytes(32).toString('base64url');
const log = await open(join(temp, 'server.log'), 'w', 0o600);
const server = spawn(resolve(root, 'src-tauri/target/debug/tabularis'), ['web', '--host', '127.0.0.1', '--port', new URL(origin).port, '--no-open', '--auth', 'password', '--allow-high-risk', '--public-url', origin, '--allowed-origin', origin, '--web-root', resolve(root, 'packages/web-ui/dist')], {
  env: { ...process.env, XDG_CONFIG_HOME: join(temp, 'config'), TABULARIS_WEB_PASSWORD: password, TABULARIS_SECRET_STORE: 'file', TABULARIS_SECRET_KEY: randomBytes(32).toString('hex'), TABULARIS_SECRET_STORE_PATH: join(temp, 'secrets.json') },
  stdio: ['ignore', log.fd, log.fd],
});
let cookie;
let csrf;
let connectionId;
let connected = false;
let browser;
const results = [];

async function rpc(command, payload) {
  const response = await fetch(`${origin}/api/v1/rpc/${command}`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json', 'x-tabularis-csrf': csrf }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!result.ok) throw new Error(`Core RPC ${command}: ${result.error?.message ?? response.status}`);
  return result.data;
}
const account = (operation, payload = {}) => rpc('plugin_account', { pluginId: 'neon', operation, ...payload });
const call = (method, args = {}) => account('call', { method, args });
async function check(name, action) { await action(); results.push({ name, result: 'PASS' }); console.log(`PASS ${name}`); }

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
  await check('Core denies unauthenticated account operations and reserves secret-bearing import calls', async () => {
    const response = await fetch(`${origin}/api/v1/rpc/plugin_account`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ pluginId: 'neon', operation: 'fields' }) });
    assert.equal(response.status, 401);
    await assert.rejects(call('account_import', {}), /reserved/);
  });
  await account('connect', { secrets: { NEON_API_KEY: apiKey } }); connected = true;
  await check('Account key is stored write-only in the host before any database connection exists', async () => {
    assert.deepEqual(await account('fields'), ['NEON_API_KEY']);
    assert.deepEqual(await rpc('get_connections'), []);
    assert.equal((await readFile(join(temp, 'secrets.json'), 'utf8')).includes(apiKey), false);
  });
  let branchId;
  let resources;
  await check('Existing organization, project, branch, database and service metadata are discovered through Core', async () => {
    const projects = await call('account_projects', { orgId });
    assert(projects.projects.some(project => project.id === projectId));
    assert.equal(JSON.stringify(projects).includes(apiKey), false);
    const branches = await call('account_branches', { projectId });
    branchId = branches.branches.find(branch => branch.name === branchName)?.id;
    assert(branchId, 'Requested test branch was not found');
    resources = await call('account_resources', { projectId, branchId });
    assert(resources.databases.length > 0);
    assert(resources.roles.length > 0);
    assert.equal(resources.services.length, 5);
    assert(resources.roles.every(role => Object.keys(role).length === 1 && typeof role.name === 'string'));
  });
  await check('Import saves SQL and discovered service credentials without returning secret values', async () => {
    const database = resources.databases.find(item => item.name === 'neondb')?.name ?? resources.databases[0].name;
    const role = resources.roles.find(item => item.name === 'neondb_owner')?.name ?? resources.roles[0].name;
    const args = { projectId, branchId, database, role, createServiceCredentials: false };
    let imported;
    if (process.env.NEON_ACCOUNT_TEST_BROWSER === '1') {
      browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable', headless: true });
      const context = await browser.newContext({colorScheme:'dark',viewport:{width:1280,height:860}});
      const split = cookie.indexOf('=');
      await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin);
      await page.getByRole('button',{name:'Connect Neon',exact:true}).click();
      const dialog = page.getByRole('dialog',{name:'Connect a Neon account',exact:true});
      await dialog.getByLabel('Organization',{exact:true}).selectOption(orgId);
      await dialog.getByLabel('Project',{exact:true}).selectOption(projectId);
      await dialog.getByLabel('Branch',{exact:true}).selectOption(branchId);
      await dialog.getByLabel('Database',{exact:true}).selectOption(database);
      await dialog.getByLabel('Database role',{exact:true}).selectOption(role);
      assert.equal(await dialog.getByRole('checkbox').isChecked(),false);
      await page.screenshot({path:resolve(root,'plugins/neon/artifacts/account-connect-resources.png')});
      const response = page.waitForResponse(response=>response.url().endsWith('/rpc/plugin_account') && response.request().postDataJSON()?.operation==='import');
      await dialog.getByRole('button',{name:'Import connection',exact:true}).click();
      imported = (await (await response).json()).data;
      await dialog.getByRole('button',{name:'Done',exact:true}).click();
      await page.getByText(imported.name,{exact:true}).waitFor();
      assert.deepEqual(errors,[]);
      await page.screenshot({path:resolve(root,'plugins/neon/artifacts/account-connect-imported.png')});
      console.log('PASS Browser resource selection, opt-in default and immediate connection-list refresh');
    } else imported = await account('import', { args });
    assert.deepEqual(Object.keys(imported).sort(), ['id', 'name', 'warnings']);
    assert.equal(JSON.stringify(imported).includes(apiKey), false);
    connectionId = imported.id;
    const saved = await rpc('get_connection_by_id', { id: connectionId });
    assert.equal(saved.params.driver, 'neon');
    assert.equal(saved.params.ssl_mode, 'verify-full');
    assert(!saved.params.password && !saved.params.connection_uri);
    const fields = await rpc('get_plugin_secret_fields', { pluginId: 'neon', connectionId });
    assert(fields.includes('NEON_PROJECT_ID'));
    assert(!fields.includes('NEON_API_KEY'));
    assert(!fields.includes('AWS_SECRET_ACCESS_KEY'));
    assert(!fields.includes('NEON_AI_GATEWAY_TOKEN'));
    const path = join(config, 'connections.json');
    const persisted = await readFile(path, 'utf8');
    assert.equal(persisted.includes(apiKey), false);
    for (const connection of JSON.parse(persisted).connections) assert(!connection.params.password && !connection.params.connection_uri);
    assert.equal((await readFile(join(temp, 'secrets.json'), 'utf8')).includes(apiKey), false);
  });
  await check('Imported Postgres and discovered Auth, Function and Realtime work through saved connection scope', async () => {
    const extension = async (method, args = {}) => {
      try { return await rpc('call_plugin_extension', { pluginId: 'neon', connectionId, method, args }); }
      catch (error) { throw new Error(`${method}: ${error instanceof Error ? error.message : 'request failed'}`); }
    };
    const status = await extension('neon_status');
    assert(status.database.rows.length > 0);
    const configured = name => status.services.some(item => item.name === name && item.configured);
    if (configured('Auth')) assert(Array.isArray((await extension('neon_auth_users')).rows));
    if (configured('Functions')) assert.equal((await extension('neon_function')).status, 200);
    if (configured('Realtime')) assert((await extension('neon_realtime_snapshot', { query: 'SELECT id, title FROM tabularis_demo.notes LIMIT 2' })).length > 0);
    assert.equal(configured('Storage'), false);
    assert.equal(configured('AI Gateway'), false);
  });
  await check('Disconnect removes account access while the imported connection remains independently usable', async () => {
    await account('disconnect'); connected = false;
    assert.deepEqual(await account('fields'), []);
    await assert.rejects(call('account_projects'), /Connect the provider account first/);
    const status = await rpc('call_plugin_extension', { pluginId: 'neon', connectionId, method: 'neon_status', args: {} });
    assert(status.database.rows.length > 0);
  });
  console.log(`PASS ${results.length} account integration checks; no cloud resources or credentials created`);
} catch (error) {
  console.error(error instanceof Error ? error.message.replaceAll(apiKey, '[account credential]') : 'Account integration test failed');
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (connectionId && cookie && csrf) await rpc('delete_connection', { id: connectionId }).catch(() => {});
  if (connected && cookie && csrf) await account('disconnect').catch(() => {});
  server.kill('SIGTERM');
  if (server.exitCode === null && server.signalCode === null) await new Promise(resolve => server.once('exit', resolve));
  await log.close();
  await rm(temp, { recursive: true, force: true });
}
