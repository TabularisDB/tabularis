import {useCallback, useEffect, useId, useRef, useState, type ReactNode} from 'react';
import {
    openUrl,
    PluginCodeEditor,
    PluginResourceList,
    usePluginTranslation,
    usePluginWorkspace,
} from '@tabularis/plugin-api';
import {useNeonManagement} from './hooks/useNeonManagement';
import {useTask} from './hooks/useTask';
import {PanelSection, ResultPlaceholder} from './components/PanelSection';
import {
    clearFunctionDraft,
    functionTemplate,
    parseEnvironmentChanges,
    readFunctionDraft,
    validFunctionSlug,
    writeFunctionDraft,
} from './utils/functionDrafts';

interface FunctionItem {
    slug: string;
    name: string;
    url: string | null;
    status: string;
    updatedAt: string | null;
}
interface FunctionDetails extends FunctionItem {
    source: string | null;
    environmentKeys: string[];
    error: string | null;
}
interface FunctionLogs {
    entries: {timestamp: string; level: string; message: string}[];
    available: boolean;
    reason?: string;
}
type Management = ReturnType<typeof useNeonManagement>;

const functionStyles = `
.neon-functions {min-width:0}
.neon-functions .neon-functions-editor {height:360px;min-height:240px;border:1px solid var(--border-default);border-radius:var(--radius-sm);overflow:hidden;margin:12px 0}
.neon-functions .neon-functions-url {max-width:100%;overflow-wrap:anywhere;text-align:left}
.neon-functions .neon-functions-output {margin-top:12px}
.neon-functions .neon-functions-log {max-height:260px;overflow:auto;padding:0;list-style:none}
.neon-functions .neon-functions-log li {padding:8px 0;border-bottom:1px solid var(--border-default);font-family:var(--font-mono);font-size:11px;overflow-wrap:anywhere;white-space:pre-wrap}
.neon-functions .neon-functions-secret {min-height:110px;-webkit-text-security:disc}
`;

export function FunctionsManager({
    connectionId,
    slug,
    create = false,
    fallback,
}: {
    connectionId: string;
    slug?: string;
    create?: boolean;
    fallback?: ReactNode;
}) {
    const t = usePluginTranslation('neon');
    const management = useNeonManagement(connectionId);
    if (!management.scope)
        return (
            <div className="neon-functions">
                <p className="neon-description">{t('functionsManager.accountRequired')}</p>
                <OperationFeedback pending={management.pending} error={management.error} />
                <div className="neon-row">
                    <button
                        type="button"
                        className="neon-button"
                        onClick={management.connectAccount}
                    >
                        {t('account.connectNeon')}
                    </button>
                    <button
                        type="button"
                        className="neon-button"
                        disabled={management.pending}
                        onClick={management.reload}
                    >
                        {t('refresh')}
                    </button>
                </div>
                {!management.pending && fallback}
            </div>
        );
    return (
        <div className="neon-functions">
            <style>{functionStyles}</style>
            {create || slug !== undefined ? (
                <FunctionDetail
                    key={JSON.stringify([connectionId, slug, create])}
                    connectionId={connectionId}
                    slug={slug}
                    create={create}
                    management={management}
                />
            ) : (
                <FunctionList management={management} connectionId={connectionId} />
            )}
        </div>
    );
}

function OperationFeedback({pending, error}: {pending: boolean; error?: string}) {
    const t = usePluginTranslation('neon');
    return (
        <>
            {pending && (
                <p className="neon-hint" role="status">
                    {t('loading')}
                </p>
            )}
            {error && (
                <div className="neon-feedback neon-error" role="alert">
                    {error}
                </div>
            )}
        </>
    );
}

