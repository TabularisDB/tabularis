#!/usr/bin/env node
// Compare two production builds in an isolated Chromium profile. Tauri IPC is
// simulated with identical fixtures; these are frontend timings, not native app
// launch timings. No account, saved connection, or installed app data is read.
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';

const [before, after, output = '/tmp/tabularis-startup-metrics.json', repetitions = '7'] = process.argv.slice(2);
if (!before || !after) throw new Error('Usage: node scripts/benchmark-startup.mjs BEFORE_BUILD AFTER_BUILD [OUTPUT_JSON] [REPETITIONS]');
const chrome = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const builds = { before: resolve(before), after: resolve(after) };
const profile = await mkdtemp(join(tmpdir(), 'tabularis-startup-browser-'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const label = url.searchParams.get('build') ?? request.headers.cookie?.match(/build=(before|after)/)?.[1] ?? 'after';
  const root = builds[label] ?? builds.after;
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const path = resolve(root, relative || 'index.html');
  if (path !== root && !path.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
  try {
    const data = await readFile(path).catch((error) => {
      if (!extname(relative)) return readFile(join(root, 'index.html'));
      throw error;
    });
    response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? (extname(relative) ? 'application/octet-stream' : 'text/html'),
      'Cache-Control': 'no-store', 'Set-Cookie': `build=${label}; Path=/`, 'Content-Length': data.length });
    response.end(data);
  } catch { response.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe'] });

let nextId = 0;
const pending = new Map();
const events = new Map();
let socket;
function send(method, params = {}, sessionId) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
function fixture() {
  const commands = [];
  const fetches = [];
  const missing = [];
  const errors = [];
  window.__startupBenchmark = { commands, fetches, missing, errors, ready: null };
  localStorage.clear();
  localStorage.setItem('i18nextLng', 'en');
  window.isTauri = true;
  let callbackId = 0;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  const capabilities = { schemas: false, views: true, routines: false, triggers: false, file_based: true,
    identifier_quote: '"', sql_dialect: 'sqlite', alter_column: false, create_foreign_keys: false };
  const drivers = [{ id: 'sqlite', name: 'SQLite', version: '1.0', description: '', default_port: null,
    is_builtin: true, icon: 'sqlite', color: '#06b6d4', capabilities }];
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback() { return ++callbackId; },
    unregisterCallback() {},
    convertFileSrc: (path) => path,
    async invoke(command, args) {
      commands.push({ command, at: performance.now() });
      // Match asynchronous IPC latency in both builds.
      await new Promise((done) => setTimeout(done, 5));
      if (command === 'get_config') return { language: 'en', theme: 'tabularis-dark', aiEnabled: false,
        autoConnectLastConnection: false, showWelcome: false, activeExternalDrivers: [] };
      if (command === 'get_connections_with_groups') return { connections: [], groups: [] };
      if (command === 'get_registered_drivers') return drivers;
      if (command === 'get_driver_manifest') return drivers[0];
      if (command === 'get_query_history') return { entries: [] };
      if (command === 'get_keybindings') return {};
      if (command === 'get_mcp_config') return '{}';
      if (command === 'get_mcp_status') return [{ client_id: 'cursor', client_name: 'Cursor', installed: false,
        config_path: null, executable_path: 'tabularis', client_type: 'config' }];
      if (command === 'get_app_version' || command === 'plugin:app|version') return '0.24.0';
      if (command === 'plugin:window|theme') return 'dark';
      if (command === 'plugin:window|scale_factor') return 1;
      if (command === 'plugin:path|resolve_directory') return '/tmp/tabularis-benchmark';
      if (command === 'is_debug_mode' || command === 'check_ai_key') return false;
      if (command === 'consume_pending_deep_link_install' || command === 'get_last_active_connection') return null;
      if (command.startsWith('plugin:event|')) return ++callbackId;
      if (command.startsWith('plugin:window|') || command.startsWith('set_') || command === 'save_config') return null;
      if (['get_all_themes', 'get_installed_plugins', 'get_connections', 'get_active_connections', 'get_active_connection_ids', 'get_global_active_connections',
        'get_saved_queries', 'get_last_open_connections', 'list_connection_tags', 'list_pending_approvals',
        'get_plugin_runtime_warnings', 'get_plugin_startup_errors', 'fetch_plugin_registry', 'get_ai_activity', 'get_ai_sessions',
        'get_ssh_connections', 'get_k8s_connections'].includes(command)) return [];
      missing.push({ command, args });
      throw new Error(`Unmocked benchmark IPC: ${command}`);
    },
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url && /^https?:/.test(url) && !url.startsWith(location.origin)) {
      fetches.push(url);
      return Promise.resolve(new Response('', { status: 200 }));
    }
    return nativeFetch(input, options);
  };
  addEventListener('error', (event) => errors.push(event.message));
  addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
  const observer = new MutationObserver(() => {
    if (!document.querySelector('h1')?.textContent?.includes('Connections')) return;
    observer.disconnect();
    requestAnimationFrame(() => requestAnimationFrame(() => { window.__startupBenchmark.ready = performance.now(); }));
  });
  observer.observe(document, { childList: true, subtree: true });
}

