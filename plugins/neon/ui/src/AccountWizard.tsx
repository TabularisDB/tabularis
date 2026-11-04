import {useId, useState} from 'react';
import {PluginSelect, usePluginTranslation} from '@tabularis/plugin-api';
import {useAccountBrowser} from './hooks/useAccountBrowser';
import {styles} from './styles';
import {AccountAuthentication} from './components/AccountAuthentication';

export function AccountWizard({
    onConnected,
    onClose,
}: {
    onConnected?: () => void | Promise<void>;
    onClose: () => void;
}) {
    const t = usePluginTranslation('neon');
    const id = useId();
    const [createCredentials, setCreateCredentials] = useState(false);
    const browser = useAccountBrowser(onConnected);
    const {state} = browser;
    const ready = !!(
        state.projectId &&
        state.branchId &&
        state.database &&
        state.role &&
        state.resources
    );
    return (
        <div className="neon-panel neon-account">
            <style>{styles}</style>
            {state.imported ? (
                <>
                    <h3>{t('account.imported', {name: state.imported.name})}</h3>
                    <p className="neon-description">{t('account.importedHint')}</p>
                    {state.error && (
                        <div role="alert" className="neon-feedback neon-error">
                            {state.error}
                        </div>
                    )}
                    {state.imported.warnings.length > 0 && (
                        <ul className="neon-account-warnings">
                            {state.imported.warnings.map((warning, index) => (
                                <li key={index}>{warning}</li>
                            ))}
                        </ul>
                    )}
                    <div className="neon-inline-actions">
                        <button
                            type="button"
                            className="neon-button neon-button-primary"
                            onClick={onClose}
                        >
                            {t('account.done')}
                        </button>
                    </div>
                </>
            ) : (
                <>
                    <p className="neon-description">{t('account.description')}</p>
                    {state.connected ? (
                        <div className="neon-account-connected">
                            <span className="neon-status is-configured">
                                {t(
                                    state.authMode === 'cli'
                                        ? 'account.cli.connected'
                                        : 'account.connected',
                                )}
                            </span>
                            <button
                                type="button"
                                className="neon-button neon-button-quiet"
                                disabled={state.pending}
                                onClick={() => void browser.disconnect()}
                            >
                                {t('account.disconnect')}
                            </button>
                        </div>
                    ) : (
                        state.connected === false && (
                            <AccountAuthentication
                                pending={state.pending}
                                onCliConnected={browser.connectCli}
                                onApiKeyConnected={browser.connect}
                            />
                        )
                    )}
                    {state.connected && (
                        <>
                            <div className="neon-account-form">
                                <div className="neon-columns">
                                    <div>
                                        <label className="neon-field-label" htmlFor={`${id}-org`}>
                                            {t('account.organization')}
                                        </label>
                                        <PluginSelect
                                            id={`${id}-org`}
                                            value={state.orgId}
                                            disabled={state.pending && state.loading !== 'projects'}
                                            onChange={(value) =>
                                                void browser.selectOrganization(value)
                                            }
                                            options={[
                                                {value: '', label: t('account.personal')},
                                                ...state.organizations.map((org) => ({
                                                    value: org.id,
                                                    label: org.name,
                                                })),
                                            ]}
                                        />
                                    </div>
                                    <div>
                                        <label
                                            className="neon-field-label"
                                            htmlFor={`${id}-project`}
                                        >
                                            {t('account.project')}
                                        </label>
                                        <PluginSelect
                                            id={`${id}-project`}
                                            value={state.projectId}
                                            placeholder={t('account.chooseProject')}
                                            loading={state.loading === 'projects'}
                                            loadingLabel={t('account.loadingProjects')}
                                            disabled={state.pending || !state.projects.length}
                                            onChange={(value) => void browser.selectProject(value)}
                                            options={[
                                                ...state.projects.map((project) => ({
                                                    value: project.id,
                                                    label: project.name,
                                                    description: project.regionId,
                                                })),
                                            ]}
                                        />
                                    </div>
                                </div>
                                {!state.pending && !state.error && state.projects.length === 0 && (
                                    <p className="neon-hint">{t('account.noProjects')}</p>
                                )}
                                <div>
                                    <label className="neon-field-label" htmlFor={`${id}-branch`}>
                                        {t('account.branch')}
                                    </label>
                                    <PluginSelect
                                        id={`${id}-branch`}
                                        value={state.branchId}
                                        placeholder={t(
                                            state.projectId
                                                ? 'account.chooseBranch'
                                                : 'account.chooseProjectFirst',
                                        )}
                                        loading={state.loading === 'branches'}
                                        loadingLabel={t('account.loadingBranches')}
                                        disabled={state.pending || !state.projectId}
                                        onChange={(value) => void browser.selectBranch(value)}
                                        options={[
                                            ...state.branches.map((branch) => ({
                                                value: branch.id,
                                                label: branch.name,
                                            })),
                                        ]}
                                    />
                                </div>
                            </div>
                            {state.resources && (
                                <>
                                    <div className="neon-columns">
                                        <div>
                                            <label
                                                className="neon-field-label"
                                                htmlFor={`${id}-database`}
                                            >
                                                {t('account.database')}
                                            </label>
                                            <PluginSelect
                                                id={`${id}-database`}
                                                value={state.database}
                                                placeholder={t('account.chooseDatabase')}
                                                disabled={state.pending}
                                                onChange={browser.selectDatabase}
                                                options={[
                                                    ...state.resources.databases.map(
                                                        (database) => ({
                                                            value: database.name,
                                                            label: database.name,
                                                        }),
                                                    ),
                                                ]}
                                            />
                                        </div>
                                        <div>
                                            <label
                                                className="neon-field-label"
                                                htmlFor={`${id}-role`}
                                            >
                                                {t('account.role')}
                                            </label>
                                            <PluginSelect
                                                id={`${id}-role`}
                                                value={state.role}
                                                placeholder={t('account.chooseRole')}
                                                disabled={state.pending}
                                                onChange={browser.selectRole}
                                                options={[
                                                    ...state.resources.roles.map((role) => ({
                                                        value: role.name,
                                                        label: role.name,
                                                    })),
                                                ]}
                                            />
                                        </div>
                                    </div>
                                    <h3 className="neon-account-subtitle">
                                        {t('account.services')}
                                    </h3>
                                    <ul className="neon-field-list">
                                        {state.resources.services.map((service) => (
                                            <li key={service.id}>
                                                <span
                                                    className={`neon-status-dot ${service.enabled ? 'is-configured' : 'is-missing'}`}
                                                />
                                                <span className="neon-grow">
                                                    {t(`account.serviceNames.${service.id}`)}
                                                    {service.warning && (
                                                        <span className="neon-account-service-warning">
                                                            {service.warning}
                                                        </span>
                                                    )}
                                                </span>
                                                <span>
                                                    {t(
                                                        service.warning
                                                            ? 'account.unavailable'
                                                            : service.enabled
                                                              ? 'account.enabled'
                                                              : 'account.notEnabled',
                                                    )}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                    <label className="neon-account-check">
                                        <input
                                            type="checkbox"
                                            checked={createCredentials}
                                            disabled={state.pending}
                                            onChange={(event) =>
                                                setCreateCredentials(event.target.checked)
                                            }
                                        />
                                        <span>{t('account.createCredentials')}</span>
                                    </label>
                                    <p className="neon-hint">{t('account.credentialsHint')}</p>
                                </>
                            )}
                            <div className="neon-account-actions">
                                <button
                                    type="button"
                                    className="neon-button neon-button-quiet"
                                    disabled={state.pending}
                                    onClick={() => void browser.reload()}
                                >
                                    {t('refresh')}
                                </button>
                                <button
                                    type="button"
                                    className="neon-button neon-button-primary"
                                    disabled={state.pending || !ready}
                                    onClick={() => void browser.importConnection(createCredentials)}
                                >
                                    {t('account.import')}
                                </button>
                            </div>
                        </>
                    )}
                    {state.pending &&
                        (!state.connected ||
                            !['projects', 'branches'].includes(state.loading ?? '')) && (
                            <p role="status" className="neon-hint neon-pending">
                                {t(
                                    state.loading === 'resources'
                                        ? 'account.loadingResources'
                                        : 'loading',
                                )}
                            </p>
                        )}
                    {state.error && (
                        <div role="alert" className="neon-feedback neon-error">
                            {state.error}
                        </div>
                    )}
                    {state.error && !state.connected && (
                        <button
                            type="button"
                            className="neon-button"
                            disabled={state.pending}
                            onClick={() => void browser.reload()}
                        >
                            {t('refresh')}
                        </button>
                    )}
                </>
            )}
        </div>
    );
}
