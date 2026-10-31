import {useId, useState} from 'react';
import {usePluginTranslation} from '@tabularis/plugin-api';
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
                            <div className="neon-columns">
                                <div>
                                    <label className="neon-field-label" htmlFor={`${id}-org`}>
                                        {t('account.organization')}
                                    </label>
                                    <select
                                        id={`${id}-org`}
                                        className="neon-field"
                                        value={state.orgId}
                                        disabled={state.pending}
                                        onChange={(event) =>
                                            void browser.selectOrganization(event.target.value)
                                        }
                                    >
                                        <option value="">{t('account.personal')}</option>
                                        {state.organizations.map((org) => (
                                            <option key={org.id} value={org.id}>
                                                {org.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="neon-field-label" htmlFor={`${id}-project`}>
                                        {t('account.project')}
                                    </label>
                                    <select
                                        id={`${id}-project`}
                                        className="neon-field"
                                        value={state.projectId}
                                        disabled={state.pending || !state.projects.length}
                                        onChange={(event) =>
                                            void browser.selectProject(event.target.value)
                                        }
                                    >
                                        <option value="">{t('account.chooseProject')}</option>
                                        {state.projects.map((project) => (
                                            <option key={project.id} value={project.id}>
                                                {project.name} · {project.regionId}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            {!state.pending && state.projects.length === 0 && (
                                <p className="neon-hint">{t('account.noProjects')}</p>
                            )}
                            <label className="neon-field-label" htmlFor={`${id}-branch`}>
                                {t('account.branch')}
                            </label>
                            <select
                                id={`${id}-branch`}
                                className="neon-field"
                                value={state.branchId}
                                disabled={state.pending || !state.projectId}
                                onChange={(event) => void browser.selectBranch(event.target.value)}
                            >
                                <option value="">{t('account.chooseBranch')}</option>
                                {state.branches.map((branch) => (
                                    <option key={branch.id} value={branch.id}>
                                        {branch.name}
                                    </option>
                                ))}
                            </select>
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
                                            <select
                                                id={`${id}-database`}
                                                className="neon-field"
                                                value={state.database}
                                                disabled={state.pending}
                                                onChange={(event) =>
                                                    browser.selectDatabase(event.target.value)
                                                }
                                            >
                                                <option value="">
                                                    {t('account.chooseDatabase')}
                                                </option>
                                                {state.resources.databases.map((database) => (
                                                    <option
                                                        key={database.name}
                                                        value={database.name}
                                                    >
                                                        {database.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label
                                                className="neon-field-label"
                                                htmlFor={`${id}-role`}
                                            >
                                                {t('account.role')}
                                            </label>
                                            <select
                                                id={`${id}-role`}
                                                className="neon-field"
                                                value={state.role}
                                                disabled={state.pending}
                                                onChange={(event) =>
                                                    browser.selectRole(event.target.value)
                                                }
                                            >
                                                <option value="">{t('account.chooseRole')}</option>
                                                {state.resources.roles.map((role) => (
                                                    <option key={role.name} value={role.name}>
                                                        {role.name}
                                                    </option>
                                                ))}
                                            </select>
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
                            <div className="neon-row">
                                <button
                                    type="button"
                                    className="neon-button neon-button-primary"
                                    disabled={state.pending || !ready}
                                    onClick={() => void browser.importConnection(createCredentials)}
                                >
                                    {t('account.import')}
                                </button>
                                <button
                                    type="button"
                                    className="neon-button neon-button-quiet"
                                    disabled={state.pending}
                                    onClick={() => void browser.reload()}
                                >
                                    {t('refresh')}
                                </button>
                            </div>
                        </>
                    )}
                    {state.pending && (
                        <p role="status" className="neon-hint">
                            {t('loading')}
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
