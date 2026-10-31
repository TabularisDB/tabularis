import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm,open} from 'node:fs/promises';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const projectId=process.env.NEON_ACCOUNT_TEST_PROJECT_ID ?? 'solitary-leaf-07190439';
const sourceName=process.env.NEON_ACCOUNT_TEST_BRANCH ?? 'production';
const origin='http://127.0.0.1:3051';
const temp=await mkdtemp(join(tmpdir(),'tabularis-neon-branches-'));
const config=join(temp,'config','tabularis');await mkdir(config,{recursive:true});
await writeFile(join(config,'config.json'),JSON.stringify({activeExternalDrivers:['neon'],autoConnectLastConnection:false,lastOpenConnectionIds:[],language:'en',showWelcome:false}));
const password=randomBytes(32).toString('base64url');
const log=await open(join(temp,'server.log'),'w',0o600);
const server=spawn(resolve(root,'src-tauri/target/debug/tabularis'),['web','--host','127.0.0.1','--port','3051','--no-open','--auth','password','--allow-high-risk','--public-url',origin,'--allowed-origin',origin,'--web-root',resolve(root,'packages/web-ui/dist')],{env:{...process.env,NEON_CONFIG_DIR:process.env.NEON_CONFIG_DIR??join(homedir(),'.config','neon'),XDG_CONFIG_HOME:join(temp,'config'),TABULARIS_WEB_PASSWORD:password,TABULARIS_SECRET_STORE:'file',TABULARIS_SECRET_KEY:randomBytes(32).toString('hex'),TABULARIS_SECRET_STORE_PATH:join(temp,'secrets.json')},stdio:['ignore',log.fd,log.fd]});
let cookie,csrf,browser,page,sourceId,sourceBranchId,childBranchId;
const connections=[];
const suffix=randomBytes(6).toString('hex');const childName=`tabularis-e2e-${suffix}`;const renamed=`${childName}-renamed`;const table=`tabularis_branch_${suffix}`;
let tableCreated=false;
async function rpc(command,payload){
 const response=await fetch(`${origin}/api/v1/rpc/${command}`,{method:'POST',headers:{origin,cookie,'content-type':'application/json','x-tabularis-csrf':csrf},body:JSON.stringify(payload)});
 const result=await response.json();if(!result.ok)throw Error(`Core ${command}: ${result.error?.message??response.status}`);return result.data;
}
const account=(operation,payload={})=>rpc('plugin_account',{pluginId:'neon',operation,...payload});
const call=(method,args={})=>account('call',{method,args:{projectId,branchId:sourceBranchId,...args}});
const sql=(connectionId,query)=>rpc('execute_query',{connectionId,query});
const binding=connectionId=>rpc('call_plugin_extension',{pluginId:'neon',connectionId,method:'neon_branch_context',args:{}});
const activeBranch=()=>page.getByLabel('Switch Neon branch',{exact:true});
async function waitValue(locator,value){for(let n=0;n<150;n++){if(await locator.count() && await locator.inputValue()===value)return;await new Promise(r=>setTimeout(r,200));}throw Error('Branch activation did not finish');}
try{
 for(let n=0;n<200;n++){try{if((await fetch(`${origin}/login`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const login=await fetch(`${origin}/api/v1/auth/login`,{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password}),redirect:'manual'});assert.equal(login.status,303);
 cookie=login.headers.get('set-cookie').split(';')[0];csrf=(await(await fetch(`${origin}/api/v1/session`,{headers:{cookie}})).json()).csrfToken;
 await account('connect',{secrets:{NEON_CLI_AUTH:process.env.NEON_ACCOUNT_TEST_CLI_PROFILE??'DEFAULT'}});
 sourceBranchId=(await call('account_branches')).branches.find(branch=>branch.name===sourceName)?.id;assert(sourceBranchId);
 const imported=await account('import',{args:{projectId,branchId:sourceBranchId,database:'neondb',role:'neondb_owner',createServiceCredentials:false}});sourceId=imported.id;connections.push(sourceId);
 await sql(sourceId,`CREATE TABLE public.${table} (value text NOT NULL)`);tableCreated=true;await sql(sourceId,`INSERT INTO public.${table} VALUES ('source')`);
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'/usr/bin/google-chrome-stable',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
 const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
 page=await context.newPage();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin);await page.getByRole('button',{name:'Dismiss',exact:true}).click({timeout:1000}).catch(()=>{});
 await page.getByText(imported.name,{exact:true}).dblclick();await waitValue(activeBranch(),sourceBranchId);
 const editor=page.locator('.monaco-editor:visible').first();await editor.waitFor();await editor.click({position:{x:100,y:40}});
 await page.evaluate(text=>navigator.clipboard.writeText(text),`-- source-draft-${suffix}\nSELECT * FROM public.${table};`);await page.keyboard.press('ControlOrMeta+A');await page.keyboard.press('ControlOrMeta+V');
 await page.getByRole('button',{name:'Manage branches',exact:true}).click();await page.getByRole('heading',{name:'Branches',exact:true}).waitFor();
 await page.locator('summary').filter({hasText:/^Create branch$/}).click();await page.getByLabel('Branch name',{exact:true}).fill(childName);
 const created=page.waitForResponse(response=>response.url().endsWith('/rpc/plugin_account')&&response.request().postDataJSON()?.method==='account_branch_create');
 await page.getByRole('button',{name:'Create branch',exact:true}).click();const createdResult=await(await created).json();assert(createdResult.ok,createdResult.error?.message);childBranchId=createdResult.data.id;
 await page.getByRole('button',{name:childName,exact:true}).click();await page.getByLabel('New branch name',{exact:true}).fill(renamed);
 await page.getByRole('button',{name:'Rename branch',exact:true}).click();await page.getByRole('button',{name:renamed,exact:true}).waitFor();
 console.log('PASS native branch list: explicit-parent creation, metadata and rename');
 await page.getByRole('button',{name:'Switch to branch',exact:true}).click();await waitValue(activeBranch(),childBranchId);
 const saved=await rpc('get_connections');assert.equal(saved.length,2);const childConnection=saved.find(connection=>connection.id!==sourceId);connections.push(childConnection.id);
 assert.notEqual(saved.find(connection=>connection.id===sourceId).params.host,childConnection.params.host);
 assert.equal((await binding(sourceId)).branchId,sourceBranchId);assert.equal((await binding(childConnection.id)).branchId,childBranchId);
 const childStatus=await rpc('call_plugin_extension',{pluginId:'neon',connectionId:childConnection.id,method:'neon_status',args:{}});assert.equal(childStatus.branch,renamed);assert.equal(childStatus.services.length,6);
 await sql(childConnection.id,`UPDATE public.${table} SET value='child'`);
 assert.deepEqual((await sql(sourceId,`SELECT value FROM public.${table}`)).rows,[['source']]);assert.deepEqual((await sql(childConnection.id,`SELECT value FROM public.${table}`)).rows,[['child']]);
 console.log('PASS branch switch: separate credentials/context and real parent/child SQL isolation');
 await activeBranch().selectOption(sourceBranchId);await waitValue(activeBranch(),sourceBranchId);await page.getByRole('button',{name:'Console',exact:true}).click();
 await page.locator('.monaco-editor:visible').first().getByText(`source-draft-${suffix}`,{exact:false}).first().waitFor();
 assert((await rpc('load_editor_preferences',{connectionId:sourceId})).tabs.some(tab=>tab.query?.includes(`source-draft-${suffix}`)));
 assert.equal((await rpc('get_connections')).length,2);
 await activeBranch().selectOption(childBranchId);await waitValue(activeBranch(),childBranchId);assert.equal((await rpc('get_connections')).length,2);
 console.log('PASS repeat switch reuses exact branch connection; original SQL draft stays on its source');
 await page.getByRole('button',{name:'Manage branches',exact:true}).click();await page.getByRole('button',{name:'Open in new connection',exact:true}).click();
 for(let n=0;n<150;n++){if((await rpc('get_connections')).length===3)break;await new Promise(r=>setTimeout(r,200));}
 await waitValue(activeBranch(),childBranchId);
 const copies=(await rpc('get_connections')).filter(connection=>connection.id!==sourceId);assert.equal(copies.length,2);
 const additional=copies.find(connection=>connection.id!==childConnection.id);await page.waitForFunction(id=>document.querySelector('.neon-branch-picker')?.getAttribute('data-connection-id')===id,additional.id);
 for(const connection of copies){if(!connections.includes(connection.id))connections.push(connection.id);assert.equal((await binding(connection.id)).branchId,childBranchId);}
 console.log('PASS explicit new-connection action creates an independent additional connection');
 await activeBranch().selectOption(sourceBranchId);await waitValue(activeBranch(),sourceBranchId);await page.getByRole('button',{name:'Manage branches',exact:true}).click();await page.getByRole('button',{name:renamed,exact:true}).click();
 await waitValue(page.getByLabel('Database',{exact:true}),'neondb');await waitValue(page.getByLabel('Database role',{exact:true}),'neondb_owner');
 await page.locator('summary').filter({hasText:/^Delete branch$/}).click();assert(await page.getByRole('button',{name:'Delete branch',exact:true}).isDisabled());
 await page.screenshot({path:resolve(root,'plugins/neon/artifacts/branches-management.png')});
 console.log('PASS deletion is blocked while local branch connections still exist');
 for(const connection of copies){await rpc('delete_connection',{id:connection.id});connections.splice(connections.indexOf(connection.id),1);}
 await page.reload();await page.getByRole('button',{name:'Dismiss',exact:true}).click({timeout:1000}).catch(()=>{});
 await page.getByRole('button',{name:'Manage branches',exact:true}).waitFor({timeout:5000}).catch(async()=>{await page.locator(`[data-connection-id="${sourceId}"]`).getByText(imported.name,{exact:true}).dblclick();});
 await waitValue(activeBranch(),sourceBranchId);await page.getByRole('button',{name:'Manage branches',exact:true}).click();await page.getByRole('button',{name:renamed,exact:true}).click();
 const disclosure=page.locator('summary').filter({hasText:/^Delete branch$/});if(!(await disclosure.locator('..').evaluate(element=>element.open)))await disclosure.click();
 await page.getByRole('button',{name:'Delete branch',exact:true}).click();await page.getByLabel(`Type “${renamed}” to confirm deletion`,{exact:true}).fill('wrong');assert(await page.getByRole('button',{name:'Permanently delete branch',exact:true}).isDisabled());
 await page.getByLabel(`Type “${renamed}” to confirm deletion`,{exact:true}).fill(renamed);
 const deleted=page.waitForResponse(response=>response.url().endsWith('/rpc/plugin_account')&&response.request().postDataJSON()?.method==='account_branch_delete');await page.getByRole('button',{name:'Permanently delete branch',exact:true}).click();const deletion=await(await deleted).json();assert(deletion.ok,deletion.error?.message);childBranchId=undefined;
 assert(!(await call('account_branch_list')).branches.some(branch=>branch.name===renamed));assert.deepEqual(errors,[]);
 console.log('PASS exact-name confirmation deletes only the unused disposable branch; no browser errors');
}catch(error){await page?.screenshot({path:resolve(root,'plugins/neon/artifacts/branches-failure.png')}).catch(()=>{});console.error(error.message);process.exitCode=1;}
finally{
 if(tableCreated&&sourceId)await sql(sourceId,`DROP TABLE IF EXISTS public.${table}`).catch(error=>{console.error('Parent test table cleanup failed:',error.message);process.exitCode=1;});
 for(const connectionId of connections.slice().reverse())await rpc('delete_connection',{id:connectionId}).catch(()=>{});
 if(sourceBranchId){const rows=(await call('account_branch_list').catch(()=>({branches:[]}))).branches;const child=rows.find(branch=>branch.id!==sourceBranchId && (branch.id===childBranchId || branch.name===childName || branch.name===renamed));if(child)await call('account_branch_delete',{targetBranchId:child.id,confirmName:child.name}).catch(error=>{console.error('Temporary branch cleanup failed:',error.message);process.exitCode=1;});}
 await account('disconnect').catch(()=>{});await browser?.close();server.kill('SIGTERM');if(server.exitCode===null&&server.signalCode===null)await new Promise(resolve=>server.once('exit',resolve));await log.close();await rm(temp,{recursive:true,force:true});
 console.log('Branch E2E cleanup completed');
}
