import {createNeonClient, isNeonError, type NeonClient} from '@neon/sdk';
import type {Params} from './database.js';
import {branchMethods, manageBranches} from './branches.js';
import {cliCredential} from './cliAuth.js';
import {withFunctionMutation} from './managementQueue.js';
import {manage, managementMethods, ManagementError} from './management.js';
import {readUsage} from './usage.js';

const methods = new Set([
    'account_projects',
    'account_branches',
    'account_resources',
    'account_import',
    'account_usage',
]);
const apiBase = 'https://console.neon.tech/api/v2';

function id(value: unknown, name: string): string {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(value))
        throw new Error(`Invalid ${name}`);
    return value;
}

function databaseName(value: unknown, name: string): string {
    /* eslint-disable no-control-regex -- Database names must reject ASCII control characters. */
    if (typeof value !== 'string' || !value || value.length > 63 || /[\x00-\x1f]/.test(value))
        throw new Error(`Invalid ${name}`);
    /* eslint-enable no-control-regex */
    return value;
}

function failure(error: unknown): Error {
    if (isNeonError(error)) {
        if ('status' in error) {
            if (error.status === 401) return new Error('Neon API key is invalid or expired');
            if (error.status === 403)
                return new Error('Neon API key does not have permission for this resource');
            if (error.status === 404)
                return new Error('Neon resource was not found or is unavailable to this API key');
            return new Error(`Neon management API returned HTTP ${error.status}`);
        }
        if (error.kind === 'timeout') return new Error('Neon management API request timed out');
    }
    return new Error('Neon management API request failed');
}

interface Probe<T> {
    value?: T;
    warning?: string;
}

async function optional<T>(name: string, action: () => Promise<T>): Promise<Probe<T>> {
    try {
        return {value: await action()};
    } catch (error) {
        if (isNeonError(error) && 'status' in error && error.status === 404) return {};
        if (isNeonError(error) && 'status' in error && error.status === 401) throw error;
        return {warning: `${name}: ${failure(error).message}`};
    }
}

async function discover(client: NeonClient<true>, scope: {projectId: string; branchId: string}) {
    const [auth, storage, ai, functions, realtime] = await Promise.all([
        optional('Auth', () => client.auth.get(scope)),
        optional('Storage', () => client.storage.get(scope)),
        optional('AI Gateway', () => client.aiGateway.get(scope)),
        optional('Functions', () => client.functions.list(scope).all()),
        optional('Realtime', () => client.realtime.get(scope)),
    ]);
    return {auth, storage, ai, functions, realtime};
}

function serviceMetadata(discovered: Awaited<ReturnType<typeof discover>>) {
    return [
        {id: 'auth', enabled: !!discovered.auth.value?.base_url, warning: discovered.auth.warning},
        {
            id: 'storage',
            enabled: discovered.storage.value?.enabled === true,
            warning: discovered.storage.warning,
        },
        {id: 'ai', enabled: discovered.ai.value?.enabled === true, warning: discovered.ai.warning},
        {
            id: 'functions',
            enabled: !!discovered.functions.value?.some((item) => item.invocation_url),
            warning: discovered.functions.warning,
        },
        {
            id: 'realtime',
            enabled:
                discovered.realtime.value?.enabled === true && !discovered.realtime.value.pending,
            warning: discovered.realtime.warning,
        },
    ];
}

