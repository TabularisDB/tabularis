import assert from 'node:assert/strict';
import '../dist/env.js';
import {start} from './rpc.mjs';

const plugin = start();
const url = new URL(process.env.DATABASE_URL);
const params = {
    driver: 'neon',
    host: url.hostname,
    port: Number(url.port || 5432),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
};
const secrets = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => /^(NEON_|AWS_|DATABASE_URL)/.test(key)),
);
const context = {plugin_id: 'neon', connection_id: 'scoped-e2e'};
const call = (method, args = {}, credentials = secrets) =>
    plugin.call('extension', {method, args, params, context, secrets: credentials});
try {
    const status = await call('neon_status');
    assert.equal(status.connectionId, 'scoped-e2e');
    assert.equal(status.services.filter((item) => item.configured).length, 6);
    assert(Array.isArray((await call('neon_auth_users')).rows));
    assert((await call('neon_demo_notes')).rows.length > 0);
    assert(Array.isArray(await call('neon_storage_list')));
    assert((await call('neon_ai_models')).data.length > 0);
    assert.equal((await call('neon_function')).status, 200);
    const rows = await call('neon_realtime_snapshot', {
        query: 'SELECT id, title FROM tabularis_demo.notes LIMIT 5',
    });
    assert(rows.length > 0);
    await assert.rejects(call('neon_ai_models', {}, {}), /Missing NEON_AI_GATEWAY/);
    console.log(
        'PASS connection-scoped Core RPC envelope: all six services, demo data, and no global credential fallback',
    );
} finally {
    plugin.close();
}
