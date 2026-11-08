import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createNeonClient} from '@neon/sdk';
import {account} from '../dist/account.js';

assert.equal(
    process.env.NEON_MANAGEMENT_TEST_USE_CLI,
    '1',
    'This diagnostic requires explicit use of the existing CLI credential',
);
const auth = JSON.parse(await readFile(join(homedir(), '.config/neon/credentials.json'), 'utf8'));
const credentials = {NEON_API_KEY: auth.access_token};
const scope = {projectId: 'solitary-leaf-07190439', branchId: 'br-lively-scene-b9f8w1aa'};
const slug = `tabdiag${randomBytes(5).toString('hex')}`;
const sdk = createNeonClient({
    apiKey: auth.access_token,
    throwOnError: true,
    requestTimeoutMs: 15000,
    retries: 0,
});
const call = (method, args = {}) => account(method, {...scope, slug, ...args}, credentials);
const source = (revision) =>
    `export default { fetch() { return Response.json({revision:${revision},B:process.env.TABULARIS_TEST_B ?? null}); } };`;
const evidence = {functionSlug: slug, observations: []};
let created = false;
async function ready(id) {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        const value = await sdk.functions.get({...scope, slug});
        if (
            String(value.current_deployment?.id) === id &&
            value.current_deployment?.status === 'failed'
        )
            throw new Error('Diagnostic deployment failed');
        if (
            String(value.current_deployment?.id) === id &&
            String(value.active_deployment?.id) === id &&
            value.current_deployment.status === 'completed'
        )
            return value;
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error('Diagnostic readiness timed out');
}
async function closed(url, label) {
    const response = await fetch(url, {
        headers: {connection: 'close'},
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    evidence.observations.push({label, body});
    console.log(JSON.stringify({label, body}));
}
try {
    const first = await call('account_function_deploy', {
        source: source(1),
        createOnly: true,
        envChanges: {TABULARIS_TEST_B: 'beta'},
    });
    created = true;
    await ready(first.id);
    const initial = await call('account_function_invoke', {method: 'GET'});
    evidence.observations.push({
        label: 'initial_default_connection',
        body: JSON.parse(initial.body),
    });
    assert.deepEqual(JSON.parse(initial.body), {revision: 1, B: 'beta'});
    const next = await call('account_function_deploy', {
        source: source(2),
        envChanges: {TABULARIS_TEST_B: 'changed'},
    });
    const current = await ready(next.id);
    evidence.metadata = {
        currentDeploymentId: String(current.current_deployment.id),
        activeDeploymentId: String(current.active_deployment.id),
        status: current.current_deployment.status,
    };
    const pooled = await call('account_function_invoke', {method: 'GET'});
    evidence.observations.push({
        label: 'updated_default_connection',
        body: JSON.parse(pooled.body),
    });
    console.log(
        JSON.stringify({label: 'updated_default_connection', body: JSON.parse(pooled.body)}),
    );
    await closed(current.invocation_url, 'updated_connection_close_1');
    await closed(current.invocation_url, 'updated_connection_close_2');
    if (
        evidence.observations.some(
            (item) =>
                item.label.startsWith('updated_') &&
                (item.body.revision !== 2 || item.body.B !== 'changed'),
        )
    ) {
        evidence.error =
            'Update activation failed: expected revision 2 and changed environment values';
        console.error(evidence.error);
        process.exitCode = 1;
    }
} catch (error) {
    evidence.error =
        error instanceof Error
            ? error.message.replaceAll(auth.access_token, '[credential]')
            : 'Diagnostic failed';
    console.error(evidence.error);
    process.exitCode = 1;
} finally {
    if (created) {
        await call('account_function_delete');
        evidence.cleanup = 'Disposable diagnostic function deleted';
    }
    await writeFile(
        new URL('../artifacts/management-connection-activation-repro.json', import.meta.url),
        JSON.stringify(evidence, null, 2) + '\n',
    );
}
