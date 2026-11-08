import {useCallback, useEffect, useState, type ReactNode} from 'react';
import {
    PluginSelect,
    openUrl,
    PluginWorkspaceShell,
    usePluginWorkspace,
    usePluginRpc,
    usePluginTranslation,
    type PluginQueryResult,
} from '@tabularis/plugin-api';
import {useTask} from './hooks/useTask';
import {DataTable} from './components/DataTable';
import {
    credentialNames,
    CredentialParseError,
    parseCredentials,
    type CredentialError,
} from './utils/credentials';
import {objectRows} from './utils/data';
import {styles} from './styles';
import type {NeonService} from './services';
import {databaseSummary} from './utils/status';
import {consoleUrl} from './utils/console';
import type {BranchContext} from './types/branches';
import {PanelSection, ResultPlaceholder} from './components/PanelSection';
import {BranchesManager} from './BranchesManager';
import {FunctionsManager} from './FunctionsManager';
import {AuthManager} from './AuthManager';
import {UsagePanel} from './UsagePanel';

interface ConnectedProps {
    connectionId: string;
}
interface NeonStatus {
    connectionId: string;
    branch: string;
    projectId: string | null;
    database: PluginQueryResult | null;
    services: {name: string; configured: boolean}[];
}

export function NeonPanel({
    connectionId,
    connectionName,
    serviceId = 'overview',
    functionSlug,
    createFunction,
    authUserId,
}: {
    connectionId: string | null;
    connectionName?: string;
    serviceId?: NeonService;
    functionSlug?: string;
    createFunction?: boolean;
    authUserId?: string;
}) {
    const t = usePluginTranslation('neon');
    const tab = serviceId;
    let content: ReactNode;
    if (!connectionId) content = <div className="neon-empty">{t('noConnection')}</div>;
    else if (tab === 'branches') content = <BranchesManager connectionId={connectionId} />;
    else if (tab === 'overview') content = <Overview connectionId={connectionId} />;
    else if (tab === 'users')
        content = <AuthManager connectionId={connectionId} userId={authUserId} />;
    else if (tab === 'database')
        content = <p className="neon-description">{t('databaseNativeHint')}</p>;
    else if (tab === 'storage') content = <Storage connectionId={connectionId} />;
    else if (tab === 'ai') content = <Ai connectionId={connectionId} />;
    else if (tab === 'functions')
        content = (
            <FunctionsManager
                connectionId={connectionId}
                slug={functionSlug}
                create={createFunction}
                fallback={<Functions connectionId={connectionId} />}
            />
        );
    else if (tab === 'realtime') content = <Realtime connectionId={connectionId} />;
    else content = <Setup connectionId={connectionId} />;
    return (
        <div className="neon-panel">
            <style>{styles}</style>
            <PluginWorkspaceShell
                title={
                    createFunction
                        ? t('functionsManager.newFunction')
                        : (functionSlug ?? t(`tabs.${serviceId}`))
                }
                subtitle={connectionName ?? t('selectedConnection')}
                actions={connectionId ? <ConsoleLink connectionId={connectionId} /> : undefined}
            >
                {content}
            </PluginWorkspaceShell>
        </div>
    );
}

function ConsoleLink({connectionId}: ConnectedProps) {
    const t = usePluginTranslation('neon');
    const {call} = usePluginRpc('neon', connectionId);
    const task = useTask<void>();
    return (
        <div>
            <button
                type="button"
                className="neon-link"
                disabled={task.pending}
                onClick={() =>
                    void task.run(async () => {
                        const binding = await call<BranchContext>('neon_branch_context');
                        const url = consoleUrl(binding);
                        if (!url) throw new Error(t('consoleBindingMissing'));
                        await openUrl(url);
                    })
                }
            >
                {t('console')}
            </button>
            <Feedback {...task} />
        </div>
    );
}

