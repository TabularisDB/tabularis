import assert from 'node:assert/strict';
import {selectProviderOption} from './select.mjs';
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
      page.setDefaultTimeout(20000);
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
        await selectProviderOption(page, dialog.getByLabel('CLI profile',{exact:true}), cliProfile);
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
      assert(await dialog.getByLabel('Branch',{exact:true}).isDisabled());
      assert.equal(await dialog.getByLabel('Branch',{exact:true}).getAttribute('placeholder'),'Choose a project first');
      const controlStyle = await dialog.getByLabel('Organization',{exact:true}).evaluate(select => {
        const style = getComputedStyle(select);
        return {appearance:style.appearance,background:style.backgroundColor,height:select.getBoundingClientRect().height};
      });
      assert.equal(controlStyle.appearance,'none','Provider selection still uses the browser-painted control');
      assert(controlStyle.height>=32,'Provider selection is too small for a form');
      await page.setViewportSize({width:390,height:740});
      const form = await dialog.locator('.neon-account-form').evaluate(element=>({width:element.clientWidth,scroll:element.scrollWidth}));
      assert(form.scroll<=form.width+1,'Provider selection overflows a narrow dialog');
      await page.screenshot({path:resolve(root,'plugins/neon/artifacts/account-form-mobile.png')});
      await page.setViewportSize({width:1280,height:860});
      await page.screenshot({path:resolve(root,'plugins/neon/artifacts/provider-setup-neon.png')});
      const choose = (label,value,keyboard=false) => selectProviderOption(page, dialog.getByLabel(label,{exact:true}), value, keyboard);
      let releaseProjects;
      const projectsHeld=new Promise(resolve=>{releaseProjects=resolve;});
      let held=false;
      const delayProjects=async route=>{
        const payload=route.request().postDataJSON();
        if(!held && payload.method==='account_projects' && payload.args?.orgId===orgId){held=true;await projectsHeld;}
        await route.continue();
      };
      await page.route('**/api/v1/rpc/plugin_account',delayProjects);
      try{
        await choose('Organization',orgId);
        const project=dialog.getByLabel('Project',{exact:true});
        assert.equal(await project.getAttribute('aria-busy'),'true');
        assert(await project.isDisabled());
        assert.equal(await project.inputValue(),'Loading projects…');
        await page.screenshot({path:resolve(root,'plugins/neon/artifacts/account-projects-loading.png')});
      }finally{releaseProjects();await page.unrouteAll({behavior:'wait'});}
      const project=dialog.getByLabel('Project',{exact:true});
      await project.click();
      const popup=page.locator('[data-plugin-select-menu]');
      const bounds=await popup.boundingBox();
      assert(bounds.y>=0 && bounds.y+bounds.height<=860,'Project popup leaves the viewport');
      const hit=await popup.evaluate(element=>{const box=element.getBoundingClientRect();return element.contains(document.elementFromPoint(box.left+box.width/2,box.top+12));});
      assert(hit,'Project popup is hidden behind the setup dialog');
      await page.screenshot({path:resolve(root,'plugins/neon/artifacts/account-project-options.png')});
      await page.keyboard.press('Escape');
      assert(await dialog.isVisible(),'Escape closed the setup instead of its dropdown');
      await choose('Project',projectId);
      await choose('Branch',branchId,true);
      await choose('Database',database);
      await choose('Database role',role);
      console.log('PASS themed popup, keyboard search, Escape layering and delayed organization/project loading');
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
      await page.locator(`[data-connection-id="${imported.id}"]`).getByText(alias,{exact:true}).dblclick();
      const usageRead=page.waitForResponse(response=>response.url().endsWith('/rpc/plugin_account')&&response.request().postDataJSON()?.method==='account_usage');
      await page.locator('[data-slot="explorer.services"]').getByRole('button',{name:'Overview',exact:true}).click();
      const usageEnvelope=await(await usageRead).json();assert(usageEnvelope.ok,'Live usage request failed');
      const usageData=usageEnvelope.data;
      assert.equal(usageData.project.id,projectId);assert.equal(usageData.branch.id,branchId);assert.equal(usageData.organization.id,orgId);
      assert.equal(usageData.history.project.status,'ready');assert.equal(usageData.history.branch.status,'ready');
      assert.equal(usageData.budget.spentCents,null);
      const usage=page.locator(`[data-usage-project-id="${projectId}"][data-usage-branch-id="${branchId}"]`);
      await usage.waitFor();
      assert(await usage.getByText('Invoice totals and remaining budget are unavailable here. Check the Neon Console for billing amounts.',{exact:true}).isVisible());
      const showUsageDetails=async()=>{
        for(const title of ['Resource caps and headroom','Consumption by scope']){
          const summary=usage.locator('summary').filter({hasText:new RegExp('^'+title+'$')});
          if(!(await summary.locator('..').evaluate(element=>element.open)))await summary.click();
        }
      };
      await showUsageDetails();
      await usage.getByRole('progressbar',{name:'Branch logical size',exact:true}).waitFor();
      await page.screenshot({path:resolve(root,'plugins/neon/artifacts/usage-dark.png')});
      for(let attempt=0;attempt<60;attempt++){
        const prefs=await rpc('load_editor_preferences',{connectionId:imported.id});
        if(prefs?.tabs?.some(tab=>tab.id===prefs.active_tab_id && tab.workspaceId==='services'))break;
        if(attempt===59)throw Error('Usage overview was not persisted');
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      for(const theme of ['tabularis-light','high-contrast','tabularis-dark']){
        await rpc('save_config',{config:{theme,followSystemTheme:false}});await page.reload();await usage.waitFor();
        const collapse=page.getByRole('button',{name:'Collapse Explorer',exact:true});
        if(await collapse.count())await collapse.click();
        await showUsageDetails();await page.setViewportSize({width:390,height:740});
        await usage.scrollIntoViewIfNeeded();
        const layout=await usage.evaluate(element=>({scroll:element.scrollWidth,width:element.clientWidth}));
        await page.screenshot({path:resolve(root,`plugins/neon/artifacts/usage-${theme}-mobile.png`)});
        assert(layout.scroll<=layout.width+1,`${theme}: usage overflows the workspace (${layout.scroll}/${layout.width})`);
        await page.setViewportSize({width:1280,height:860});
      }
      await page.getByRole('button',{name:/expand explorer/i}).click();
      console.log('PASS live Usage & limits: scoped v2 metrics, real caps, unavailable invoice totals, persisted overview and three responsive themes');
      await page.locator('.neon-panel').getByRole('button',{name:'Manage branches',exact:true}).click();
      await page.locator('[data-workspace-header]').getByRole('heading',{name:'Branches',exact:true}).waitFor();
      await page.getByRole('button',{name:branchName,exact:true}).waitFor();
      assert.equal(await page.getByText(/Missing NEON_API_KEY|run neon deploy|Requires the optional NEON_PROJECT_ID/).count(),0);
      console.log('PASS Overview opens connection-scoped branch management through CLI login without a service API key');
      const consoleTarget=`https://console.neon.tech/app/projects/${projectId}/branches/${branchId}`;
      const consoleRoute=route=>route.fulfill({status:200,contentType:'text/html',body:'<title>Neon console link target</title>'});
      await context.route('https://console.neon.tech/**',consoleRoute);
      const consoleOpened=context.waitForEvent('page');
      await page.getByRole('button',{name:'Open Neon console',exact:true}).click();
      const consolePage=await consoleOpened;
      await consolePage.waitForURL(consoleTarget);
      assert.equal(consolePage.url(),consoleTarget,'Console opened another project or branch');
      await consolePage.close();
      await context.unroute('https://console.neon.tech/**',consoleRoute);
      console.log('PASS Open Neon console targets the saved connection project and branch');
      if (process.env.NEON_ACCOUNT_TEST_EDITOR === '1') {
        try {
        await page.locator('[data-slot="explorer.services"]').getByRole('button',{name:'Functions',exact:true}).click();
        await page.getByRole('button',{name:'New function',exact:true}).click();
        await selectProviderOption(page, page.getByLabel('Language',{exact:true}), 'typescript');
        console.log('PASS Function editor opened in TypeScript mode');
        const editor=page.getByRole('region',{name:'Function source',exact:true}).locator('.monaco-editor');
        await editor.waitFor();
        const replace=async source=>{
          await editor.click({position:{x:100,y:40}});
          await page.keyboard.press('ControlOrMeta+A');
          await page.keyboard.insertText(source);
        };
        await replace('const value: number = "wrong"; export default {fetch(request: Request): Response {return Response.json({value, url:request.url, env:process.env.DATABASE_URL})}}');
        await page.getByText("Type 'string' is not assignable to type 'number'.",{exact:false}).waitFor();
        assert(await page.getByRole('button',{name:'Deploy function',exact:true}).isDisabled());
        await replace('export default {fetch(request: Request): Response {return Response.json({url:request.url, env:process.env.DATABASE_URL})}}');
        const validation=page.waitForResponse(response=>response.url().endsWith('/rpc/plugin_account') && response.request().postDataJSON()?.method==='account_function_validate');
        await page.getByRole('button',{name:'Validate function',exact:true}).click();
        const envelope=await(await validation).json();assert(envelope.ok && envelope.data.valid);
        await page.getByText(/^Compilation passed/).waitFor();
        await page.screenshot({path:resolve(root,'plugins/neon/artifacts/function-editor-typescript.png')});
        await replace('export default = {');
        const invalid=page.waitForResponse(response=>response.url().endsWith('/rpc/plugin_account') && response.request().postDataJSON()?.method==='account_function_validate');
        await page.getByRole('button',{name:'Validate function',exact:true}).click();
        assert.equal((await(await invalid).json()).data.valid,false);
        assert.deepEqual(errors,[]);
        console.log('PASS real Function tab: Monaco TypeScript/Node types, live errors, deployment guard and Core syntax validation; no deployment');
        if(process.env.NEON_ACCOUNT_TEST_POLISH === '1') {
          await page.getByRole('button',{name:'Dismiss',exact:true}).click({timeout:1000}).catch(()=>{});
          await rpc('save_config',{config:{theme:'tabularis-light',followSystemTheme:false}});
          await page.reload();
          await page.getByRole('region',{name:'Function source',exact:true}).locator('.monaco-editor').waitFor();
          await page.getByRole('button',{name:'Dismiss',exact:true}).click({timeout:1000}).catch(()=>{});
          const collapse=page.getByRole('button',{name:'Collapse Explorer',exact:true});
          if(await collapse.count())await collapse.click();
          await page.setViewportSize({width:390,height:760});
          await page.getByRole('button',{name:'Validate function',exact:true}).scrollIntoViewIfNeeded();
          const mobile=await page.locator('[data-plugin-workspace]').evaluate(panel=>{
            const box=panel.getBoundingClientRect();const content=panel.querySelector('[data-workspace-content]');
            return {left:box.left,right:box.right,width:innerWidth,scroll:content.scrollWidth,client:content.clientWidth};
          });
          assert(mobile.left>=0 && mobile.right<=mobile.width+1 && mobile.scroll<=mobile.client+1,'Function form overflows the mobile workspace');
          await page.screenshot({path:resolve(root,'plugins/neon/artifacts/function-polished-light-mobile.png')});
          await page.setViewportSize({width:1280,height:860});
          await rpc('save_config',{config:{theme:'tabularis-dark',followSystemTheme:false}});
          await page.reload();
          await page.getByRole('region',{name:'Function source',exact:true}).locator('.monaco-editor').waitFor();
          await page.getByRole('button',{name:'Dismiss',exact:true}).click({timeout:1000}).catch(()=>{});
          await page.screenshot({path:resolve(root,'plugins/neon/artifacts/function-polished-dark-desktop.png')});
          console.log('PASS polished Function form: light/dark themes, 390px workspace, wrapped code, reachable toolbar and actions');
        }

        } catch(error) {
          await page.screenshot({path:resolve(root,'plugins/neon/artifacts/function-editor-failure.png')});
          console.log('Editor diagnostic:',(await page.locator('.neon-functions').innerText()).slice(0,2000));
          console.log('Browser errors:',JSON.stringify(errors));
          throw error;
        }
      }

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
