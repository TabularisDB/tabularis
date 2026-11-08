import {withCredentials} from './env.js';
import {type Params, text} from './database.js';
import {service} from './services.js';
import {admin} from './admin.js';
import {cliSetup} from './cliAuth.js';
import {account} from './account.js';

const operations = new Set([
    'neon_status',
    'neon_auth_users',
    'neon_auth_users_page',
    'neon_auth_user_details',
    'neon_management_context',
    'neon_branch_context',
    'neon_demo_notes',
    'neon_function',
    'neon_ai_models',
    'neon_ai_complete',
    'neon_storage_list',
    'neon_storage_put',
    'neon_storage_get',
    'neon_storage_delete',
    'neon_realtime_snapshot',
    'neon_project_branches',
]);

export async function extension(request: Params): Promise<unknown> {
    const context = request.context as Params | undefined;
    if (context?.plugin_id === 'neon' && context.scope === 'account-setup') {
        if (context.connection_id !== undefined || request.params !== undefined)
            throw new Error('Account setup cannot include a connection');
        if (
            !request.secrets ||
            typeof request.secrets !== 'object' ||
            Array.isArray(request.secrets) ||
            Object.keys(request.secrets).length
        )
            throw new Error('Account setup cannot include credentials');
        if (!request.args || typeof request.args !== 'object' || Array.isArray(request.args))
            throw new Error('Invalid account setup arguments');
        return cliSetup(text(request.method, 'method'), request.args as Params);
    }
    if (context?.plugin_id === 'neon' && context.scope === 'account') {
        if (context.connection_id !== undefined || request.params !== undefined)
            throw new Error('Account scope cannot include a connection');
        const supplied = request.secrets;
        if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied))
            throw new Error('Invalid account credentials');
        const credentials: Record<string, string> = {};
        for (const [key, value] of Object.entries(supplied)) {
            if (typeof value !== 'string') throw new Error('Invalid account credential value');
            credentials[key] = value;
        }
        const args = request.args;
        if (!args || typeof args !== 'object' || Array.isArray(args))
            throw new Error('Invalid account arguments');
        return account(text(request.method, 'method'), args as Params, credentials);
    }
    if (
        context?.plugin_id !== 'neon' ||
        typeof context.connection_id !== 'string' ||
        !context.connection_id
    )
        throw new Error('A trusted Neon connection context is required');
    const method = text(request.method, 'method');
    if (!operations.has(method)) throw new Error('Unsupported Neon extension method');
    const supplied = request.secrets;
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied))
        throw new Error('Invalid service credentials');
    const credentials: Record<string, string> = {};
    for (const [key, value] of Object.entries(supplied)) {
        if (typeof value !== 'string') throw new Error('Invalid service credential value');
        credentials[key] = value;
    }
    // Resolve SQL access from the active saved connection, never from the service bundle.
    const params = request.params as Params;
    if (!params || typeof params !== 'object' || params.driver !== 'neon')
        throw new Error('Neon driver connection required');
    if (method === 'neon_management_context')
        return withCredentials(credentials, () => admin(method, {}, context));
    if (method === 'neon_branch_context') {
        const binding = (await withCredentials(credentials, () =>
            admin('neon_management_context', {}, context),
        )) as Record<string, unknown>;
        return {
            ...binding,
            database: typeof params.database === 'string' ? params.database : null,
            role: typeof params.username === 'string' ? params.username : null,
        };
    }
    if (params.host) {
        const url = new URL('postgresql://localhost');
        url.hostname = text(params.host, 'host');
        url.port = String(params.port ?? 5432);
        url.username = text(params.username, 'username');
        url.password = text(params.password, 'password');
        url.pathname = `/${text(Array.isArray(params.database) ? params.database[0] : params.database, 'database')}`;
        url.searchParams.set('sslmode', 'verify-full');
        credentials.DATABASE_URL = url.toString();
    } else throw new Error('Saved connection has no database host');
    const args =
        request.args && typeof request.args === 'object' && !Array.isArray(request.args)
            ? (request.args as Params)
            : {};
    return withCredentials(credentials, async () => {
        if (
            method === 'neon_status' ||
            method === 'neon_auth_users' ||
            method === 'neon_auth_users_page' ||
            method === 'neon_auth_user_details' ||
            method === 'neon_management_context' ||
            method === 'neon_demo_notes' ||
            method === 'neon_project_branches'
        )
            return admin(method, args, context);
        return service(method, args);
    });
}
