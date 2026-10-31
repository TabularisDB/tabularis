import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {chromium, request} from '@playwright/test';
import {createRealtimeClient} from '@neon/realtime/client';
import WebSocket from 'ws';

const origin = process.env.APP_ORIGIN || 'http://127.0.0.1:3008';
const records = [];
const clients = [];
const liveClients = [];
const suffix = `${Date.now()}-${randomBytes(3).toString('hex')}`;
function pass(check) {
    records.push({check, result: 'PASS'});
    console.log(`PASS ${check}`);
}
async function context() {
    const c = await request.newContext({
        baseURL: origin,
        extraHTTPHeaders: {Origin: origin},
    });
    clients.push(c);
    return c;
}
async function json(c, path, method = 'GET', data, expected = 200) {
    const r = await c.fetch(path, {
        method,
        headers: {Origin: origin},
        ...(data === undefined ? {} : {data}),
    });
    assert.equal(
        r.status(),
        expected,
        `${method} ${path}: expected ${expected}, received ${r.status()}`,
    );
    return r.json();
}
async function eventually(predicate, label, timeout = 25000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out: ${label}`);
}
async function account(name) {
    const c = await context();
    const credentials = {
        name,
        email: `fieldnotes-${name.toLowerCase()}-${suffix}@example.com`,
        password: randomBytes(22).toString('base64url'),
    };
    const result = await json(c, '/api/auth/sign-up/email', 'POST', credentials);
    assert(result.user?.id);
    return {c, credentials, user: result.user};
}
let browser;
let project;
let note;
try {
    const anon = await context();
    for (const [path, method] of [
        ['session', 'GET'],
        ['projects', 'GET'],
        ['notes', 'GET'],
        ['live', 'POST'],
        ['notes', 'POST'],
    ])
        await json(anon, `/api/workspace/${path}`, method, undefined, 401);
    const protectedPage = await anon.get('/workspace', {maxRedirects: 0});
    assert([302, 307].includes(protectedPage.status()));
    assert(protectedPage.headers().location.includes('/auth/sign-in'));
    pass('Protected pages redirect; direct unauthenticated APIs reject callers');

    const a = await account('ResearcherA');
    const b = await account('ResearcherB');
    const session = await json(a.c, '/api/workspace/session');
    assert.equal(session.user.id, a.user.id);
    await json(a.c, '/api/auth/sign-out', 'POST', {});
    await json(a.c, '/api/workspace/session', 'GET', undefined, 401);
    const wrong = await a.c.post('/api/auth/sign-in/email', {
        data: {email: a.credentials.email, password: 'incorrect-password'},
    });
    assert.equal(wrong.status(), 401);
    await json(a.c, '/api/auth/sign-in/email', 'POST', {
        email: a.credentials.email,
        password: a.credentials.password,
    });
    assert.equal((await json(a.c, '/api/workspace/session')).user.id, a.user.id);
    pass('Managed Auth sign-up, sign-out, wrong password, sign-in, and restored server session');

    project = await json(
        a.c,
        '/api/workspace/projects',
        'POST',
        {name: `E2E research ${suffix}`, color: '#5577ca'},
        201,
    );
    const input = {
        title: 'Interview synthesis',
        body: 'We interviewed six researchers. Four wanted a calm space for notes and source documents. Two asked for live updates across devices. The next step is a focused usability study with three participants.',
        project_id: project.id,
    };
    const liveA = await json(a.c, '/api/workspace/live', 'POST');
    const liveB = await json(b.c, '/api/workspace/live', 'POST');
    function subscribe(sealed) {
        const client = createRealtimeClient({
            url: sealed.url,
            webSocketFactory: (url, protocols) => new WebSocket(url, protocols, {origin}),
        });
        liveClients.push(client);
        return client.subscribe(sealed.query);
    }
    const subA = subscribe(liveA),
        subB = subscribe(liveB);
    await eventually(
        () => subA.getSnapshot().status === 'live' && subB.getSnapshot().status === 'live',
        'both real live subscriptions',
    );
    note = await json(a.c, '/api/workspace/notes', 'POST', input, 201);
    await subA.awaitTxId(note.txid, 25000);
    assert(subA.getSnapshot().data.some((row) => row.id === note.id));
    assert(!subB.getSnapshot().data.some((row) => row.id === note.id));
    const updated = await json(a.c, `/api/workspace/notes/${note.id}`, 'PUT', {
        ...input,
        body: input.body + ' Keep the prototype small and test the whole workflow.',
    });
    await subA.awaitTxId(updated.txid, 25000);
    assert.equal(subA.getSnapshot().data.find((row) => row.id === note.id).body, updated.body);
    assert.equal((await json(a.c, `/api/workspace/notes/${note.id}`)).body, updated.body);
    pass(
        'Postgres create/read/update and real WebSocket insert/update delivery; other user sees no rows',
    );

    for (const [path, method, data] of [
        [`notes/${note.id}`, 'GET'],
        [`notes/${note.id}`, 'PUT', input],
        [`notes/${note.id}`, 'DELETE'],
        [`notes/${note.id}/summary`, 'POST'],
        [`notes/${note.id}/analyze`, 'POST'],
        [`notes/${note.id}/attachments`, 'GET'],
    ])
        await json(b.c, `/api/workspace/${path}`, method, data, 404);
    await json(b.c, '/api/workspace/notes', 'POST', input, 404);
    const originDenied = await a.c.post('/api/workspace/projects', {
        headers: {Origin: 'https://untrusted.example'},
        data: {name: 'Denied'},
    });
    assert.equal(originDenied.status(), 403);
    const sessionMismatch = await a.c.get('/api/workspace/session', {
        headers: {'x-workspace-user': b.user.id},
    });
    assert.equal(sessionMismatch.status(), 409);
    pass(
        'Cross-user reads/writes/AI/Function/attachment access, foreign project, wrong origin, and changed-session writes rejected',
    );

    const contents = 'Research evidence from a real private Neon S3 upload.\n';
    const upload = await a.c.post(`/api/workspace/notes/${note.id}/attachments`, {
        multipart: {
            file: {
                name: 'research-evidence.txt',
                mimeType: 'text/plain',
                buffer: Buffer.from(contents),
            },
        },
    });
    assert.equal(upload.status(), 201, await upload.text());
    const file = await upload.json();
    assert.equal((await json(a.c, `/api/workspace/notes/${note.id}/attachments`))[0].id, file.id);
    const download = await a.c.get(`/api/workspace/attachments/${file.id}`);
    assert.equal(download.status(), 200);
    assert.equal(await download.text(), contents);
    await json(b.c, `/api/workspace/attachments/${file.id}`, 'GET', undefined, 404);
    await json(b.c, `/api/workspace/attachments/${file.id}`, 'DELETE', undefined, 404);
    const foreignUpload = await b.c.post(`/api/workspace/notes/${note.id}/attachments`, {
        multipart: {
            file: {
                name: 'denied.txt',
                mimeType: 'text/plain',
                buffer: Buffer.from('denied'),
            },
        },
    });
    assert.equal(foreignUpload.status(), 404);
    const direct = await fetch(
        `${process.env.AWS_ENDPOINT_URL_S3}/${process.env.NEON_STORAGE_BUCKET || 'assets'}/tabularis-demo/${a.user.id}/${note.id}/${file.id}`,
    );
    assert(
        [401, 403].includes(direct.status),
        `Private object anonymously returned ${direct.status}`,
    );
    await json(a.c, `/api/workspace/attachments/${file.id}`, 'DELETE');
    pass(
        'Private Object Storage upload, exact download, listing, deletion, and anonymous/cross-user denials',
    );

    const summary = await json(a.c, `/api/workspace/notes/${note.id}/summary`, 'POST');
    assert(summary.summary.length > 20);
    assert(summary.model);
    assert.equal((await json(a.c, `/api/workspace/notes/${note.id}`)).summary, summary.summary);
    pass('AI Gateway generates a real persisted note summary');

    assert(
        process.env.NEON_FUNCTION_DEMO_BASE_URL,
        'NEON_FUNCTION_DEMO_BASE_URL is required; no service is skipped',
    );
    const analysis = await json(a.c, `/api/workspace/notes/${note.id}/analyze`, 'POST');
    assert.equal(analysis.service, 'Neon Functions');
    assert.equal(analysis.ownerId, a.user.id);
    assert(analysis.words > 10);
    const noToken = await fetch(process.env.NEON_FUNCTION_DEMO_BASE_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({noteId: note.id}),
    });
    assert.equal(noToken.status, 401);
    const badToken = await fetch(process.env.NEON_FUNCTION_DEMO_BASE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer invalid',
        },
        body: JSON.stringify({noteId: note.id}),
    });
    assert.equal(badToken.status, 401);
    const tokenB = await json(b.c, '/api/auth/token');
    const denied = await fetch(process.env.NEON_FUNCTION_DEMO_BASE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokenB.token}`,
        },
        body: JSON.stringify({noteId: note.id}),
    });
    assert.equal(denied.status, 404);
    pass(
        'Deployed Function verifies real JWT, analyzes owned stored note, rejects missing/invalid token and foreign note',
    );

    browser = await chromium.launch({
        executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable',
        headless: true,
        args: ['--no-sandbox'],
    });
    const saved = JSON.parse(
        await readFile(new URL('../artifacts/demo-user.json', import.meta.url), 'utf8'),
    );
    const page = await browser.newPage({
        baseURL: origin,
        viewport: {width: 1440, height: 1050},
    });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(`${origin}/auth/sign-in`);
    await page.getByLabel('Email address').fill(saved.email);
    await page.getByLabel('Password', {exact: true}).fill(saved.password);
    await page.getByRole('button', {name: 'Sign in', exact: true}).click();
    await page.waitForURL('**/workspace');
    await page.getByText('Live updates connected', {exact: true}).waitFor({timeout: 30000});
    await page.reload();
    await page.getByText('Your thinking, in one place.', {exact: true}).waitFor();
    const browserProjects = await json(page.request, '/api/workspace/projects');
    const browserNote = await json(
        page.request,
        '/api/workspace/notes',
        'POST',
        {
            title: `Editor regression ${suffix}`,
            body: 'A short research note for the browser regression.',
            project_id: browserProjects[0].id,
        },
        201,
    );
    await page.locator('.note-card').filter({hasText: browserNote.title}).click();
    await page
        .locator('.editor')
        .evaluate((element) => element.setAttribute('data-regression-mount', 'original'));
    const summaryDraft =
        'Three researchers asked for a calmer writing space. Two wanted private source documents. Next week we will test a focused prototype with three participants.';
    await page.getByLabel('Note body', {exact: true}).fill(summaryDraft);
    await page.getByRole('button', {name: 'Summarize note', exact: true}).click();
    await page.locator('.summary-box p').waitFor({timeout: 60000});
    assert.equal(
        await page.locator('.editor').getAttribute('data-regression-mount'),
        'original',
        'Saving before summary must preserve the mounted editor',
    );
    assert.equal(
        (await json(page.request, `/api/workspace/notes/${browserNote.id}`)).body,
        summaryDraft,
    );
    const insightsDraft = `${summaryDraft} We also need a clear decision log and immediate updates across devices.`;
    await page.getByRole('button', {name: 'Summarize note', exact: true}).waitFor();
    await page.getByLabel('Note body', {exact: true}).fill(insightsDraft);
    await page.getByRole('button', {name: 'Reading insights', exact: true}).click();
    await page.locator('.analysis-result').waitFor({timeout: 40000});
    assert.equal(
        await page.locator('.editor').getAttribute('data-regression-mount'),
        'original',
        'Saving before insights must preserve the mounted editor',
    );
    assert.equal(
        (await json(page.request, `/api/workspace/notes/${browserNote.id}`)).body,
        insightsDraft,
    );
    pass(
        'Dirty-note summary and Function insights save first, remain visible, and preserve editor identity',
    );
    const localDraft = `${insightsDraft} This local draft must survive a remote edit.`;
    await page.getByLabel('Note body', {exact: true}).fill(localDraft);
    const remoteDraft = 'A different device committed this research update.';
    await json(page.request, `/api/workspace/notes/${browserNote.id}`, 'PUT', {
        title: browserNote.title,
        body: remoteDraft,
        project_id: browserNote.project_id,
    });
    await page.getByText('This note changed elsewhere. Your unsaved text is safe.').waitFor();
    assert.equal(await page.getByLabel('Note body', {exact: true}).inputValue(), localDraft);
    assert(await page.getByRole('button', {name: 'Save', exact: true}).isDisabled());
    await page.getByRole('button', {name: 'Keep my edits', exact: true}).click();
    assert.equal(await page.getByLabel('Note body', {exact: true}).inputValue(), localDraft);
    await page.getByRole('button', {name: 'Save', exact: true}).click();
    await page.waitForFunction(() =>
        document.querySelector('.save-status')?.textContent.includes('Saved'),
    );
    assert.equal(
        (await json(page.request, `/api/workspace/notes/${browserNote.id}`)).body,
        localDraft,
    );
    const cleanRemote = 'An incoming live edit should replace a clean editor.';
    await json(page.request, `/api/workspace/notes/${browserNote.id}`, 'PUT', {
        title: browserNote.title,
        body: cleanRemote,
        project_id: browserNote.project_id,
    });
    await page.waitForFunction(
        (expected) => document.querySelector('[aria-label="Note body"]')?.value === expected,
        cleanRemote,
    );
    await page.getByLabel('Note body', {exact: true}).fill('Another unsaved local draft.');
    await json(page.request, `/api/workspace/notes/${browserNote.id}`, 'PUT', {
        title: browserNote.title,
        body: remoteDraft,
        project_id: browserNote.project_id,
    });
    await page.getByRole('button', {name: 'Load latest version', exact: true}).click();
    assert.equal(await page.getByLabel('Note body', {exact: true}).inputValue(), remoteDraft);
    assert(await page.getByRole('button', {name: 'Save', exact: true}).isDisabled());
    pass(
        'Live updates preserve dirty text, require an explicit conflict choice, and refresh clean editors',
    );
    await json(page.request, `/api/workspace/notes/${browserNote.id}`, 'DELETE');
    await page.locator('.note-card').first().click();
    await page.screenshot({
        path: new URL('../artifacts/workspace-desktop.png', import.meta.url).pathname,
        fullPage: true,
        animations: 'disabled',
    });
    await page.setViewportSize({width: 390, height: 844});
    await page.screenshot({
        path: new URL('../artifacts/workspace-mobile.png', import.meta.url).pathname,
        fullPage: true,
        animations: 'disabled',
    });
    assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        false,
        'Mobile horizontal overflow',
    );
    assert.deepEqual(pageErrors, []);
    await page.getByRole('button', {name: 'Open navigation'}).click();
    await page.getByRole('button', {name: 'Sign out', exact: true}).click();
    await page.waitForURL('**/auth/sign-in');
    pass(
        'Production browser sign-in, live connection, session across reload, responsive UI, sign-out, zero browser errors',
    );

    await json(a.c, `/api/workspace/notes/${note.id}`, 'DELETE');
    await eventually(
        () => !subA.getSnapshot().data.some((row) => row.id === note.id),
        'live delete propagation',
    );
    await json(a.c, `/api/workspace/projects/${project.id}`, 'DELETE');
    pass('Authorized cleanup and real WebSocket delete delivery');
    console.log(`Verified ${records.length} checks against all six real Neon services.`);
} catch (error) {
    records.push({
        check: 'E2E completion',
        result: 'FAIL',
        error: error instanceof Error ? error.message : String(error),
    });
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
} finally {
    for (const client of liveClients) client.close();
    if (browser) await browser.close();
    for (const client of clients) await client.dispose();
    await mkdir(new URL('../artifacts/', import.meta.url), {recursive: true});
    await writeFile(
        new URL('../artifacts/e2e-results.json', import.meta.url),
        JSON.stringify({at: new Date().toISOString(), origin, checks: records}, null, 2),
    );
}
