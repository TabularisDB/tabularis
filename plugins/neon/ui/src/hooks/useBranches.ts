import {useCallback, useEffect, useId, useMemo} from 'react';
import {usePluginAccount, usePluginRpc, usePluginTranslation} from '@tabularis/plugin-api';
import {useNeonManagement} from './useNeonManagement';
import {useTask} from './useTask';
import {matchingBranchConnection} from '../utils/branches';
import type {BranchContext, BranchItem, BranchSnapshot} from '../types/branches';

export function useBranches(connectionId: string) {
    const t = usePluginTranslation('neon');
    const instanceId = useId();
    const account = usePluginAccount('neon');
    const rpc = usePluginRpc('neon', connectionId);
    const management = useNeonManagement(connectionId);
    const {scope, call} = management;
    const context = useTask<BranchContext>();
    const listing = useTask<BranchSnapshot>();
    const action = useTask<{message: string}>();
    const {run: runAction} = action;
    const storedContext = context.data;
    const branchContext = useMemo(
        () =>
            storedContext
                ? {...storedContext, branchId: storedContext.branchId ?? scope?.branchId ?? null}
                : undefined,
        [storedContext, scope],
    );
    const snapshot = listing.data;
    const {run: loadContext} = context;
    useEffect(() => {
        void Promise.resolve().then(() =>
            loadContext(() => rpc.call<BranchContext>('neon_branch_context')),
        );
    }, [rpc, loadContext]);
    const {run: loadListing} = listing;
    const refresh = useCallback(() => {
        if (!scope) return Promise.resolve(undefined);
        return loadListing(async () => {
            const [snapshot, candidates] = await Promise.all([
                call<Omit<BranchSnapshot, 'bindings'>>('account_branch_list'),
                Promise.all(
                    account.connections.map(async (connection) => {
                        try {
                            return {
                                ...connection,
                                context: await account.callConnection<BranchContext>(
                                    connection.id,
                                    'neon_branch_context',
                                ),
                            };
                        } catch {
                            return null;
                        }
                    }),
                ),
            ]);
            const bindings = candidates
                .filter((item) => item !== null)
                .map((item) => ({
                    ...item,
                    context: {
                        ...item.context,
                        branchId:
                            item.context.branchId ??
                            (item.context.projectId === scope.projectId
                                ? (snapshot.branches.find(
                                      (branch) => branch.name === item.context.branchName,
                                  )?.id ?? null)
                                : null),
                    },
                }));
            const unresolvedConnections =
                candidates.filter((item) => item === null).length +
                bindings.filter(
                    (item) =>
                        !item.context.projectId ||
                        (item.context.projectId === scope.projectId && !item.context.branchId),
                ).length;
            return {...snapshot, bindings, unresolvedConnections};
        });
    }, [scope, loadListing, call, account]);
    useEffect(() => {
        void Promise.resolve().then(refresh);
    }, [refresh]);
    useEffect(() => {
        const changed = (event: Event) => {
            if (
                event instanceof CustomEvent &&
                event.detail?.projectId === scope?.projectId &&
                event.detail?.origin !== instanceId
            )
                void refresh();
        };
        window.addEventListener('tabularis:neon-branches-changed', changed);
        return () => window.removeEventListener('tabularis:neon-branches-changed', changed);
    }, [scope, instanceId, refresh]);
    const openBranch = useCallback(
        (
            branchId: string,
            forceNew = false,
            options?: {database: string; role: string; createServiceCredentials: boolean},
        ) =>
            runAction(async () => {
                const source = branchContext;
                if (!scope || !source?.database || !source.role)
                    throw new Error(t('management.missingBinding'));
                const database = options?.database ?? source.database;
                const role = options?.role ?? source.role;
                const existing =
                    !forceNew && !options?.createServiceCredentials && snapshot
                        ? matchingBranchConnection(snapshot.bindings, {
                              ...source,
                              branchId,
                              database,
                              role,
                          })
                        : undefined;
                const imported = existing
                    ? {id: existing, warnings: []}
                    : await account.importConnection({
                          projectId: scope.projectId,
                          branchId,
                          database,
                          role,
                          createServiceCredentials: options?.createServiceCredentials ?? false,
                      });
                await account.openConnection(imported.id, connectionId);
                return {message: imported.warnings.join('\n') || t('branches.opened')};
            }),
        [runAction, account, connectionId, branchContext, snapshot, scope, t],
    );
    const mutate = useCallback(
        (method: string, args: Record<string, unknown>, message: string) =>
            runAction(async () => {
                await call<BranchItem | null>(method, args);
                await refresh();
                window.dispatchEvent(
                    new CustomEvent('tabularis:neon-branches-changed', {
                        detail: {projectId: scope?.projectId, origin: instanceId},
                    }),
                );
                return {message};
            }),
        [runAction, call, refresh, instanceId, scope],
    );
    return {
        context: {...context, data: branchContext},
        listing,
        action,
        management,
        refresh,
        openBranch,
        mutate,
        pending: context.pending || listing.pending || action.pending || management.pending,
    };
}