function FunctionList({management, connectionId}: {management: Management; connectionId: string}) {
    const t = usePluginTranslation('neon');
    const {openWorkspace} = usePluginWorkspace('neon');
    const task = useTask<{functions: FunctionItem[]}>();
    const {run} = task;
    const {call} = management;
    const load = useCallback(
        () => run(() => call<{functions: FunctionItem[]}>('account_functions_list')),
        [call, run],
    );
    useEffect(() => {
        void Promise.resolve().then(load);
    }, [load]);
    return (
        <>
            <div className="neon-toolbar">
                <p className="neon-description">{t('functionsManager.description')}</p>
                <div className="neon-inline-actions">
                    <button
                        type="button"
                        className="neon-button"
                        disabled={task.pending}
                        onClick={() => void load()}
                    >
                        {t('refresh')}
                    </button>
                    <button
                        type="button"
                        className="neon-button neon-button-primary"
                        onClick={() =>
                            openWorkspace({
                                id: 'function-create',
                                title: `Neon · ${t('functionsManager.newFunction')}`,
                                connectionId,
                            })
                        }
                    >
                        {t('functionsManager.newFunction')}
                    </button>
                </div>
            </div>
            <OperationFeedback {...task} />
            {task.data && (
                <PluginResourceList
                    label={t('functionsManager.listLabel')}
                    items={task.data.functions.map((item) => ({
                        id: item.slug,
                        title: item.name || item.slug,
                        subtitle: item.url ?? item.slug,
                        status: item.status,
                    }))}
                    onOpen={(slug) =>
                        openWorkspace({
                            id: `function:${encodeURIComponent(slug)}`,
                            title: `Neon · ${slug}`,
                            connectionId,
                        })
                    }
                    emptyMessage={t('functionsManager.empty')}
                />
            )}
        </>
    );
}

