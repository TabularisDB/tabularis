import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, open } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// The CLI path uses only a linked profile. The API-key regression can explicitly reuse a test bearer.
const cliMode = process.env.NEON_ACCOUNT_TEST_AUTH_MODE === 'cli';
let apiKey = process.env.NEON_API_KEY;
if (!cliMode && !apiKey && process.env.NEON_ACCOUNT_TEST_USE_CLI === '1') {
  const auth = JSON.parse(await readFile(join(homedir(), '.config/neon/credentials.json'), 'utf8'));
  apiKey = auth.access_token;
}
assert(cliMode || typeof apiKey === 'string' && apiKey, 'Set NEON_API_KEY or explicitly select a CLI profile test');
const cliProfile = process.env.NEON_ACCOUNT_TEST_CLI_PROFILE ?? 'DEFAULT';
const linkedSecrets = cliMode ? {NEON_CLI_AUTH:cliProfile} : {NEON_API_KEY:apiKey};
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
  env: { ...process.env, ...(cliMode ? {NEON_CONFIG_DIR:process.env.NEON_CONFIG_DIR ?? join(homedir(),'.config','neon')} : {}), XDG_CONFIG_HOME: join(temp, 'config'), TABULARIS_WEB_PASSWORD: password, TABULARIS_SECRET_STORE: 'file', TABULARIS_SECRET_KEY: randomBytes(32).toString('hex'), TABULARIS_SECRET_STORE_PATH: join(temp, 'secrets.json') },
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
  if(cliMode){
    const status=await account('prepare',{method:'account_cli_status',args:{profile:cliProfile}});
    assert(status.installed && status.canReuse,'No reusable CLI sign-in on the selected profile');
    const selected=await account('prepare',{method:'account_cli_use',args:{profile:cliProfile}});
    assert.equal(selected.profile,cliProfile);
    console.log('PASS CLI preparation/reuse before linking returns only a profile reference');
  }
  await account('connect', { secrets: linkedSecrets }); connected = true;
  await check('Account key is stored write-only in the host before any database connection exists', async () => {
    assert.deepEqual(await account('fields'), [cliMode ? 'NEON_CLI_AUTH' : 'NEON_API_KEY']);
    assert.deepEqual(await rpc('get_connections'), []);
    assert.equal((await readFile(join(temp, 'secrets.json'), 'utf8')).includes(apiKey ?? '[no token in CLI test]'), false);
  });
  let branchId;
  let resources;
  await check('Existing organization, project, branch, database and service metadata are discovered through Core', async () => {
    const projects = await call('account_projects', { orgId });
    assert(projects.projects.some(project => project.id === projectId));
    assert.equal(JSON.stringify(projects).includes(apiKey ?? '[no token in CLI test]'), false);
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
      await account('disconnect'); connected=false;
      await page.goto(origin);
      assert.equal(await page.getByRole('button',{name:'Connect Neon',exact:true}).count(),0,'Neon still has a global connection-page launcher');
      await page.getByRole('button',{name:'Add Connection',exact:true}).first().click();
      await page.getByRole('button',{name:'Connect to Neon',exact:true}).click();
      const dialog = page.locator('[data-slot="connection-modal.setup"]');
      await dialog.getByText('Connect your Neon workspace',{exact:true}).waitFor();
      if(cliMode){
        await dialog.getByRole('button',{name:'Use signed-in Neon CLI account',exact:true}).click();
        await dialog.getByText('Neon CLI account connected',{exact:true}).waitFor();
        assert.deepEqual(await account('fields'),['NEON_CLI_AUTH']);
        console.log('PASS Add Connection links installed CLI login without an API-key field or copied bearer');
      }else{
        await dialog.getByRole('button',{name:'Use API key',exact:true}).click();
        await dialog.getByLabel('Neon API key',{exact:true}).fill(apiKey);
        await dialog.getByRole('button',{name:'Connect account',exact:true}).click();
        await dialog.getByText('Account connected',{exact:true}).waitFor();
      }
      connected=true;
      assert.equal(await dialog.locator('input[type="password"]').count(),0,'Key draft was not cleared from the completed auth form');
      assert.equal(await page.getByText(/^Connection string$/i).count(),0);
      assert.equal(await page.getByRole('button',{name:'Test Connection',exact:true}).count(),0);
      assert.equal(await page.getByRole('button',{name:'Save',exact:true}).count(),0);
      await page.screenshot({path:resolve(root,'plugins/neon/artifacts/provider-setup-neon.png')});
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
      await page.locator(`[data-connection-id="${imported.id}"]`).getByTitle('Edit').click();
      const editing=page.locator('[data-slot="connection-modal.setup"]');
      await editing.getByText('Linked Neon connection',{exact:true}).waitFor();
      await editing.getByText(projectId,{exact:true}).waitFor();
      assert.equal(await editing.getByRole('button',{name:'Import connection',exact:true}).count(),0,'Edit offers duplicate account import');
      assert.equal(await page.getByRole('button',{name:'Test Connection',exact:true}).count(),0);
      await page.screenshot({path:resolve(root,'plugins/neon/artifacts/provider-setup-neon-edit.png')});
      const alias=imported.name+' · alias';
      await page.getByPlaceholder('Provide your connection name',{exact:true}).fill(alias);
      await page.getByRole('button',{name:'Save',exact:true}).click();
      await page.getByText(alias,{exact:true}).waitFor();
      console.log('PASS Editing keeps Neon account setup and preserves SQL/service credentials while renaming metadata');
      assert.deepEqual(errors,[]);
      await page.screenshot({path:resolve(root,'plugins/neon/artifacts/account-connect-imported.png')});
      console.log('PASS Add Connection → Neon plugin auth, branch/service selection and immediate connection-list refresh');
    } else imported = await account('import', { args });
    assert.deepEqual(Object.keys(imported).sort(), ['id', 'name', 'warnings']);
    assert.equal(JSON.stringify(imported).includes(apiKey ?? '[no token in CLI test]'), false);
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
    assert.equal(persisted.includes(apiKey ?? '[no token in CLI test]'), false);
    for (const connection of JSON.parse(persisted).connections) assert(!connection.params.password && !connection.params.connection_uri);
    assert.equal((await readFile(join(temp, 'secrets.json'), 'utf8')).includes(apiKey ?? '[no token in CLI test]'), false);
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
  console.error(error instanceof Error ? (apiKey ? error.message.replaceAll(apiKey, '[account credential]') : error.message) : 'Account integration test failed');
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
