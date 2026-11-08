import {env, optionalEnv} from './env.js';
import {database, type Params} from './database.js';
import {authDirectory} from './authDirectory.js';

export async function admin(method: string, _args: Params, context: Params): Promise<unknown> {
    if (method === 'neon_management_context')
        return {
            projectId: optionalEnv('NEON_PROJECT_ID') ?? null,
            branchId: optionalEnv('NEON_BRANCH_ID') ?? null,
            branchName: optionalEnv('NEON_BRANCH') ?? null,
        };
    if (method === 'neon_auth_users_page' || method === 'neon_auth_user_details')
        return authDirectory(method, _args);
    if (method === 'neon_status') {
        const db =
            _args.metadataOnly === true
                ? null
                : await database('execute_query', {
                      query: 'SELECT current_database() AS database, version() AS version',
                  });
        return {
            connectionId: context.connection_id,
            branch: optionalEnv('NEON_BRANCH') ?? 'Unspecified',
            projectId: optionalEnv('NEON_PROJECT_ID') ?? null,
            database: db,
            services: [
                {name: 'Postgres', configured: true},
                {name: 'Auth', configured: !!optionalEnv('NEON_AUTH_BASE_URL')},
                {
                    name: 'Storage',
                    configured:
                        !!optionalEnv('AWS_ENDPOINT_URL_S3') &&
                        !!optionalEnv('AWS_SECRET_ACCESS_KEY'),
                },
                {name: 'AI Gateway', configured: !!optionalEnv('NEON_AI_GATEWAY_TOKEN')},
                {name: 'Functions', configured: !!optionalEnv('NEON_FUNCTION_HELLO_BASE_URL')},
                {name: 'Realtime', configured: !!optionalEnv('NEON_REALTIME_SECRET')},
            ],
        };
    }
    if (method === 'neon_auth_users')
        return database('execute_query', {
            query: 'SELECT id, name, email, "emailVerified", "createdAt" FROM neon_auth."user" ORDER BY "createdAt" DESC LIMIT 100',
        });
    if (method === 'neon_demo_notes')
        return database('execute_query', {
            query: 'SELECT id, title, body, owner_id, updated_at FROM tabularis_demo.notes ORDER BY updated_at DESC LIMIT 100',
        });
    if (method === 'neon_project_branches') {
        const project = env('NEON_PROJECT_ID');
        const response = await fetch(
            `https://console.neon.tech/api/v2/projects/${encodeURIComponent(project)}/branches`,
            {
                headers: {authorization: `Bearer ${env('NEON_API_KEY')}`},
                signal: AbortSignal.timeout(15000),
            },
        );
        if (!response.ok) throw new Error(`Neon API returned HTTP ${response.status}`);
        const result = (await response.json()) as {
            branches: {id: string; name: string; current_state: string; parent_id?: string}[];
        };
        return result.branches.map(({id, name, current_state, parent_id}) => ({
            id,
            name,
            state: current_state,
            parentId: parent_id ?? null,
        }));
    }
    throw new Error('Unknown Neon administration method');
}
