import {ManagementAccountForm} from '../components/ManagementAccountForm';
import {useCallback, useEffect, useReducer, useState} from 'react';
import {
    usePluginAccount,
    usePluginModal,
    usePluginRpc,
    usePluginTranslation,
} from '@tabularis/plugin-api';

interface Scope {
    projectId: string;
    branchId: string;
}
interface Binding {
    projectId: string | null;
    branchId: string | null;
    branchName: string | null;
}
interface Resolution {
    connectionId: string;
    scope: Scope | null;
    pending: boolean;
    error?: string;
}

/** Resolve legacy branch names once and bind every administrative call to this connection. */
export function useNeonManagement(connectionId: string) {
    const account = usePluginAccount('neon');
    const rpc = usePluginRpc('neon', connectionId);
    const {openModal, closeModal} = usePluginModal();
    const t = usePluginTranslation('neon');
    const [revision, reload] = useReducer((value: number) => value + 1, 0);
    const [resolution, setResolution] = useState<Resolution>({
        connectionId,
        scope: null,
        pending: true,
    });
    const [projectId, setProjectId] = useState<string>();
    useEffect(() => {
        let active = true;
        void Promise.resolve()
            .then(async () => {
                if (active) setResolution({connectionId, scope: null, pending: true});
                const binding = await rpc.call<Binding>('neon_management_context');
                if (active) setProjectId(binding.projectId ?? undefined);
                if (!binding.projectId || (!binding.branchId && !binding.branchName))
                    throw new Error(t('management.missingBinding'));
                const fields = await account.secretFields();
                if (!fields.includes('NEON_API_KEY') && !fields.includes('NEON_CLI_AUTH'))
                    throw new Error(t('management.connectRequired'));
                let branchId = binding.branchId;
                if (!branchId) {
                    const result = await account.call<{branches: {id: string; name: string}[]}>(
                        'account_branches',
                        {projectId: binding.projectId},
                    );
                    branchId =
                        result.branches.find((branch) => branch.name === binding.branchName)?.id ??
                        null;
                }
                if (!branchId) throw new Error(t('management.branchMissing'));
                if (active)
                    setResolution({
                        connectionId,
                        scope: {projectId: binding.projectId, branchId},
                        pending: false,
                    });
            })
            .catch((cause: unknown) => {
                if (active)
                    setResolution({
                        connectionId,
                        scope: null,
                        pending: false,
                        error: cause instanceof Error ? cause.message : t('requestFailed'),
                    });
            });
        return () => {
            active = false;
        };
    }, [account, connectionId, revision, rpc, t]);
    const scope = resolution.connectionId === connectionId ? resolution.scope : null;
    const call = useCallback(
        <T = unknown,>(method: string, args: Record<string, unknown> = {}) => {
            if (!scope) return Promise.reject(new Error(t('management.connectRequired')));
            return account.call<T>(method, {...args, ...scope});
        },
        [account, scope, t],
    );
    const connectAccount = useCallback(
        () =>
            openModal({
                title: t('account.title'),
                size: 'sm',
                content: (
                    <ManagementAccountForm
                        projectId={projectId}
                        onConnected={() => {
                            closeModal();
                            reload();
                        }}
                    />
                ),
            }),
        [closeModal, openModal, projectId, t],
    );
    return {
        scope,
        call,
        connectAccount,
        reload,
        pending: resolution.connectionId !== connectionId || resolution.pending,
        error: resolution.connectionId === connectionId ? resolution.error : undefined,
    };
}
