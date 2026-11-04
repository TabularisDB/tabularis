import {useEffect, useId, useState} from 'react';
import {
    PluginSelect,
    PluginResourceList,
    usePluginAccount,
    usePluginTranslation,
} from '@tabularis/plugin-api';
import {useBranches} from './hooks/useBranches';
import {useTask} from './hooks/useTask';
import {PanelSection} from './components/PanelSection';
import {branchDeletionBlocked} from './utils/branches';

interface Resources {
    databases: {name: string}[];
    roles: {name: string}[];
}
export function BranchesManager({connectionId}: {connectionId: string}) {
    const t = usePluginTranslation('neon');
    const id = useId();
    const branches = useBranches(connectionId);
    const account = usePluginAccount('neon');
    const [selectedId, setSelectedId] = useState('');
    const [newName, setNewName] = useState('');
    const [parentId, setParentId] = useState('');
    const [rename, setRename] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [confirmName, setConfirmName] = useState('');
    const [databaseDraft, setDatabaseDraft] = useState('');
    const [roleDraft, setRoleDraft] = useState('');
    const [createCredentials, setCreateCredentials] = useState(false);
    const context = branches.context.data;
    const snapshot = branches.listing.data;
    const selected = snapshot?.branches.find(
        (branch) => branch.id === (selectedId || context?.branchId),
    );
    const resources = useTask<Resources>();
    const {run: loadResources} = resources;
    const projectId = branches.management.scope?.projectId;
    const targetId = selected?.id;
    useEffect(() => {
        if (!projectId || !targetId) return;
        void Promise.resolve().then(() =>
            loadResources(() =>
                account.call<Resources>('account_resources', {projectId, branchId: targetId}),
            ),
        );
    }, [projectId, targetId, loadResources, account]);
    const database =
        databaseDraft ||
        (resources.data?.databases.some((item) => item.name === context?.database)
            ? context?.database
            : '') ||
        '';
    const role =
        roleDraft ||
        (resources.data?.roles.some((item) => item.name === context?.role) ? context?.role : '') ||
        '';
    const pending = branches.pending || resources.pending;
    const error =
        branches.context.error ??
        branches.listing.error ??
        branches.action.error ??
        resources.error;
    const blocked =
        !selected ||
        !context?.branchId ||
        !context.projectId ||
        !snapshot ||
        branchDeletionBlocked(selected, context.branchId, snapshot, context.projectId);
    if (!branches.management.scope && branches.management.pending)
        return (
            <p className="neon-hint neon-pending" role="status">
                {t('loading')}
            </p>
        );
    if (!branches.management.scope)
        return (
            <div className="neon-view">
                <p className="neon-description">
                    {branches.management.error ?? t('management.connectRequired')}
                </p>
                <div className="neon-row">
                    <button
                        type="button"
                        className="neon-button neon-button-primary"
                        onClick={branches.management.connectAccount}
                    >
                        {t('account.connectNeon')}
                    </button>
                    <button
                        type="button"
                        className="neon-button"
                        disabled={branches.management.pending}
                        onClick={branches.management.reload}
                    >
                        {t('refresh')}
                    </button>
                </div>
            </div>
        );
    return (
        <div className="neon-view">
            <div className="neon-toolbar">
                <div>
                    <h3 className="neon-auth-title">
                        {snapshot?.projectName ?? context?.projectId}
                    </h3>
                    <p className="neon-description">{t('branches.description')}</p>
                </div>
                <div className="neon-inline-actions">
                    <button
                        type="button"
                        className="neon-button neon-button-quiet"
                        onClick={branches.management.connectAccount}
                    >
                        {t('branches.account')}
                    </button>
                    <button
                        type="button"
                        className="neon-button"
                        disabled={pending}
                        onClick={() => void branches.refresh()}
                    >
                        {t('refresh')}
                    </button>
                </div>
            </div>
            {pending && (
                <p className="neon-hint neon-pending" role="status">
                    {t('loading')}
                </p>
            )}
            {error && (
                <p className="neon-feedback neon-error" role="alert">
                    {error}
                </p>
            )}
            {branches.action.data && (
                <p className="neon-success" role="status">
                    {branches.action.data.message}
                </p>
            )}
            <div className="neon-workbench neon-branches-layout">
                <div>
                    {snapshot && (
                        <PluginResourceList
                            label={t('branches.title')}
                            emptyMessage={t('branches.empty')}
                            items={snapshot.branches.map((branch) => ({
                                id: branch.id,
                                title: branch.name,
                                subtitle: branch.parentId
                                    ? `${t('branches.parent')}: ${snapshot.branches.find((parent) => parent.id === branch.parentId)?.name ?? branch.parentId}`
                                    : t('branches.root'),
                                status:
                                    branch.id === context?.branchId
                                        ? t('branches.current')
                                        : branch.isDefault
                                          ? t('branches.default')
                                          : branch.protected
                                            ? t('branches.protected')
                                            : branch.state,
                            }))}
                            onOpen={(branchId) => {
                                setSelectedId(branchId);
                                setRename('');
                                setConfirmDelete(false);
                                setConfirmName('');
                                setDatabaseDraft('');
                                setRoleDraft('');
                                setCreateCredentials(false);
                            }}
                        />
                    )}
                    <details className="neon-disclosure">
                        <summary>{t('branches.create')}</summary>
                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                void branches
                                    .mutate(
                                        'account_branch_create',
                                        {
                                            name: newName.trim(),
                                            parentId: parentId || context?.branchId,
                                        },
                                        t('branches.created'),
                                    )
                                    .then((result) => {
                                        if (result) setNewName('');
                                    });
                            }}
                        >
                            <label className="neon-field-label" htmlFor={`${id}-new-name`}>
                                {t('branches.name')}
                            </label>
                            <input
                                id={`${id}-new-name`}
                                className="neon-field"
                                value={newName}
                                maxLength={255}
                                required
                                disabled={pending}
                                onChange={(event) => setNewName(event.target.value)}
                            />
                            <label className="neon-field-label" htmlFor={`${id}-parent`}>
                                {t('branches.parent')}
                            </label>
                            <PluginSelect
                                id={`${id}-parent`}
                                value={parentId || context?.branchId || ''}
                                disabled={pending}
                                loading={branches.listing.pending}
                                loadingLabel={t('account.loadingBranches')}
                                onChange={setParentId}
                                options={
                                    snapshot?.branches.map((branch) => ({
                                        value: branch.id,
                                        label: branch.name,
                                    })) ?? []
                                }
                            />
                            <p className="neon-hint">{t('branches.copyHint')}</p>
                            <div className="neon-row">
                                <button
                                    type="submit"
                                    className="neon-button neon-button-primary"
                                    disabled={pending || !newName.trim()}
                                >
                                    {t('branches.create')}
                                </button>
                            </div>
                        </form>
                    </details>
                </div>
                {selected && (
                    <div>
                        <PanelSection title={selected.name} hint={t('branches.isolationHint')}>
                            <div className="neon-fields">
                                <code className="neon-code">{selected.id}</code>
                                {selected.isDefault && (
                                    <span className="neon-status">{t('branches.default')}</span>
                                )}
                                {selected.protected && (
                                    <span className="neon-status">{t('branches.protected')}</span>
                                )}
                            </div>
                            <div className="neon-columns">
                                <div>
                                    <label className="neon-field-label" htmlFor={`${id}-database`}>
                                        {t('account.database')}
                                    </label>
                                    <PluginSelect
                                        id={`${id}-database`}
                                        value={database}
                                        placeholder={t('account.chooseDatabase')}
                                        disabled={pending}
                                        loading={resources.pending}
                                        loadingLabel={t('account.loadingResources')}
                                        onChange={setDatabaseDraft}
                                        options={
                                            resources.data?.databases.map((item) => ({
                                                value: item.name,
                                                label: item.name,
                                            })) ?? []
                                        }
                                    />
                                </div>
                                <div>
                                    <label className="neon-field-label" htmlFor={`${id}-role`}>
                                        {t('account.role')}
                                    </label>
                                    <PluginSelect
                                        id={`${id}-role`}
                                        value={role}
                                        placeholder={t('account.chooseRole')}
                                        disabled={pending}
                                        loading={resources.pending}
                                        loadingLabel={t('account.loadingResources')}
                                        onChange={setRoleDraft}
                                        options={
                                            resources.data?.roles.map((item) => ({
                                                value: item.name,
                                                label: item.name,
                                            })) ?? []
                                        }
                                    />
                                </div>
                            </div>
                            <label className="neon-account-check">
                                <input
                                    type="checkbox"
                                    checked={createCredentials}
                                    disabled={pending}
                                    onChange={(event) => setCreateCredentials(event.target.checked)}
                                />
                                {t('account.createCredentials')}
                            </label>
                            <p className="neon-hint">{t('account.credentialsHint')}</p>
                            <div className="neon-row">
                                <button
                                    type="button"
                                    className="neon-button neon-button-primary"
                                    disabled={pending || !database || !role}
                                    onClick={() =>
                                        void branches.openBranch(selected.id, false, {
                                            database,
                                            role,
                                            createServiceCredentials: createCredentials,
                                        })
                                    }
                                >
                                    {t('branches.switch')}
                                </button>
                                <button
                                    type="button"
                                    className="neon-button"
                                    disabled={pending || !database || !role}
                                    onClick={() =>
                                        void branches.openBranch(selected.id, true, {
                                            database,
                                            role,
                                            createServiceCredentials: createCredentials,
                                        })
                                    }
                                >
                                    {t('branches.openNew')}
                                </button>
                            </div>
                        </PanelSection>
                        <PanelSection title={t('branches.rename')}>
                            <form
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    void branches
                                        .mutate(
                                            'account_branch_rename',
                                            {targetBranchId: selected.id, name: rename.trim()},
                                            t('branches.renamed'),
                                        )
                                        .then((result) => {
                                            if (result) setRename('');
                                        });
                                }}
                            >
                                <label className="neon-field-label" htmlFor={`${id}-rename`}>
                                    {t('branches.newName')}
                                </label>
                                <div className="neon-inline-actions">
                                    <input
                                        id={`${id}-rename`}
                                        className="neon-field neon-grow"
                                        value={rename}
                                        maxLength={255}
                                        disabled={pending}
                                        onChange={(event) => setRename(event.target.value)}
                                    />
                                    <button
                                        type="submit"
                                        className="neon-button"
                                        disabled={
                                            pending ||
                                            !rename.trim() ||
                                            rename.trim() === selected.name
                                        }
                                    >
                                        {t('branches.rename')}
                                    </button>
                                </div>
                            </form>
                        </PanelSection>
                        <details className="neon-disclosure">
                            <summary>{t('branches.delete')}</summary>
                            <p className="neon-hint">
                                {t(
                                    snapshot?.unresolvedConnections
                                        ? 'branches.unresolved'
                                        : blocked
                                          ? 'branches.deleteBlocked'
                                          : 'branches.deleteHint',
                                )}
                            </p>
                            <button
                                type="button"
                                className="neon-button neon-button-danger"
                                disabled={pending || blocked}
                                onClick={() => setConfirmDelete(true)}
                            >
                                {t('branches.delete')}
                            </button>
                            {confirmDelete && !blocked && (
                                <div className="neon-confirmation">
                                    <label className="neon-field-label" htmlFor={`${id}-confirm`}>
                                        {t('branches.typeName', {name: selected.name})}
                                    </label>
                                    <input
                                        id={`${id}-confirm`}
                                        className="neon-field"
                                        autoComplete="off"
                                        value={confirmName}
                                        onChange={(event) => setConfirmName(event.target.value)}
                                    />
                                    <div className="neon-row">
                                        <button
                                            type="button"
                                            className="neon-button neon-button-danger"
                                            disabled={pending || confirmName !== selected.name}
                                            onClick={() =>
                                                void branches
                                                    .mutate(
                                                        'account_branch_delete',
                                                        {targetBranchId: selected.id, confirmName},
                                                        t('branches.deleted'),
                                                    )
                                                    .then((result) => {
                                                        if (result) {
                                                            setSelectedId('');
                                                            setConfirmDelete(false);
                                                            setConfirmName('');
                                                        }
                                                    })
                                            }
                                        >
                                            {t('branches.confirmDelete')}
                                        </button>
                                        <button
                                            type="button"
                                            className="neon-button"
                                            onClick={() => setConfirmDelete(false)}
                                        >
                                            {t('cancel')}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </details>
                    </div>
                )}
            </div>
        </div>
    );
}
