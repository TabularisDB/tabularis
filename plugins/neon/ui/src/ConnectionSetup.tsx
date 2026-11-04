import {useCallback, useEffect, useState} from 'react';
import {usePluginAccount, usePluginRpc, usePluginTranslation} from '@tabularis/plugin-api';
import {AccountWizard} from './AccountWizard';
import {ManagementAccountForm} from './components/ManagementAccountForm';
import {useTask} from './hooks/useTask';
import {NeonMark} from './NeonMark';
import {styles} from './styles';

interface SetupProps {
    connectionId: string | null;
    isEditing: boolean;
    onConnectionCreated: () => void | Promise<void>;
    onClose: () => void;
}
interface Binding {
    projectId: string | null;
    branchId: string | null;
    branchName: string | null;
}

/** Neon owns account authentication and branch selection, rather than a raw SQL login. */
export function ConnectionSetup({
    connectionId,
    isEditing,
    onConnectionCreated,
    onClose,
}: SetupProps) {
    const t = usePluginTranslation('neon');
    return (
        <div className="neon-connection-setup">
            <style>{styles}</style>
            <div className="neon-provider-intro">
                <div className="neon-inline-actions">
                    <NeonMark size={20} />
                    <h3>{t('connectionSetup.title')}</h3>
                </div>
                <p>{t('connectionSetup.description')}</p>
                <ul className="neon-provider-features">
                    <li>{t('connectionSetup.branches')}</li>
                    <li>{t('connectionSetup.identity')}</li>
                    <li>{t('connectionSetup.backend')}</li>
                </ul>
            </div>
            {isEditing && connectionId ? (
                <ExistingConnection key={connectionId} connectionId={connectionId} />
            ) : (
                <AccountWizard onConnected={onConnectionCreated} onClose={onClose} />
            )}
        </div>
    );
}

function ExistingConnection({connectionId}: {connectionId: string}) {
    const t = usePluginTranslation('neon');
    const account = usePluginAccount('neon');
    const rpc = usePluginRpc('neon', connectionId);
    const task = useTask<Binding & {accountStored: boolean}>();
    const [editAccount, setEditAccount] = useState(false);
    const {run} = task;
    const load = useCallback(
        () =>
            run(async () => {
                const [binding, fields] = await Promise.all([
                    rpc.call<Binding>('neon_management_context'),
                    account.secretFields(),
                ]);
                return {
                    ...binding,
                    accountStored:
                        fields.includes('NEON_API_KEY') || fields.includes('NEON_CLI_AUTH'),
                };
            }),
        [account, rpc, run],
    );
    useEffect(() => {
        void Promise.resolve().then(load);
    }, [load]);
    return (
        <div className="neon-panel neon-existing-connection">
            <h3>{t('connectionSetup.linkedTitle')}</h3>
            <p className="neon-description">{t('connectionSetup.manageHint')}</p>
            {task.pending && (
                <p role="status" className="neon-hint">
                    {t('loading')}
                </p>
            )}
            {task.error && (
                <p role="alert" className="neon-feedback neon-error">
                    {task.error}
                </p>
            )}
            {task.data && (
                <>
                    <dl className="neon-meta-list">
                        <div>
                            <dt>{t('connectionSetup.project')}</dt>
                            <dd>
                                <code>{task.data.projectId ?? t('connectionSetup.notLinked')}</code>
                            </dd>
                        </div>
                        <div>
                            <dt>{t('branch')}</dt>
                            <dd>
                                <code>
                                    {task.data.branchName ??
                                        task.data.branchId ??
                                        t('connectionSetup.notLinked')}
                                </code>
                            </dd>
                        </div>
                    </dl>
                    {(!task.data.projectId || (!task.data.branchId && !task.data.branchName)) && (
                        <p className="neon-hint">{t('connectionSetup.legacyHint')}</p>
                    )}
                    {task.data.accountStored && (
                        <p className="neon-hint">{t('connectionSetup.accountStored')}</p>
                    )}
                    {editAccount || !task.data.accountStored ? (
                        <ManagementAccountForm
                            projectId={task.data.projectId ?? undefined}
                            onConnected={() => {
                                setEditAccount(false);
                                void load();
                            }}
                        />
                    ) : (
                        <div className="neon-row">
                            <button
                                type="button"
                                className="neon-button"
                                onClick={() => setEditAccount(true)}
                            >
                                {t('connectionSetup.reconnect')}
                            </button>
                        </div>
                    )}
                </>
            )}
            {task.error && (
                <button type="button" className="neon-button" onClick={() => void load()}>
                    {t('refresh')}
                </button>
            )}
        </div>
    );
}