async function assets(root) {
  const manifest = JSON.parse(await readFile(join(root, '.vite/manifest.json'), 'utf8'));
  const seen = new Set();
  const css = new Set();
  function visit(key) {
    if (seen.has(key)) return;
    seen.add(key);
    manifest[key].imports?.forEach(visit);
    manifest[key].css?.forEach((file) => css.add(file));
  }
  visit('index.html');
  const files = await Promise.all([...seen].map(async (key) => {
    const file = manifest[key].file;
    const data = await readFile(join(root, file));
    return { file, bytes: data.length, gzipBytes: gzipSync(data).length };
  }));
  const cssBytes = (await Promise.all([...css].map(async (file) => (await readFile(join(root, file))).length))).reduce((a, b) => a + b, 0);
  return { jsBytes: files.reduce((sum, file) => sum + file.bytes, 0), gzipJsBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0), cssBytes, files };
}

try {
  const endpoint = await new Promise((resolve, reject) => {
    let stderr = '';
    browser.stderr.on('data', (data) => {
      stderr += String(data);
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
    browser.on('error', reject);
    browser.on('exit', (code) => reject(new Error(`Chrome exited (${code}): ${stderr.slice(-1500)}`)));
  });
  socket = new WebSocket(endpoint);
  await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const waiting = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiting?.reject(new Error(JSON.stringify(message.error)));
      else waiting?.resolve(message.result);
    } else events.get(message.sessionId)?.(message);
  };
  const result = { methodology: 'Production frontend in headless Chromium, fresh incognito context per run, cache disabled, no CPU throttling, empty connections, AI off, auto-connect off, 5ms simulated IPC. Alternating before/after. Not a native Tauri launch benchmark.',
    browser: await send('Browser.getVersion'), before: { assets: await assets(builds.before), runs: [] }, after: { assets: await assets(builds.after), runs: [] } };
  for (let run = 0; run < Number(repetitions); run++) {
    for (const label of run % 2 ? ['after', 'before'] : ['before', 'after']) {
      const { browserContextId } = await send('Target.createBrowserContext');
      const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      await send('Runtime.enable', {}, sessionId);
      await send('Network.enable', {}, sessionId);
      await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${fixture.toString()})();` }, sessionId);
      await send('Page.navigate', { url: `${origin}/?build=${label}` }, sessionId);
      let data;
      for (let attempt = 0; attempt < 150; attempt++) {
        const evaluation = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__startupBenchmark)', returnByValue: true }, sessionId);
        if (evaluation.result.value) data = JSON.parse(evaluation.result.value);
        if (data?.ready) break;
        await delay(100);
      }
      if (!data?.ready) {
        const body = await send('Runtime.evaluate', { expression: 'document.body.innerText.slice(0,1500)', returnByValue: true }, sessionId);
        throw new Error(`App did not render: ${JSON.stringify({ data, body: body.result.value })}`);
      }
      // Use a fixed post-ready window for comparable bootstrap call counts.
      await delay(500);
      const evaluation = await send('Runtime.evaluate', { expression: `JSON.stringify({ ...window.__startupBenchmark,
        paints: performance.getEntriesByType('paint').map(({ name, startTime }) => ({ name, startTime })),
        js: performance.getEntriesByType('resource').filter((entry) => new URL(entry.name).pathname.endsWith('.js')).map(({ name, decodedBodySize }) => ({ name: new URL(name).pathname, bytes: decodedBodySize })) })`, returnByValue: true }, sessionId);
      data = JSON.parse(evaluation.result.value);
      result[label].runs.push(data);
      console.log(`${label} ${run + 1}: ready=${data.ready.toFixed(1)}ms, IPC=${data.commands.length}, unmocked=${data.missing.length}, errors=${data.errors.length}`);
      if (data.missing.length || data.errors.length) throw new Error(`Benchmark fixture incomplete: ${JSON.stringify(data)}`);
      if (process.env.STARTUP_SMOKE === '1' && label === 'after' && run === Number(repetitions) - 1) {
        await send('Runtime.evaluate', { expression: `history.pushState({}, '', '/mcp'); dispatchEvent(new PopStateEvent('popstate'));` }, sessionId);
        let editorReady = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const check = await send('Runtime.evaluate', { expression: `Boolean(document.querySelector('.monaco-editor .view-lines')?.textContent?.includes('mcpServers'))`, returnByValue: true }, sessionId);
          if (check.result.value) { editorReady = true; break; }
          await delay(100);
        }
        const state = await send('Runtime.evaluate', { expression: `JSON.stringify({ errors: window.__startupBenchmark.errors, missing: window.__startupBenchmark.missing,
          editorReady: Boolean(document.querySelector('.monaco-editor .view-lines')?.textContent?.includes('mcpServers')),
          workerConfigured: typeof window.MonacoEnvironment?.getWorker === 'function',
          externalEditorFetches: window.__startupBenchmark.fetches.filter((url) => /monaco|jsdelivr|unpkg/.test(url)),
          resources: performance.getEntriesByType('resource').filter((entry) => /monaco|worker/.test(entry.name)).map((entry) => new URL(entry.name).pathname) })`, returnByValue: true }, sessionId);
        result.smoke = JSON.parse(state.result.value);
        if (!editorReady || !result.smoke.workerConfigured || result.smoke.errors.length || result.smoke.missing.length || result.smoke.externalEditorFetches.length) {
          throw new Error(`Editor smoke failed: ${JSON.stringify(result.smoke)}`);
        }
        console.log('Smoke: lazy MCP route and offline Monaco JSON editor rendered successfully.');
      }
      await send('Target.disposeBrowserContext', { browserContextId });
    }
  }
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(`Wrote ${output}`);
} finally {
  socket?.close();
  browser.kill();
  server.close();
}
