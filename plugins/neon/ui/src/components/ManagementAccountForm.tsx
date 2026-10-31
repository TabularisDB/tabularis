import {useState} from 'react';
import {usePluginAccount, usePluginTranslation} from '@tabularis/plugin-api';

export function ManagementAccountForm({
    projectId,
    onConnected,
}: {
    projectId?: string;
    onConnected: () => void;
}) {
    const t = usePluginTranslation('neon');
    const account = usePluginAccount('neon');
    const [key, setKey] = useState('');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string>();
    return (
        <form
            className="neon-panel"
            style={{padding: 20}}
            onSubmit={(event) => {
                event.preventDefault();
                setPending(true);
                setError(undefined);
                void (async () => {
                    await account.connect({NEON_API_KEY: key.trim()});
                    setKey('');
                    if (projectId) await account.call('account_branches', {projectId});
                    onConnected();
                })()
                    .catch((cause: unknown) =>
                        setError(cause instanceof Error ? cause.message : t('requestFailed')),
                    )
                    .finally(() => setPending(false));
            }}
        >
            <label htmlFor="neon-management-account-key" className="neon-field-label">
                {t('account.apiKey')}
            </label>
            <input
                id="neon-management-account-key"
                className="neon-field"
                type="password"
                autoComplete="off"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                disabled={pending}
                autoFocus
            />
            <p className="neon-hint">{t('account.keyHint')}</p>
            <div className="neon-row">
                <button
                    className="neon-button neon-button-primary"
                    type="submit"
                    disabled={pending || !key.trim()}
                >
                    {t('account.connect')}
                </button>
            </div>
            {error && (
                <p role="alert" className="neon-feedback neon-error">
                    {error}
                </p>
            )}
        </form>
    );
}
