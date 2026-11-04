import {useCallback, useEffect, useReducer, useRef} from 'react';
import {usePluginAccount, type PluginAccountImportResult} from '@tabularis/plugin-api';

interface Named {
    id: string;
    name: string;
}
export interface Project extends Named {
    regionId: string;
    orgId?: string;
}
export interface AccountResources {
    databases: {name: string}[];
    roles: {name: string}[];
    services: {
        id: 'auth' | 'storage' | 'ai' | 'functions' | 'realtime';
        enabled: boolean;
        warning?: string;
    }[];
}
interface ProjectList {
    organizations: Named[];
    projects: Project[];
}
interface State {
    connected: boolean | null;
    authMode?: 'cli' | 'api-key';
    pending: boolean;
    loading?: 'projects' | 'branches' | 'resources';
    error?: string;
    organizations: Named[];
    projects: Project[];
    branches: Named[];
    resources?: AccountResources;
    orgId: string;
    projectId: string;
    branchId: string;
    database: string;
    role: string;
    imported?: PluginAccountImportResult;
}
const initial: State = {
    connected: null,
    pending: false,
    loading: undefined,
    organizations: [],
    projects: [],
    branches: [],
    orgId: '',
    projectId: '',
    branchId: '',
    database: '',
    role: '',
};

/** Each new selection invalidates all older requests, including requests still in flight. */
export function useAccountBrowser(onConnected?: () => void | Promise<void>) {
    const account = usePluginAccount('neon');
    const [state, patch] = useReducer(
        (current: State, update: Partial<State>) => ({...current, ...update}),
        initial,
    );
    const epoch = useRef(0);
    const mounted = useRef(true);
    const run = useCallback(
        async (
            operation: (current: () => boolean) => Promise<Partial<State>>,
            loading?: State['loading'],
        ) => {
            const request = ++epoch.current;
            patch({pending: true, loading, error: undefined});
            try {
                const update = await operation(() => mounted.current && epoch.current === request);
                if (mounted.current && epoch.current === request) patch(update);
            } catch (error) {
                if (mounted.current && epoch.current === request)
                    patch({error: error instanceof Error ? error.message : 'Request failed'});
            } finally {
                if (mounted.current && epoch.current === request)
                    patch({pending: false, loading: undefined});
            }
        },
        [],
    );
    const reload = useCallback(
        () =>
            run(async (current) => {
                const fields = await account.secretFields();
                if (!fields.includes('NEON_API_KEY') && !fields.includes('NEON_CLI_AUTH'))
                    return {...initial, connected: false};
                const authMode = fields.includes('NEON_CLI_AUTH') ? 'cli' : 'api-key';
                if (current()) patch({connected: true, authMode});
                const list = await account.call<ProjectList>('account_projects');
                return {...initial, connected: true, authMode, ...list};
            }, 'projects'),
        [account, run],
    );
    useEffect(() => {
        mounted.current = true;
        void Promise.resolve().then(reload);
        return () => {
            mounted.current = false;
            epoch.current += 1;
        };
    }, [reload]);
    const connect = useCallback(
        (key: string, clearDraft: () => void) =>
            run(async (current) => {
                await account.connect({NEON_API_KEY: key.trim()});
                // The key is already stored even if subsequent API discovery is forbidden.
                if (current()) {
                    clearDraft();
                    patch({connected: true, authMode: 'api-key'});
                }
                const list = await account.call<ProjectList>('account_projects');
                return {...initial, connected: true, authMode: 'api-key', ...list};
            }, 'projects'),
        [account, run],
    );
    const connectCli = useCallback(
        (profile: string) =>
            run(async (current) => {
                await account.connect({NEON_CLI_AUTH: profile});
                if (current()) patch({connected: true, authMode: 'cli'});
                const list = await account.call<ProjectList>('account_projects');
                return {...initial, connected: true, authMode: 'cli', ...list};
            }, 'projects'),
        [account, run],
    );
    const disconnect = useCallback(
        () =>
            run(async () => {
                await account.disconnect();
                return {...initial, connected: false};
            }),
        [account, run],
    );
    const selectOrganization = useCallback(
        (orgId: string) => {
            patch({
                orgId,
                projectId: '',
                branchId: '',
                database: '',
                role: '',
                projects: [],
                branches: [],
                resources: undefined,
            });
            return run(
                async () => ({
                    ...(await account.call<ProjectList>('account_projects', orgId ? {orgId} : {})),
                    orgId,
                }),
                'projects',
            );
        },
        [account, run],
    );
    const selectProject = useCallback(
        (projectId: string) => {
            patch({
                projectId,
                branchId: '',
                database: '',
                role: '',
                branches: [],
                resources: undefined,
            });
            return run(
                async () =>
                    projectId
                        ? await account.call<{branches: Named[]}>('account_branches', {projectId})
                        : {branches: []},
                'branches',
            );
        },
        [account, run],
    );
    const selectBranch = useCallback(
        (branchId: string) => {
            patch({branchId, database: '', role: '', resources: undefined});
            const projectId = state.projectId;
            return run(async () => {
                if (!branchId) return {};
                const resources = await account.call<AccountResources>('account_resources', {
                    projectId,
                    branchId,
                });
                return {
                    resources,
                    database: resources.databases.length === 1 ? resources.databases[0].name : '',
                    role: resources.roles.length === 1 ? resources.roles[0].name : '',
                };
            }, 'resources');
        },
        [account, run, state.projectId],
    );
    const importConnection = useCallback(
        (createServiceCredentials: boolean) => {
            const {projectId, branchId, database, role} = state;
            return run(async (current) => {
                const imported = await account.importConnection({
                    projectId,
                    branchId,
                    database,
                    role,
                    createServiceCredentials,
                });
                // A refresh failure must not invite a duplicate import of an already-saved connection.
                if (current()) {
                    patch({imported});
                    await onConnected?.();
                }
                return {imported};
            });
        },
        [account, onConnected, run, state],
    );
    return {
        state,
        reload,
        connect,
        connectCli,
        disconnect,
        selectOrganization,
        selectProject,
        selectBranch,
        selectDatabase: (database: string) => patch({database}),
        selectRole: (role: string) => patch({role}),
        importConnection,
    };
}