/** Account calls use only the credential source explicitly linked by the host. */
export async function account(
    method: string,
    args: Params,
    secrets: Record<string, string>,
    fetcher: typeof fetch = globalThis.fetch,
): Promise<unknown> {
    if (!methods.has(method) && !managementMethods.has(method) && !branchMethods.has(method))
        throw new Error('Unsupported Neon account method');
    if (secrets.NEON_API_KEY && secrets.NEON_CLI_AUTH)
        throw new Error('Choose one Neon account authentication method');
    const key = secrets.NEON_CLI_AUTH
        ? await cliCredential(secrets.NEON_CLI_AUTH)
        : secrets.NEON_API_KEY;
    if (!key || !key.trim() || /[\r\n\0]/.test(key))
        throw new Error('A Neon account API key is required');
    const orgId =
        args.orgId === undefined || args.orgId === '' ? undefined : id(args.orgId, 'organization');
    const scope =
        method === 'account_projects'
            ? undefined
            : {
                  projectId: id(args.projectId, 'project'),
                  ...(method === 'account_branches' ? {} : {branchId: id(args.branchId, 'branch')}),
              };
    const database =
        method === 'account_import' ? databaseName(args.database, 'database') : undefined;
    const role = method === 'account_import' ? databaseName(args.role, 'role') : undefined;
    if (method === 'account_import' && typeof args.createServiceCredentials !== 'boolean')
        throw new Error('Choose whether to create service credentials');
    const client = createNeonClient({
        apiKey: key,
        baseUrl: apiBase,
        fetch: fetcher,
        throwOnError: true,
        requestTimeoutMs: 15000,
        retries: 0,
    });
    try {
        if (method === 'account_projects') {
            const [organizations, projects] = await Promise.all([
                optional('Organizations', () => client.user.organizations()),
                client.projects.list(orgId ? {org_id: orgId} : undefined).all(),
            ]);
            return {
                organizations: (organizations.value ?? []).map(({id, name}) => ({id, name})),
                projects: projects.map(({id, name, region_id, org_id}) => ({
                    id,
                    name,
                    regionId: region_id,
                    ...(org_id ? {orgId: org_id} : {}),
                })),
            };
        }
        if (!scope) throw new Error('Missing project selection');
        if (method === 'account_branches') {
            const branches = await client.branches.list({projectId: scope.projectId}).all();
            return {branches: branches.map(({id, name}) => ({id, name}))};
        }
        const branchScope = {projectId: scope.projectId, branchId: id(args.branchId, 'branch')};
        if (method === 'account_usage') return await readUsage(client, branchScope);
        if (branchMethods.has(method))
            return await manageBranches(client, method, args, branchScope);
        if (managementMethods.has(method)) {
            const action = () => manage(client, method, args, branchScope, fetcher);
            return await ([
                'account_function_deploy',
                'account_function_delete',
                'account_function_rename',
            ].includes(method)
                ? withFunctionMutation(
                      JSON.stringify([branchScope.projectId, branchScope.branchId, args.slug]),
                      action,
                  )
                : action());
        }
        const [databases, roles, discovered] = await Promise.all([
            client.postgres.databases.list(branchScope),
            client.postgres.roles.list(branchScope),
            discover(client, branchScope),
        ]);
        if (method === 'account_resources')
            return {
                databases: databases.map(({name}) => ({name})),
                roles: roles.map(({name}) => ({name})),
                services: serviceMetadata(discovered),
            };
        if (
            !databases.some((item) => item.name === database) ||
            !roles.some((item) => item.name === role)
        )
            throw new Error('The selected database or role does not belong to this branch');
        const [project, branch, connectionString] = await Promise.all([
            client.projects.get({projectId: scope.projectId}),
            client.branches.get(branchScope),
            client.postgres.connectionString({
                ...branchScope,
                databaseName: database,
                roleName: role,
                pooled: false,
            }),
        ]);
        const connection = new URL(connectionString);
        if (
            !['postgres:', 'postgresql:'].includes(connection.protocol) ||
            !connection.hostname ||
            !connection.username ||
            !connection.password
        )
            throw new Error('Neon returned an incomplete connection URI');
        const bundle: Record<string, string> = {
            NEON_PROJECT_ID: scope.projectId,
            NEON_BRANCH: branch.name,
            NEON_BRANCH_ID: branchScope.branchId,
        };
        const warnings = serviceMetadata(discovered).flatMap((item) =>
            item.warning ? [item.warning] : [],
        );
        if (discovered.auth.value?.base_url) {
            bundle.NEON_AUTH_BASE_URL = discovered.auth.value.base_url;
            bundle.NEON_AUTH_JWKS_URL = discovered.auth.value.jwks_url;
            if (discovered.auth.value.db_name !== database)
                warnings.push(
                    'Auth belongs to another database on this branch; its user table is not available in this connection.',
                );
        }
        if (discovered.storage.value?.enabled) {
            bundle.AWS_ENDPOINT_URL_S3 = discovered.storage.value.s3_endpoint;
            bundle.AWS_REGION = discovered.storage.value.region;
            const buckets = await optional('Storage buckets', () =>
                client.storage.buckets.list(branchScope),
            );
            if (buckets.warning) warnings.push(buckets.warning);
            if (buckets.value && !buckets.value.some((item) => item.name === 'assets'))
                warnings.push(
                    'The Storage view currently browses the assets bucket, which is absent on this branch.',
                );
        }
        if (discovered.ai.value?.enabled)
            bundle.NEON_AI_GATEWAY_BASE_URL = discovered.ai.value.base_url;
        for (const item of discovered.functions.value ?? []) {
            if (item.invocation_url && /^[a-z0-9-]+$/.test(item.slug))
                bundle[`NEON_FUNCTION_${item.slug.toUpperCase().replaceAll('-', '_')}_BASE_URL`] =
                    item.invocation_url;
        }
        if (discovered.functions.value?.length && !bundle.NEON_FUNCTION_HELLO_BASE_URL)
            warnings.push(
                'Functions were discovered; the current invocation view requires a deployed hello function.',
            );
        if (
            discovered.realtime.value?.enabled &&
            !discovered.realtime.value.pending &&
            discovered.realtime.value.invocation_url
        ) {
            const live = await optional('Realtime secret', () =>
                client.realtime.secret(branchScope),
            );
            if (live.warning) warnings.push(live.warning);
            if (live.value?.secret && !live.value.pending) {
                bundle.NEON_REALTIME_URL = discovered.realtime.value.invocation_url;
                bundle.NEON_REALTIME_SECRET = live.value.secret;
            } else if (!live.warning)
                warnings.push('Realtime is enabled but its secret is not ready.');
        } else if (discovered.realtime.value?.pending)
            warnings.push(
                'Realtime is still provisioning; refresh its credentials after provisioning finishes.',
            );
        const credentialScopes: ('storage:read' | 'storage:write' | 'ai_gateway:invoke')[] = [];
        if (discovered.storage.value?.enabled)
            credentialScopes.push('storage:read', 'storage:write');
        if (discovered.ai.value?.enabled) credentialScopes.push('ai_gateway:invoke');
        if (credentialScopes.length && args.createServiceCredentials === true) {
            const credential = await optional('Service credentials', () =>
                client.credentials.create({
                    ...branchScope,
                    name: `Tabularis · ${branch.name}`,
                    principal_type: 'user',
                    scopes: credentialScopes,
                }),
            );
            if (credential.warning) warnings.push(credential.warning);
            if (credential.value) {
                if (credentialScopes.includes('storage:write')) {
                    bundle.AWS_ACCESS_KEY_ID = credential.value.token_id;
                    bundle.AWS_SECRET_ACCESS_KEY = credential.value.s3_secret_access_key;
                }
                if (credentialScopes.includes('ai_gateway:invoke'))
                    bundle.NEON_AI_GATEWAY_TOKEN = credential.value.api_token;
            } else if (!credential.warning)
                warnings.push(
                    'The service credential endpoint was unavailable; Storage and AI credentials were not imported.',
                );
        } else if (credentialScopes.length)
            warnings.push(
                'Storage and AI endpoints were discovered. Create or import service credentials to use those services.',
            );
        return {
            name: `${project.name} · ${branch.name}`,
            params: {
                driver: 'neon',
                host: connection.hostname,
                port: Number(connection.port || 5432),
                username: decodeURIComponent(connection.username),
                password: decodeURIComponent(connection.password),
                database,
                ssl_mode: 'verify-full',
                save_in_keychain: true,
            },
            secrets: bundle,
            warnings,
        };
    } catch (error) {
        if (error instanceof ManagementError) throw error;
        // Remote response bodies and SDK error messages can carry tokens or connection URIs.
        throw failure(error);
    }
}
