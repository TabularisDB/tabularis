// Production-artifact integration: one build, three public prefixes, real login and browser traffic.
// Usage: TABULARIS_TEST_BINARY=/absolute/path/tabularis node scripts/web/test-runtime-base-path.mjs
import assert from 'node:assert/strict';
import {createServer, request as httpRequest} from 'node:http';
import {connect} from 'node:net';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from '@playwright/test';

const binary = process.env.TABULARIS_TEST_BINARY ?? resolve('src-tauri/target/debug/tabularis');
const webRoot = resolve('packages/web-ui/dist');
const browser = await chromium.launch({args: ['--no-sandbox']});
try {
    for (const prefix of ['/', '/workspaces/a/', '/workspaces/b/']) {
        const storage = await mkdtemp(`${tmpdir()}/tabularis-base-test-`);
        let backendPort;
        const proxy = createServer((req, res) => {
            if (!req.url.startsWith(prefix)) {
                res.writeHead(404).end();
                return;
            }
            const upstream = httpRequest(
                {
                    host: '127.0.0.1',
                    port: backendPort,
                    path: `/${req.url.slice(prefix.length)}`,
                    method: req.method,
                    headers: req.headers,
                },
                (incoming) => {
                    res.writeHead(incoming.statusCode, incoming.headers);
                    incoming.pipe(res);
                },
            );
            upstream.on('error', () => res.writeHead(502).end());
            req.pipe(upstream);
        });
        proxy.on('upgrade', (req, socket, head) => {
            const upstream = connect(backendPort, '127.0.0.1', () => {
                upstream.write(
                    `${req.method} /${req.url.slice(prefix.length)} HTTP/1.1\r\n${Object.entries(
                        req.headers,
                    )
                        .map(([k, v]) => `${k}: ${v}`)
                        .join('\r\n')}\r\n\r\n`,
                );
                if (head.length) upstream.write(head);
                socket.pipe(upstream);
                upstream.pipe(socket);
            });
            upstream.on('error', () => socket.destroy());
            socket.on('error', () => upstream.destroy());
        });
        await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
        const origin = `http://127.0.0.1:${proxy.address().port}`;
        const reservation = createServer();
        await new Promise((r) => reservation.listen(0, '127.0.0.1', r));
        backendPort = reservation.address().port;
        await new Promise((r) => reservation.close(r));
        const child = spawn(
            binary,
            [
                'web',
                '--host',
                '127.0.0.1',
                '--port',
                String(backendPort),
                '--no-open',
                '--web-root',
                webRoot,
                '--auth',
                'password',
                '--public-url',
                origin,
                '--allowed-origin',
                origin,
                '--base-path',
                prefix,
                '--connection-mode',
                'managed-only',
            ],
            {
                env: {
                    ...process.env,
                    XDG_CONFIG_HOME: `${storage}/config`,
                    XDG_DATA_HOME: `${storage}/data`,
                    TABULARIS_WEB_PASSWORD: 'runtime-base-test-password',
                    TABULARIS_PROVISIONING_TOKEN: 'runtime-base-provision-token-for-integration',
                },
                stdio: ['ignore', 'pipe', 'pipe'],
            },
        );
        let serverLog = '';
        child.stdout.on('data', (c) => (serverLog += c));
        child.stderr.on('data', (c) => (serverLog += c));
        const context = await browser.newContext();
        try {
            let ready = false;
            for (let attempt = 0; attempt < 100; attempt++) {
                if (child.exitCode !== null) throw new Error(serverLog);
                try {
                    if ((await fetch(`${origin}${prefix}healthz`)).ok) {
                        ready = true;
                        break;
                    }
                } catch {}
                await delay(100);
            }
            assert(ready, serverLog);
            const driver = prefix === '/workspaces/a/' ? 'mysql' : 'postgres';
            const provision = await fetch(
                `${origin}${prefix}api/v1/provisioning/connections/smoke`,
                {
                    method: 'PUT',
                    headers: {
                        Authorization: 'Bearer runtime-base-provision-token-for-integration',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        name: 'Runtime base smoke',
                        params: {
                            driver,
                            host: '127.0.0.1',
                            port: driver === 'mysql' ? 23306 : 25432,
                            database: 'example',
                            username: driver === 'mysql' ? 'root' : 'postgres',
                            password: 'lab-provision-secret',
                            ssl_mode: 'disable',
                        },
                    }),
                },
            );
            assert.equal(provision.status, 200, await provision.text());
            const page = await context.newPage();
            const requests = [];
            const failures = [];
            const sockets = [];

            page.on('request', (r) => {
                if (r.url().startsWith(origin)) requests.push(new URL(r.url()).pathname);
            });
            page.on('response', (r) => {
                if (r.status() >= 400 && /\/assets\//.test(r.url()))
                    failures.push(`${r.status()} ${r.url()}`);
            });
            page.on('websocket', (s) => sockets.push(s.url()));
            await page.goto(`${origin}${prefix}connections/provisioned-smoke/editor`);
            assert(new URL(page.url()).pathname === `${prefix}login`);
            assert.equal(
                await page.locator('form').getAttribute('action'),
                `${prefix}api/v1/auth/login`,
            );
            await page.locator('input[type=password]').fill('wrong-password');
            await page.locator('button[type=submit]').click();
            await page.waitForLoadState();
            assert.equal(
                await page.locator('form').getAttribute('action'),
                `${prefix}api/v1/auth/login`,
            );
            await page.locator('input[type=password]').fill('runtime-base-test-password');
            await page.locator('button[type=submit]').click();
            await page.waitForFunction(() => document.querySelector('#root')?.children.length > 0);
            await page.waitForFunction(
                () =>
                    document.querySelector('meta[name="tabularis-public-base"]')?.content ===
                    document.querySelector('base')?.getAttribute('href'),
            );
            await page.waitForTimeout(1500);
            // Database-only sessions cannot write server config. Welcome
            // dismissal must survive a reload of this exact public URL anyway.
            const welcome = page.getByRole('heading', {name: 'Join the Community', exact: true});
            await welcome.waitFor({state: 'visible'});
            const configWrites = () => requests.filter((p) => p.endsWith('/save_config')).length;
            const writesBeforeDismiss = configWrites();
            await page.getByRole('button', {name: 'Maybe later', exact: true}).click();
            await welcome.waitFor({state: 'hidden'});
            assert.equal(
                await page.evaluate(() =>
                    localStorage.getItem('tabularis:web:community-welcome-dismissed'),
                ),
                'true',
            );
            const exactUrl = page.url();
            await page.reload();
            await page
                .locator('.monaco-editor')
                .first()
                .waitFor({state: 'visible', timeout: 45000});
            assert.equal(page.url(), exactUrl);
            assert.equal(await welcome.count(), 0, 'welcome stays dismissed after reload');
            assert.equal(
                configWrites(),
                writesBeforeDismiss,
                'dismissal does not write host config',
            );
            assert.equal(await page.locator('base').getAttribute('href'), prefix);
            assert.equal(
                new URL(page.url()).pathname,
                `${prefix}connections/provisioned-smoke/editor`,
                await page.locator('body').innerText(),
            );
            const session = await page.evaluate(
                async (p) => (await fetch(`${p}api/v1/session`)).json(),
                prefix,
            );
            assert.equal(session.authenticated, true);
            const cookie = (await context.cookies()).find((c) => c.name === 'tabularis_session');
            assert.equal(cookie.path, prefix);
            const transfer = await page.evaluate(
                async ({prefix, csrf}) => {
                    const response = await fetch(`${prefix}api/v1/uploads/blobs`, {
                        method: 'POST',
                        headers: {
                            'x-tabularis-csrf': csrf,
                            'Content-Type': 'application/octet-stream',
                            'x-tabularis-file-name': 'probe.bin',
                        },
                        body: new Uint8Array([1, 2, 3]),
                    });
                    return {status: response.status, body: await response.text()};
                },
                {prefix, csrf: session.csrfToken},
            );
            assert.equal(transfer.status, 201, transfer.body);
            const token = JSON.parse(transfer.body).value.split(':').at(-1);
            const downloaded = await context.request.get(
                `${origin}${prefix}api/v1/uploads/blobs/${token}`,
            );
            assert.deepEqual([...(await downloaded.body())], [1, 2, 3]);
            const ticket = await page.evaluate(
                async (p) => (await fetch(`${p}api/v1/sandbox-ticket/probe`)).json(),
                prefix,
            );
            const guest = await context.request.get(
                `${origin}${prefix}${ticket.baseUrl.slice(1)}__guest__.html`,
            );
            assert.equal(guest.status(), 200);
            await page.goto(`${origin}${prefix}connections`);
            await page.reload();
            await page.waitForFunction(() => document.querySelector('#root')?.children.length > 0);
            assert(
                requests.some((p) => p.startsWith(`${prefix}assets/`)),
                'production assets requested',
            );
            assert(
                sockets.some((url) => new URL(url).pathname === `${prefix}api/v1/events`),
                'prefixed WebSocket connected',
            );
            assert.deepEqual(
                requests.filter((p) => !p.startsWith(prefix)),
                [],
            );
            assert.deepEqual(failures, []);
            console.log(
                `PASS ${prefix}: production assets, login retry, welcome dismissal/reload without admin config, visible editor, direct route/refresh, API, WebSocket, blob upload, sandbox guest, cookie scope`,
            );
        } finally {
            await context.close();
            child.kill('SIGTERM');
            await Promise.race([new Promise((r) => child.once('exit', r)), delay(3000)]);
            if (child.exitCode === null) child.kill('SIGKILL');
            proxy.closeAllConnections();
            await new Promise((r) => proxy.close(r));
            await rm(storage, {recursive: true, force: true});
        }
    }
} finally {
    await browser.close();
}