function FunctionDetail({
    connectionId,
    slug,
    create,
    management,
}: {
    connectionId: string;
    slug?: string;
    create: boolean;
    management: Management;
}) {
    const t = usePluginTranslation('neon');
    const id = useId();
    const {openWorkspace} = usePluginWorkspace('neon');
    const {call} = management;
    const draftKey = create ? ':create' : (slug ?? '');
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const [draft, setDraft] = useState(
        () =>
            readFunctionDraft(connectionId, draftKey) ?? {
                source: create ? functionTemplate : '',
                slug: slug ?? '',
            },
    );
    const [name, setName] = useState('');
    const [environment, setEnvironment] = useState('');
    const [confirmation, setConfirmation] = useState<'deploy' | 'delete'>();
    const [deleted, setDeleted] = useState(false);
    const [method, setMethod] = useState<'GET' | 'POST'>('GET');
    const [body, setBody] = useState('');
    const [localError, setLocalError] = useState<string>();
    const details = useTask<FunctionDetails>();
    const mutation = useTask<{message: string}>();
    const invocation = useTask<{status: number; body: string}>();
    const logs = useTask<FunctionLogs>();
    const {run: loadDetails} = details;
    const load = useCallback(async () => {
        if (!slug || create) return;
        const value = await loadDetails(() =>
            call<FunctionDetails>('account_function_get', {slug}),
        );
        if (!value) return;
        setName(value.name);
        if (!readFunctionDraft(connectionId, draftKey) && value.source !== null) {
            const next = {source: value.source, slug};
            writeFunctionDraft(connectionId, draftKey, next);
            setDraft(next);
        }
    }, [call, connectionId, create, draftKey, loadDetails, slug]);
    useEffect(() => {
        void Promise.resolve().then(load);
    }, [load]);
    const busy = details.pending || mutation.pending || invocation.pending || logs.pending;
    const updateDraft = (next: typeof draft) => {
        writeFunctionDraft(connectionId, draftKey, next);
        setDraft(next);
        setConfirmation(undefined);
    };
    const backToList = () =>
        openWorkspace({id: 'functions', title: `Neon · ${t('tabs.functions')}`, connectionId});
    const environmentChanges = () => {
        try {
            return parseEnvironmentChanges(environment || '{}');
        } catch {
            throw new Error(t('functionsManager.invalidEnvironment'));
        }
    };
    const deploy = () => {
        setConfirmation(undefined);
        setLocalError(undefined);
        void mutation.run(async () => {
            const envChanges = environmentChanges();
            const result = await call<{id: string; status: string}>('account_function_deploy', {
                slug: draft.slug,
                source: draft.source,
                createOnly: create,
                ...(Object.keys(envChanges).length ? {envChanges} : {}),
            });
            if (!mounted.current)
                return {message: t('functionsManager.deploymentStarted', {status: result.status})};
            setEnvironment('');
            if (create) {
                writeFunctionDraft(connectionId, draft.slug, {
                    source: draft.source,
                    slug: draft.slug,
                });
                clearFunctionDraft(connectionId, draftKey);
                openWorkspace({
                    id: `function:${encodeURIComponent(draft.slug)}`,
                    title: `Neon · ${draft.slug}`,
                    connectionId,
                });
            } else await load();
            return {message: t('functionsManager.deploymentStarted', {status: result.status})};
        });
    };
    if (deleted)
        return (
            <>
                <p className="neon-success" role="status">
                    {t('functionsManager.deleted', {slug})}
                </p>
                <button type="button" className="neon-button" onClick={backToList}>
                    {t('functionsManager.backToList')}
                </button>
            </>
        );
    return (
        <>
            <div className="neon-toolbar">
                <p className="neon-description">
                    {t(
                        create
                            ? 'functionsManager.createDescription'
                            : 'functionsManager.editDescription',
                    )}
                </p>
                <div className="neon-inline-actions">
                    {details.data && <span className="neon-status">{details.data.status}</span>}
                    {!create && (
                        <button
                            type="button"
                            className="neon-button"
                            disabled={busy}
                            onClick={() => void load()}
                        >
                            {t('refresh')}
                        </button>
                    )}
                </div>
            </div>
            <OperationFeedback
                pending={busy}
                error={details.error ?? mutation.error ?? localError}
            />
            {!create && <p className="neon-feedback">{t('functionsManager.activationWarning')}</p>}
            {mutation.data && (
                <p className="neon-success" role="status">
                    {mutation.data.message}
                </p>
            )}
            {details.data?.error && (
                <div className="neon-feedback neon-error" role="alert">
                    {details.data.error}
                </div>
            )}
            {create ? (
                <>
                    <label className="neon-field-label" htmlFor={`${id}-slug`}>
                        {t('functionsManager.slug')}
                    </label>
                    <input
                        id={`${id}-slug`}
                        className="neon-field"
                        value={draft.slug}
                        disabled={busy}
                        maxLength={20}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => updateDraft({...draft, slug: event.target.value})}
                    />
                    <p className="neon-hint">{t('functionsManager.slugHint')}</p>
                </>
            ) : (
                <>
                    <div className="neon-inline-actions">
                        <code className="neon-code">{slug}</code>
                        {details.data?.url && (
                            <button
                                type="button"
                                className="neon-link neon-functions-url"
                                onClick={() => {
                                    const url = details.data?.url;
                                    if (url)
                                        void openUrl(url).catch(() =>
                                            setLocalError(t('requestFailed')),
                                        );
                                }}
                            >
                                {details.data.url}
                            </button>
                        )}
                    </div>
                    <label className="neon-field-label" htmlFor={`${id}-name`}>
                        {t('functionsManager.displayName')}
                    </label>
                    <div className="neon-inline-actions">
                        <input
                            id={`${id}-name`}
                            className="neon-field neon-grow"
                            value={name}
                            disabled={busy || !details.data}
                            onChange={(event) => setName(event.target.value)}
                        />
                        <button
                            type="button"
                            className="neon-button"
                            disabled={busy || !name.trim() || name === details.data?.name}
                            onClick={() =>
                                void mutation.run(async () => {
                                    await call('account_function_rename', {
                                        slug,
                                        name: name.trim(),
                                    });
                                    await load();
                                    return {message: t('functionsManager.renamed')};
                                })
                            }
                        >
                            {t('functionsManager.rename')}
                        </button>
                    </div>
                </>
            )}
            <PanelSection
                title={t('functionsManager.source')}
                hint={t('functionsManager.sourceHint')}
            >
                {!create && details.data?.source === null && !draft.source && (
                    <p className="neon-hint">{t('functionsManager.sourceUnavailable')}</p>
                )}
                <div className="neon-functions-editor">
                    <PluginCodeEditor
                        label={t('functionsManager.source')}
                        language="javascript"
                        value={draft.source}
                        onChange={(source) => updateDraft({...draft, source})}
                        readOnly={busy || (!create && !details.data)}
                    />
                </div>
                <div className="neon-actionbar">
                    <span className="neon-hint">{t('functionsManager.sessionDraftHint')}</span>
                    <button
                        type="button"
                        className="neon-button neon-button-primary"
                        disabled={
                            busy ||
                            !validFunctionSlug(draft.slug) ||
                            !draft.source.trim() ||
                            new TextEncoder().encode(draft.source).byteLength > 262144 ||
                            (!create && !details.data)
                        }
                        onClick={() => (create ? deploy() : setConfirmation('deploy'))}
                    >
                        {t('functionsManager.deploy')}
                    </button>
                </div>
                {confirmation === 'deploy' && (
                    <div
                        className="neon-confirmation"
                        role="group"
                        aria-label={t('functionsManager.confirmDeployment')}
                    >
                        <p>{t('functionsManager.replaceWarning', {slug})}</p>
                        <div className="neon-inline-actions">
                            <button
                                type="button"
                                className="neon-button neon-button-primary"
                                disabled={busy}
                                onClick={deploy}
                            >
                                {t('functionsManager.confirmDeployment')}
                            </button>
                            <button
                                type="button"
                                className="neon-button"
                                onClick={() => setConfirmation(undefined)}
                            >
                                {t('cancel')}
                            </button>
                        </div>
                    </div>
                )}
            </PanelSection>
            <details className="neon-disclosure">
                <summary>{t('functionsManager.environment')}</summary>
                <p className="neon-hint">{t('functionsManager.environmentHint')}</p>
                {details.data && (
                    <div className="neon-fields">
                        {details.data.environmentKeys.map((key) => (
                            <code className="neon-code" key={key}>
                                {key}
                            </code>
                        ))}
                    </div>
                )}
                <label className="neon-field-label" htmlFor={`${id}-environment`}>
                    {t('functionsManager.environmentChanges')}
                </label>
                <textarea
                    id={`${id}-environment`}
                    className="neon-field neon-functions-secret"
                    value={environment}
                    disabled={busy}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setEnvironment(event.target.value)}
                    placeholder={t('functionsManager.environmentPlaceholder')}
                />
                {create ? (
                    <p className="neon-hint">{t('functionsManager.newEnvironmentHint')}</p>
                ) : (
                    <div className="neon-row">
                        <button
                            type="button"
                            className="neon-button"
                            disabled={busy || !details.data || !environment.trim()}
                            onClick={() =>
                                void mutation.run(async () => {
                                    await call('account_function_deploy', {
                                        slug,
                                        envChanges: environmentChanges(),
                                    });
                                    if (!mounted.current)
                                        return {message: t('functionsManager.environmentSaved')};
                                    setEnvironment('');
                                    await load();
                                    return {message: t('functionsManager.environmentSaved')};
                                })
                            }
                        >
                            {t('functionsManager.saveEnvironment')}
                        </button>
                    </div>
                )}
            </details>
            {!create && (
                <>
                    <details className="neon-disclosure">
                        <summary>{t('functionsManager.invoke')}</summary>
                        <p className="neon-hint">{t('functionsManager.invokeHint')}</p>
                        <label className="neon-field-label" htmlFor={`${id}-method`}>
                            {t('functionsManager.method')}
                        </label>
                        <select
                            id={`${id}-method`}
                            className="neon-field"
                            disabled={busy}
                            value={method}
                            onChange={(event) =>
                                setMethod(event.target.value === 'POST' ? 'POST' : 'GET')
                            }
                        >
                            <option>GET</option>
                            <option>POST</option>
                        </select>
                        {method === 'POST' && (
                            <>
                                <label className="neon-field-label" htmlFor={`${id}-body`}>
                                    {t('functionsManager.requestBody')}
                                </label>
                                <textarea
                                    id={`${id}-body`}
                                    className="neon-field"
                                    value={body}
                                    disabled={busy}
                                    onChange={(event) => setBody(event.target.value)}
                                />
                            </>
                        )}
                        <div className="neon-row">
                            <button
                                type="button"
                                className="neon-button"
                                disabled={busy || !details.data?.url}
                                onClick={() =>
                                    void invocation.run(() =>
                                        call('account_function_invoke', {
                                            slug,
                                            method,
                                            ...(method === 'POST' ? {body} : {}),
                                        }),
                                    )
                                }
                            >
                                {t('functionsManager.sendRequest')}
                            </button>
                        </div>
                        <OperationFeedback pending={false} error={invocation.error} />
                        {invocation.data && (
                            <div className="neon-functions-output">
                                <span className="neon-status">HTTP {invocation.data.status}</span>
                                <pre className="neon-output">{invocation.data.body}</pre>
                            </div>
                        )}
                    </details>
                    <details className="neon-disclosure">
                        <summary>{t('functionsManager.logs')}</summary>
                        <div className="neon-row">
                            <button
                                type="button"
                                className="neon-button"
                                disabled={busy}
                                onClick={() =>
                                    void logs.run(() => call('account_function_logs', {slug}))
                                }
                            >
                                {t('functionsManager.loadLogs')}
                            </button>
                        </div>
                        <OperationFeedback pending={false} error={logs.error} />
                        {logs.data &&
                            (!logs.data.available ? (
                                <p className="neon-hint">
                                    {logs.data.reason ?? t('functionsManager.logsUnavailable')}
                                </p>
                            ) : logs.data.entries.length ? (
                                <ul className="neon-functions-log">
                                    {logs.data.entries.map((entry, index) => (
                                        <li key={`${entry.timestamp}:${index}`}>
                                            {entry.timestamp} · {entry.level}
                                            {'\n'}
                                            {entry.message}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <ResultPlaceholder>
                                    {t('functionsManager.noLogs')}
                                </ResultPlaceholder>
                            ))}
                    </details>
                    <details className="neon-disclosure">
                        <summary>{t('functionsManager.dangerZone')}</summary>
                        <div className="neon-row">
                            <button
                                type="button"
                                className="neon-button neon-button-danger"
                                disabled={busy || !details.data}
                                onClick={() => setConfirmation('delete')}
                            >
                                {t('functionsManager.deleteFunction')}
                            </button>
                        </div>
                        {confirmation === 'delete' && (
                            <div
                                className="neon-confirmation"
                                role="group"
                                aria-label={t('functionsManager.confirmDelete')}
                            >
                                <p>{t('functionsManager.deleteWarning', {slug})}</p>
                                <div className="neon-inline-actions">
                                    <button
                                        type="button"
                                        className="neon-button neon-button-danger"
                                        disabled={busy}
                                        onClick={() =>
                                            void mutation.run(async () => {
                                                await call('account_function_delete', {slug});
                                                clearFunctionDraft(connectionId, draftKey);
                                                if (mounted.current) setDeleted(true);
                                                return {
                                                    message: t('functionsManager.deleted', {slug}),
                                                };
                                            })
                                        }
                                    >
                                        {t('functionsManager.confirmDelete')}
                                    </button>
                                    <button
                                        type="button"
                                        className="neon-button"
                                        onClick={() => setConfirmation(undefined)}
                                    >
                                        {t('cancel')}
                                    </button>
                                </div>
                            </div>
                        )}
                    </details>
                </>
            )}
        </>
    );
}
