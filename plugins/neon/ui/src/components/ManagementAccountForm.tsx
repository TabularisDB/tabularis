import {useState} from 'react';
import {usePluginAccount, usePluginTranslation} from '@tabularis/plugin-api';
import {AccountAuthentication} from './AccountAuthentication';

export function ManagementAccountForm({
    projectId,
    onConnected,
}: {
    projectId?: string;
    onConnected: () => void;
}) {
    const t = usePluginTranslation('neon');
    const account = usePluginAccount('neon');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string>();
    const connect = async (secrets: Record<string, string>, clearDraft?: () => void) => {
        setPending(true);
        setError(undefined);
        try {
            await account.connect(secrets);
            clearDraft?.();
            if (projectId) await account.call('account_branches', {projectId});
            onConnected();
        } catch {
            setError(t('account.cli.connectFailed'));
        } finally {
            setPending(false);
        }
    };
    return (
        <div className="neon-panel" style={{padding: 20}}>
            <AccountAuthentication
                pending={pending}
                onCliConnected={(profile) => connect({NEON_CLI_AUTH: profile})}
                onApiKeyConnected={(key, clearDraft) =>
                    connect({NEON_API_KEY: key.trim()}, clearDraft)
                }
            />
            {error && (
                <p role="alert" className="neon-feedback neon-error">
                    {error}
                </p>
            )}
        </div>
    );
}
