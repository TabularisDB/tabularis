import {request} from '@playwright/test';
import {randomBytes} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
const origin = process.env.APP_ORIGIN || 'http://127.0.0.1:3008';
await mkdir(new URL('../artifacts/', import.meta.url), {recursive: true});
const credentialsPath = new URL('../artifacts/demo-user.json', import.meta.url);
let credentials;
try {
    credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
} catch {
    credentials = {
        name: 'Alex Morgan',
        email: process.env.DEMO_SEED_EMAIL || `fieldnotes-demo-${Date.now()}@example.com`,
        password: process.env.DEMO_SEED_PASSWORD || randomBytes(24).toString('base64url'),
    };
}
const client = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: {Origin: origin},
});
try {
    let response = await client.post('/api/auth/sign-in/email', {
        data: {email: credentials.email, password: credentials.password},
    });
    if (!response.ok())
        response = await client.post('/api/auth/sign-up/email', {
            data: credentials,
        });
    if (!response.ok())
        throw new Error(
            `Managed Auth failed (${response.status()}): ${JSON.stringify(await response.json())}`,
        );
    await writeFile(credentialsPath, JSON.stringify(credentials, null, 2), {
        mode: 0o600,
    });
    response = await client.post('/api/workspace/seed');
    if (!response.ok()) throw new Error(`Workspace seed failed (${response.status()})`);
    console.log('Seeded a real Managed Auth account and realistic notes in tabularis_demo.');
    console.log('Local demo credentials are in ignored artifacts/demo-user.json (not logged).');
} finally {
    await client.dispose();
}