function Feedback({
    pending,
    error,
    waiting = false,
}: {
    pending: boolean;
    error?: string;
    waiting?: boolean;
}) {
    const t = usePluginTranslation('neon');
    return (
        <>
            {pending && (
                <div className="neon-feedback neon-pending" role="status">
                    {t(waiting ? 'waiting' : 'loading')}
                </div>
            )}
            {error && (
                <div className="neon-feedback neon-error" role="alert">
                    {error}
                </div>
            )}
        </>
    );
}

function Overview({connectionId}: ConnectedProps) {
    const t = usePluginTranslation('neon');
    const {call} = usePluginRpc('neon', connectionId);
    const {openWorkspace} = usePluginWorkspace('neon');
    const task = useTask<NeonStatus>();
    const inspection = useTask<NeonStatus>();
    const navigation = useTask<void>();
    const {run} = task;
    const inspect = inspection.run;
    const load = useCallback(
        () =>
            Promise.all([
                run(() => call<NeonStatus>('neon_status', {metadataOnly: true})),
                inspect(() => call<NeonStatus>('neon_status')),
            ]),
        [call, run, inspect],
    );
    useEffect(() => {
        void Promise.resolve().then(load);
    }, [load]);
    const database = inspection.data?.database
        ? databaseSummary(inspection.data.database)
        : undefined;
    const destinations: Record<string, NeonService> = {
        Auth: 'users',
        Storage: 'storage',
        'AI Gateway': 'ai',
        Functions: 'functions',
        Realtime: 'realtime',
    };
    const count = task.data?.services.filter((service) => service.configured).length ?? 0;
    return (
        <div className="neon-view">
            <div className="neon-toolbar">
                <p className="neon-description">{t('overviewDescription')}</p>
                <button
                    className="neon-button"
                    disabled={task.pending || inspection.pending}
                    onClick={() => void load()}
                >
                    {t('refresh')}
                </button>
            </div>
            <Feedback {...task} />
            <Feedback {...inspection} />
            <Feedback {...navigation} />
            <UsagePanel connectionId={connectionId} />
            {task.data && (
                <>
                    <dl className="neon-summary-strip">
                        <div>
                            <dt>{t('branch')}</dt>
                            <dd>
                                <code>{task.data.branch}</code>
                            </dd>
                        </div>
                        <div>
                            <dt>{t('databaseName')}</dt>
                            <dd>{database?.name || t('unknown')}</dd>
                        </div>
                        <div>
                            <dt>{t('serverVersion')}</dt>
                            <dd>
                                {database?.version
                                    ? `PostgreSQL ${database.version}`
                                    : t('unknown')}
                            </dd>
                        </div>
                    </dl>
                    <PanelSection
                        title={t('services')}
                        actions={
                            <span className="neon-count">
                                {t('configuredCount', {count, total: task.data.services.length})}
                            </span>
                        }
                    >
                        <div className="neon-service-list">
                            {task.data.services.map((service) => {
                                const target = destinations[service.name];
                                const name =
                                    service.name === 'Postgres'
                                        ? 'PostgreSQL'
                                        : target
                                          ? t(`tabs.${target}`)
                                          : service.name;
                                return (
                                    <div className="neon-service" key={service.name}>
                                        <span
                                            className={`neon-status-dot ${service.configured ? 'is-configured' : 'is-missing'}`}
                                            aria-hidden="true"
                                        />
                                        <div className="neon-service-name">
                                            <strong>{name}</strong>
                                            {service.name === 'Postgres' ? (
                                                <span>{t('databaseNativeHintShort')}</span>
                                            ) : (
                                                target && <span>{t(`serviceHints.${target}`)}</span>
                                            )}
                                        </div>
                                        <span
                                            className={`neon-status ${service.configured ? 'is-configured' : 'is-missing'}`}
                                        >
                                            {t(service.configured ? 'configured' : 'needsSetup')}
                                        </span>
                                        {target && (
                                            <button
                                                className="neon-button neon-button-quiet"
                                                aria-label={t(
                                                    service.configured
                                                        ? 'openServiceNamed'
                                                        : 'configureServiceNamed',
                                                    {name},
                                                )}
                                                disabled={navigation.pending}
                                                onClick={() =>
                                                    void navigation.run(async () => {
                                                        openWorkspace({
                                                            id: !service.configured
                                                                ? 'setup'
                                                                : target === 'overview'
                                                                  ? 'services'
                                                                  : target,
                                                            title: `Neon · ${t(`tabs.${service.configured ? target : 'setup'}`)}`,
                                                            connectionId,
                                                        });
                                                    })
                                                }
                                            >
                                                {t(
                                                    service.configured
                                                        ? 'openService'
                                                        : 'configure',
                                                )}
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </PanelSection>
                    <details className="neon-disclosure">
                        <summary>{t('connectionDetails')}</summary>
                        <dl className="neon-meta-list">
                            {task.data.projectId && (
                                <div>
                                    <dt>{t('projectId')}</dt>
                                    <dd>
                                        <code>{task.data.projectId}</code>
                                    </dd>
                                </div>
                            )}
                            <div>
                                <dt>{t('serverDetails')}</dt>
                                <dd>{database?.details || t('unknown')}</dd>
                            </div>
                        </dl>
                    </details>
                </>
            )}
            <PanelSection title={t('projectBranches')} hint={t('branches.isolationHint')}>
                <button
                    type="button"
                    className="neon-button"
                    disabled={navigation.pending}
                    onClick={() =>
                        void navigation.run(async () => {
                            openWorkspace({
                                id: 'branches',
                                title: `Neon · ${t('tabs.branches')}`,
                                connectionId,
                            });
                        })
                    }
                >
                    {t('branches.manage')}
                </button>
            </PanelSection>
        </div>
    );
}

interface StoredObject {
    Key: string;
    Size?: number;
    LastModified?: string;
}

function Storage({connectionId}: ConnectedProps) {
    const t = usePluginTranslation('neon');
    const {call} = usePluginRpc('neon', connectionId);
    const listing = useTask<StoredObject[]>();
    const action = useTask<{body?: string; message?: string}>();
    const [prefix, setPrefix] = useState('');
    const [key, setKey] = useState('tabularis/hello.txt');
    const [body, setBody] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [confirmPut, setConfirmPut] = useState(false);
    const load = () => listing.run(() => call('neon_storage_list', {prefix}));
    const mutate = async (method: 'neon_storage_put' | 'neon_storage_delete') => {
        setConfirmDelete(false);
        setConfirmPut(false);
        const result = await action.run(async () => {
            await call(method, method === 'neon_storage_put' ? {key, body} : {key});
            return {message: t(method === 'neon_storage_put' ? 'objectSaved' : 'objectDeleted')};
        });
        if (result) void load();
    };
    return (
        <div className="neon-workbench">
            <PanelSection
                title={t('objects')}
                hint={t('storageDescription')}
                actions={<code className="neon-code">assets</code>}
            >
                <div className="neon-filterbar">
                    <div className="neon-grow">
                        <label className="neon-field-label" htmlFor="neon-prefix">
                            {t('prefix')}
                        </label>
                        <input
                            className="neon-field"
                            id="neon-prefix"
                            value={prefix}
                            onChange={(event) => setPrefix(event.target.value)}
                        />
                    </div>
                    <button
                        className="neon-button"
                        disabled={listing.pending}
                        onClick={() => void load()}
                    >
                        {t('listObjects')}
                    </button>
                </div>
                <Feedback {...listing} />
                {listing.data ? (
                    listing.data.length ? (
                        <>
                            <DataTable
                                data={{
                                    columns: [t('objectKey'), t('bytes'), t('modified')],
                                    rows: listing.data.map((item) => [
                                        item.Key,
                                        item.Size ?? null,
                                        item.LastModified ?? null,
                                    ]),
                                }}
                            />
                            <p className="neon-result-count">
                                {t('objectCount', {count: listing.data.length})}
                            </p>
                        </>
                    ) : (
                        <ResultPlaceholder>{t('empty')}</ResultPlaceholder>
                    )
                ) : (
                    !listing.pending && <ResultPlaceholder>{t('storageEmpty')}</ResultPlaceholder>
                )}
            </PanelSection>
            <div>
                <PanelSection title={t('objectEditor')} hint={t('textObjectsHint')}>
                    {listing.pending || listing.data?.length ? (
                        <>
                            <label className="neon-field-label" htmlFor="neon-existing-object">
                                {t('existingObject')}
                            </label>
                            <PluginSelect
                                id="neon-existing-object"
                                value={listing.data?.some((item) => item.Key === key) ? key : ''}
                                placeholder={t('chooseObject')}
                                disabled={action.pending}
                                loading={listing.pending}
                                loadingLabel={t('loadingObjects')}
                                onChange={(value) => {
                                    setKey(value);
                                    setConfirmDelete(false);
                                    setConfirmPut(false);
                                }}
                                options={
                                    listing.data?.map((item) => ({
                                        value: item.Key,
                                        label: item.Key,
                                    })) ?? []
                                }
                            />
                        </>
                    ) : null}
                    <label className="neon-field-label" htmlFor="neon-key">
                        {t('objectKey')}
                    </label>
                    <input
                        className="neon-field"
                        id="neon-key"
                        value={key}
                        disabled={action.pending}
                        onChange={(event) => {
                            setKey(event.target.value);
                            setConfirmDelete(false);
                            setConfirmPut(false);
                        }}
                    />
                    <label className="neon-field-label" htmlFor="neon-body">
                        {t('objectBody')}
                    </label>
                    <textarea
                        className="neon-field neon-editor"
                        id="neon-body"
                        rows={7}
                        value={body}
                        disabled={action.pending}
                        onChange={(event) => {
                            setBody(event.target.value);
                            setConfirmPut(false);
                        }}
                        placeholder={t('bodyPlaceholder')}
                    />
                    <div className="neon-actionbar">
                        <div className="neon-inline-actions">
                            <button
                                className="neon-button neon-button-primary"
                                disabled={action.pending || !key.trim() || !body}
                                onClick={() => {
                                    setConfirmPut(true);
                                    setConfirmDelete(false);
                                }}
                            >
                                {t('saveObject')}
                            </button>
                            <button
                                className="neon-button"
                                disabled={action.pending || !key.trim()}
                                onClick={() =>
                                    void action.run(() => call('neon_storage_get', {key}))
                                }
                            >
                                {t('readObject')}
                            </button>
                        </div>
                        <button
                            className="neon-button neon-button-danger"
                            disabled={action.pending || !key.trim()}
                            onClick={() => {
                                setConfirmDelete(true);
                                setConfirmPut(false);
                            }}
                        >
                            {t('deleteObject')}
                        </button>
                    </div>
                    {(confirmDelete || confirmPut) && (
                        <div className="neon-confirmation">
                            <p>
                                {t(confirmDelete ? 'deleteObjectConfirm' : 'putObjectConfirm', {
                                    key,
                                })}
                            </p>
                            <div className="neon-inline-actions">
                                <button
                                    className={`neon-button ${confirmDelete ? 'neon-button-danger' : 'neon-button-primary'}`}
                                    onClick={() =>
                                        void mutate(
                                            confirmDelete
                                                ? 'neon_storage_delete'
                                                : 'neon_storage_put',
                                        )
                                    }
                                >
                                    {t('confirm')}
                                </button>
                                <button
                                    className="neon-button"
                                    onClick={() => {
                                        setConfirmDelete(false);
                                        setConfirmPut(false);
                                    }}
                                >
                                    {t('cancel')}
                                </button>
                            </div>
                        </div>
                    )}
                    <Feedback {...action} />
                    {action.data?.message && (
                        <p className="neon-success" role="status">
                            {action.data.message}
                        </p>
                    )}
                </PanelSection>
                {action.data?.body !== undefined && (
                    <PanelSection title={t('response')}>
                        <pre className="neon-output">{action.data.body}</pre>
                    </PanelSection>
                )}
            </div>
        </div>
    );
}

function Ai({connectionId}: ConnectedProps) {
    const t = usePluginTranslation('neon');
    const {call} = usePluginRpc('neon', connectionId);
    const models = useTask<{data: {id: string; enabled?: boolean}[]}>();
    const completion = useTask<{choices?: {message?: {content?: string}}[]}>();
    const [selected, setSelected] = useState('');
    const [prompt, setPrompt] = useState('');
    const available = models.data?.data.filter((model) => model.enabled !== false) ?? [];
    const model = selected || available[0]?.id || '';
    return (
        <div className="neon-workbench neon-workbench-balanced">
            <PanelSection title={t('prompt')} hint={t('aiDescription')}>
                <div className="neon-filterbar">
                    <div className="neon-grow">
                        <label className="neon-field-label" htmlFor="neon-model">
                            {t('model')}
                        </label>
                        <PluginSelect
                            id="neon-model"
                            value={model}
                            placeholder={t('chooseModel')}
                            onChange={setSelected}
                            disabled={!available.length}
                            loading={models.pending}
                            loadingLabel={t('loadingModels')}
                            options={available.map((item) => ({value: item.id, label: item.id}))}
                        />
                    </div>
                    <button
                        className="neon-button"
                        disabled={models.pending}
                        onClick={() => void models.run(() => call('neon_ai_models'))}
                    >
                        {t('loadModels')}
                    </button>
                </div>
                <Feedback {...models} />
                {models.data && !available.length && <p className="neon-hint">{t('noModels')}</p>}
                <label className="neon-field-label" htmlFor="neon-prompt">
                    {t('prompt')}
                </label>
                <textarea
                    className="neon-field neon-editor neon-prompt"
                    id="neon-prompt"
                    rows={10}
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder={t('promptPlaceholder')}
                />
                <div className="neon-actionbar">
                    <button
                        className="neon-button neon-button-primary"
                        disabled={!model || !prompt.trim() || completion.pending}
                        onClick={() =>
                            void completion.run(() => call('neon_ai_complete', {model, prompt}))
                        }
                    >
                        {t('generate')}
                    </button>
                </div>
                <p className="neon-hint">{t('aiCost')}</p>
            </PanelSection>
            <PanelSection
                title={t('response')}
                actions={
                    model ? (
                        <span className="neon-muted-code" title={model}>
                            {model}
                        </span>
                    ) : undefined
                }
            >
                <Feedback {...completion} />
                {completion.data ? (
                    <pre className="neon-output neon-answer">
                        {completion.data.choices?.[0]?.message?.content || t('emptyResponse')}
                    </pre>
                ) : (
                    !completion.pending && <ResultPlaceholder>{t('aiEmpty')}</ResultPlaceholder>
                )}
            </PanelSection>
        </div>
    );
}

function Functions({connectionId}: ConnectedProps) {
    const t = usePluginTranslation('neon');
    const {call} = usePluginRpc('neon', connectionId);
    const task = useTask<{status: number; body: string}>();
    return (
        <div className="neon-workbench neon-workbench-balanced">
            <PanelSection
                title="hello"
                hint={t('functionsDescription')}
                actions={<span className="neon-status">HTTP</span>}
            >
                <dl className="neon-meta-list">
                    <div>
                        <dt>{t('functionName')}</dt>
                        <dd>
                            <code>hello</code>
                        </dd>
                    </div>
                    <div>
                        <dt>{t('functionAccess')}</dt>
                        <dd>{t('publicFunction')}</dd>
                    </div>
                </dl>
                <div className="neon-actionbar">
                    <button
                        className="neon-button neon-button-primary"
                        disabled={task.pending}
                        onClick={() => void task.run(() => call('neon_function'))}
                    >
                        {t('invokeFunction')}
                    </button>
                </div>
            </PanelSection>
            <PanelSection
                title={t('response')}
                actions={
                    task.data ? (
                        <span
                            className={`neon-status ${task.data.status < 400 ? 'is-configured' : 'is-missing'}`}
                        >
                            HTTP {task.data.status}
                        </span>
                    ) : undefined
                }
            >
                <Feedback {...task} />
                {task.data ? (
                    <pre className="neon-output">{task.data.body}</pre>
                ) : (
                    !task.pending && <ResultPlaceholder>{t('functionEmpty')}</ResultPlaceholder>
                )}
            </PanelSection>
        </div>
    );
}

function Realtime({connectionId}: ConnectedProps) {
    const t = usePluginTranslation('neon');
    const {call} = usePluginRpc('neon', connectionId);
    const task = useTask<Record<string, unknown>[]>();
    const [query, setQuery] = useState(
        'SELECT id, title, body, updated_at FROM tabularis_demo.notes ORDER BY id LIMIT 20',
    );
    const [column, setColumn] = useState('');
    const [until, setUntil] = useState('');
    const valid = /^\s*select\b/i.test(query) && (!until || !!column.trim());
    return (
        <div className="neon-view">
            <PanelSection
                title={t('query')}
                hint={t('realtimeDescription')}
                actions={<span className="neon-status">{t('readOnly')}</span>}
            >
                <label className="neon-field-label" htmlFor="neon-query">
                    {t('readQuery')}
                </label>
                <textarea
                    className="neon-field neon-editor neon-query"
                    id="neon-query"
                    rows={6}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    spellCheck={false}
                />
                <details className="neon-disclosure">
                    <summary>{t('waitOptions')}</summary>
                    <div className="neon-columns">
                        <div>
                            <label className="neon-field-label" htmlFor="neon-column">
                                {t('watchColumn')}
                            </label>
                            <input
                                className="neon-field"
                                id="neon-column"
                                value={column}
                                onChange={(event) => setColumn(event.target.value)}
                                placeholder="title"
                            />
                        </div>
                        <div>
                            <label className="neon-field-label" htmlFor="neon-until">
                                {t('targetValue')}
                            </label>
                            <input
                                className="neon-field"
                                id="neon-until"
                                value={until}
                                onChange={(event) => setUntil(event.target.value)}
                                placeholder={t('targetPlaceholder')}
                            />
                        </div>
                    </div>
                    <p className="neon-hint">{t('realtimeHint')}</p>
                </details>
                <div className="neon-actionbar">
                    <button
                        className="neon-button neon-button-primary"
                        disabled={!valid || task.pending}
                        onClick={() =>
                            void task.run(() =>
                                call('neon_realtime_snapshot', {
                                    query,
                                    ...(until ? {column, until} : {}),
                                }),
                            )
                        }
                    >
                        {t(until ? 'waitSnapshot' : 'readSnapshot')}
                    </button>
                    <span className="neon-hint">{t('snapshotTimeout')}</span>
                </div>
            </PanelSection>
            <PanelSection
                title={t('snapshot')}
                actions={
                    task.data ? (
                        <span className="neon-count">
                            {t('recordCount', {count: task.data.length})}
                        </span>
                    ) : undefined
                }
            >
                <Feedback {...task} waiting />
                {task.data ? (
                    <>
                        <DataTable data={objectRows(task.data)} />
                        <p className="neon-result-count">{t('snapshotComplete')}</p>
                    </>
                ) : (
                    !task.pending && <ResultPlaceholder>{t('realtimeEmpty')}</ResultPlaceholder>
                )}
            </PanelSection>
        </div>
    );
}

function Setup({connectionId}: ConnectedProps) {
    const t = usePluginTranslation('neon');
    const {saveSecrets, secretFields, deleteSecrets} = usePluginRpc('neon', connectionId);
    const task = useTask<{fields: string[]; saved?: boolean; deleted?: boolean}>();
    const {run} = task;
    const [draft, setDraft] = useState('');
    const [validation, setValidation] = useState<CredentialError>();
    const [confirmDelete, setConfirmDelete] = useState(false);
    const load = useCallback(
        () => run(async () => ({fields: await secretFields()})),
        [secretFields, run],
    );
    useEffect(() => {
        void Promise.resolve().then(load);
    }, [load]);
    const save = async () => {
        let credentials: Record<string, string>;
        try {
            credentials = parseCredentials(draft);
        } catch (error) {
            setValidation(error instanceof CredentialParseError ? error.code : 'syntax');
            return;
        }
        setValidation(undefined);
        const fields = Object.keys(credentials);
        const result = await task.run(async () => {
            await saveSecrets(credentials);
            return {fields, saved: true};
        });
        if (result) setDraft('');
    };
    return (
        <div className="neon-workbench neon-workbench-settings">
            <div>
                <PanelSection title={t('importCredentials')} hint={t('setupDescription')}>
                    <p className="neon-hint">{t('setupHint')}</p>
                    <label className="neon-field-label" htmlFor="neon-credentials">
                        {t('importLabel')}
                    </label>
                    <textarea
                        className="neon-field neon-secret neon-editor"
                        id="neon-credentials"
                        rows={9}
                        value={draft}
                        disabled={task.pending}
                        onChange={(event) => {
                            setDraft(event.target.value);
                            setValidation(undefined);
                        }}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder={t('importPlaceholder')}
                    />
                    {validation && (
                        <div className="neon-feedback neon-error" role="alert">
                            {t(`credentialErrors.${validation}`)}
                        </div>
                    )}
                    <div className="neon-actionbar">
                        <div className="neon-inline-actions">
                            <button
                                className="neon-button neon-button-primary"
                                disabled={!draft.trim() || task.pending}
                                onClick={() => void save()}
                            >
                                {t('saveCredentials')}
                            </button>
                            <button
                                className="neon-button"
                                disabled={!draft || task.pending}
                                onClick={() => {
                                    setDraft('');
                                    setValidation(undefined);
                                }}
                            >
                                {t('clearDraft')}
                            </button>
                        </div>
                    </div>
                    <Feedback {...task} />
                    {task.data?.saved && (
                        <p className="neon-success" role="status">
                            {t('credentialsSaved')}
                        </p>
                    )}
                    {task.data?.deleted && (
                        <p className="neon-hint" role="status">
                            {t('credentialsDeleted')}
                        </p>
                    )}
                </PanelSection>
                <details className="neon-disclosure">
                    <summary>{t('removeAccess')}</summary>
                    <p className="neon-hint">{t('deleteCredentialsConfirm')}</p>
                    <button
                        className="neon-button neon-button-danger"
                        disabled={task.pending || !task.data?.fields.length}
                        onClick={() => setConfirmDelete(true)}
                    >
                        {t('deleteCredentials')}
                    </button>
                    {confirmDelete && (
                        <div className="neon-confirmation">
                            <p>{t('deleteCredentialsConfirm')}</p>
                            <div className="neon-inline-actions">
                                <button
                                    className="neon-button neon-button-danger"
                                    disabled={task.pending}
                                    onClick={() => {
                                        setConfirmDelete(false);
                                        void task.run(async () => {
                                            await deleteSecrets();
                                            return {fields: [], deleted: true};
                                        });
                                    }}
                                >
                                    {t('confirm')}
                                </button>
                                <button
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
            <div>
                <PanelSection
                    title={t('savedFields')}
                    actions={
                        task.data ? (
                            <span className="neon-count">{task.data.fields.length}</span>
                        ) : undefined
                    }
                >
                    <p className="neon-hint">{t('storedFieldsHint')}</p>
                    {task.data &&
                        (task.data.fields.length ? (
                            <ul className="neon-field-list">
                                {task.data.fields.map((name) => (
                                    <li key={name}>
                                        <span
                                            className="neon-status-dot is-configured"
                                            aria-hidden="true"
                                        />
                                        <code>{name}</code>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <ResultPlaceholder>{t('noCredentials')}</ResultPlaceholder>
                        ))}
                </PanelSection>
                <details className="neon-disclosure">
                    <summary>{t('supportedFields')}</summary>
                    <p className="neon-hint">{t('fieldsHint')}</p>
                    <div className="neon-fields">
                        {credentialNames.map((name) => (
                            <code className="neon-code" key={name}>
                                {name}
                            </code>
                        ))}
                    </div>
                </details>
            </div>
        </div>
    );
}
