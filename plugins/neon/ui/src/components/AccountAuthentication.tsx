import {useId, useState} from 'react';
import {PluginSelect, copyText, openUrl, usePluginTranslation} from '@tabularis/plugin-api';
import {useCliAuthentication} from '../hooks/useCliAuthentication';

export function AccountAuthentication({
    onCliConnected,
    onApiKeyConnected,
    pending = false,
}: {
    onCliConnected: (profile: string) => Promise<void> | void;
    onApiKeyConnected: (key: string, clearDraft: () => void) => Promise<void> | void;
    pending?: boolean;
}) {
    const t = usePluginTranslation('neon');
    const id = useId();
    const cli = useCliAuthentication(onCliConnected);
    const [showKey, setShowKey] = useState(false);
    const [showInstall, setShowInstall] = useState(false);
    const [draft, setDraft] = useState('');
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string>();
    const busy = pending || cli.phase !== 'idle';
    const waiting = cli.phase === 'waiting' || cli.phase === 'starting';
    const reasonKey =
        cli.status?.reasonCode === 'unsupported-version'
            ? 'unsupportedVersion'
            : cli.status?.reasonCode === 'keyring'
              ? 'keyringProfile'
              : cli.status?.reasonCode === 'signed-out'
                ? 'signedOut'
                : cli.status?.reasonCode === 'unavailable'
                  ? 'unavailableProfile'
                  : undefined;
    const open = async (url: string) => {
        try {
            await openUrl(url);
        } catch {
            setError('account.cli.browserFailed');
        }
    };
    return (
        <div className="neon-authentication">
            <div className="neon-auth-option">
                <h3 className="neon-auth-title">{t('account.cli.title')}</h3>
                <p className="neon-description">{t('account.cli.description')}</p>
                <details className="neon-disclosure">
                    <summary>{t('account.cli.signInDetails')}</summary>
                    <p className="neon-hint">{t('account.cli.hostHint')}</p>
                    <p className="neon-hint">{t('account.cli.profileStorageHint')}</p>
                </details>
                {cli.phase === 'checking' ? (
                    <p role="status" className="neon-hint neon-pending">
                        {t('account.cli.checking')}
                    </p>
                ) : waiting ? (
                    <>
                        <p role="status" className="neon-hint">
                            {t('account.cli.finishSignIn')}
                        </p>
                        <div className="neon-row">
                            {cli.authUrl && (
                                <button
                                    type="button"
                                    className="neon-button"
                                    onClick={() => void cli.reopen()}
                                >
                                    {t('account.cli.reopen')}
                                </button>
                            )}
                            <button
                                type="button"
                                className="neon-button neon-button-quiet"
                                onClick={cli.cancel}
                            >
                                {t('account.cli.cancel')}
                            </button>
                        </div>
                    </>
                ) : cli.phase === 'connecting' ? (
                    <p role="status" className="neon-hint">
                        {t('loading')}
                    </p>
                ) : (
                    <>
                        <p className="neon-hint">
                            {t(
                                !cli.status
                                    ? 'account.cli.detectFailed'
                                    : cli.status.installed
                                      ? 'account.cli.installed'
                                      : 'account.cli.notInstalled',
                                {
                                    version: cli.status?.version ?? '',
                                },
                            )}
                        </p>
                        {reasonKey && <p className="neon-hint">{t(`account.cli.${reasonKey}`)}</p>}
                        {!!cli.status?.profiles?.length && (
                            <>
                                <label className="neon-field-label" htmlFor={`${id}-profile`}>
                                    {t('account.cli.profile')}
                                </label>
                                <PluginSelect
                                    id={`${id}-profile`}
                                    disabled={busy}
                                    value={cli.selectedProfile ?? cli.status.profile ?? 'DEFAULT'}
                                    onChange={(value) => void cli.recheck(value)}
                                    options={Array.from(
                                        new Set(['DEFAULT', ...cli.status.profiles]),
                                    ).map((profile) => ({value: profile, label: profile}))}
                                />
                            </>
                        )}
                        <div className="neon-row">
                            {cli.status?.installed &&
                            cli.status.reasonCode !== 'unsupported-version' ? (
                                cli.status.canReuse && cli.status.authenticated ? (
                                    <>
                                        <button
                                            type="button"
                                            className="neon-button neon-button-primary"
                                            disabled={busy}
                                            onClick={() => void cli.reuse()}
                                        >
                                            {t('account.cli.useSignedIn')}
                                        </button>
                                        <button
                                            type="button"
                                            className="neon-button neon-button-quiet"
                                            disabled={busy}
                                            onClick={() => void cli.start()}
                                        >
                                            {t('account.cli.signIn')}
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        type="button"
                                        className="neon-button neon-button-primary"
                                        disabled={busy}
                                        onClick={() => void cli.start()}
                                    >
                                        {t('account.cli.signIn')}
                                    </button>
                                )
                            ) : (
                                <button
                                    type="button"
                                    className="neon-button neon-button-primary"
                                    disabled={busy}
                                    aria-expanded={showInstall}
                                    aria-controls={`${id}-install`}
                                    onClick={() => setShowInstall(!showInstall)}
                                >
                                    {t('account.cli.install')}
                                </button>
                            )}
                            <button
                                type="button"
                                className="neon-button neon-button-quiet"
                                disabled={busy}
                                onClick={() => void cli.recheck()}
                            >
                                {t('account.cli.recheck')}
                            </button>
                        </div>
                    </>
                )}
                {showInstall && (
                    <div id={`${id}-install`} className="neon-auth-install">
                        <p className="neon-hint">{t('account.cli.installHint')}</p>
                        <pre className="neon-auth-command">
                            <code>npm install -g neon@latest</code>
                        </pre>
                        <div className="neon-row">
                            <button
                                type="button"
                                className="neon-button"
                                onClick={() => {
                                    setCopied(false);
                                    setError(undefined);
                                    void copyText('npm install -g neon@latest')
                                        .then(() => setCopied(true))
                                        .catch(() => setError('account.cli.copyFailed'));
                                }}
                            >
                                {t('account.cli.copyInstall')}
                            </button>
                            <button
                                type="button"
                                className="neon-button neon-button-quiet"
                                onClick={() => void open('https://neon.com/docs/cli/install')}
                            >
                                {t('account.cli.installGuide')}
                            </button>
                        </div>
                        {copied && (
                            <p role="status" className="neon-hint">
                                {t('account.cli.copied')}
                            </p>
                        )}
                    </div>
                )}
            </div>
            {(cli.error || error) && (
                <p role="alert" className="neon-feedback neon-error">
                    {t(error ?? cli.error ?? 'requestFailed')}
                </p>
            )}
            <button
                type="button"
                className="neon-button neon-button-quiet neon-auth-key-toggle"
                aria-expanded={showKey}
                aria-controls={`${id}-key-form`}
                disabled={pending || cli.phase === 'connecting'}
                onClick={() => {
                    cli.cancel();
                    setShowKey(!showKey);
                }}
            >
                {t('account.cli.useApiKey')}
            </button>
            {showKey && (
                <form
                    id={`${id}-key-form`}
                    onSubmit={(event) => {
                        event.preventDefault();
                        setError(undefined);
                        void Promise.resolve(onApiKeyConnected(draft, () => setDraft(''))).catch(
                            () => setError('account.cli.connectFailed'),
                        );
                    }}
                >
                    <label className="neon-field-label" htmlFor={`${id}-key`}>
                        {t('account.apiKey')}
                    </label>
                    <input
                        id={`${id}-key`}
                        className="neon-field"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={draft}
                        disabled={busy}
                        onChange={(event) => setDraft(event.target.value)}
                        autoFocus
                    />
                    <p className="neon-hint">{t('account.keyHint')}</p>
                    <div className="neon-row">
                        <button
                            type="submit"
                            className="neon-button neon-button-primary"
                            disabled={busy || !draft.trim()}
                        >
                            {t('account.connect')}
                        </button>
                        <button
                            type="button"
                            className="neon-button neon-button-quiet"
                            onClick={() =>
                                void open('https://console.neon.tech/app/settings/api-keys')
                            }
                        >
                            {t('account.createKey')}
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
}
