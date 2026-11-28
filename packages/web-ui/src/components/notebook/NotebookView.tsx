import {useState, useCallback, useRef, useEffect, useMemo, useSyncExternalStore} from 'react';
import {flushSync} from 'react-dom';
import {useTranslation} from 'react-i18next';
import {BookOpen, Loader2} from 'lucide-react';
import type {QueryResult, Tab} from '@/types/editor';
import type {
    NotebookCell,
    NotebookCellType,
    NotebookParam,
    NotebookState,
    NotebookViewMode,
    RunAllResult,
} from '@/types/notebook';
import {
    updateCellInCells,
    addCellToCells,
    duplicateCellToEnd,
    removeCellFromCells,
    clearCellOutputs,
    hasCellOutputs,
} from '@/utils/notebook';
import {
    computeAutoScrollSpeed,
    createCellDragPreview,
    moveCell,
    reorderCells,
} from '@/utils/notebookDnd';
import {
    chooseNotebookImport,
    downloadNotebook,
    downloadNotebookHtml,
    downloadNotebookMarkdown,
    downloadNotebookSql,
} from '@/utils/notebookTransfer';
import {isTypingTarget} from '@/utils/keyboardEvents';
import {flushPendingEditorChanges} from '@/utils/pendingEditorChanges';
import {
    acquireNotebookRun,
    checkNotebookInputs,
    createRunAllResult,
    executeNotebookPlan,
    type CellRunOutcome,
} from '@/utils/notebookRunAll';
import {
    buildNotebookExecutionPlan,
    isEffectFreeNotebookQuery,
    type NotebookRunRequest,
} from '@/utils/notebookExecutionPlan';
import {
    resolveNotebookSqlSyntax,
    resolveQueryVariables,
    variableOptionsForDriver,
} from '@/utils/notebookVariables';
import {
    resolveParams,
    supportsTypedParams,
    type ParamDrafts,
    type ParamError,
} from '@/utils/notebookParams';
import {addHistoryEntry, createHistoryEntry} from '@/utils/notebookHistory';
import {
    createHistory,
    recordEdit,
    undo as undoHistory,
    redo as redoHistory,
    jumpTo as jumpToHistory,
    timeline as historyTimeline,
    type NotebookHistory,
} from '@/utils/notebookUndo';
import {
    getNotebookState,
    setNotebookState as storeSetState,
    loadNotebook,
    setNotebookTitle,
    createNotebookFromState,
    hasUnconfirmedNotebookWrite,
    setUnconfirmedNotebookWrite,
    subscribeNotebookState,
    restoreNotebookDocument,
    updateNotebookRuntime,
} from '@/utils/notebookStore';
import {useDatabase} from '@/hooks/useDatabase';
import {useSqlAutocompleteRegistration} from '@/hooks/useSqlAutocompleteRegistration';
import {usesMultiDatabaseLayout} from '@/utils/database';
import {useSettings} from '@/hooks/useSettings';
import {useAlert} from '@/hooks/useAlert';
import {useKeybindings} from '@/hooks/useKeybindings';
import {DANGEROUS_QUERY_I18N} from '@/hooks/useDangerousQueryGuard';
import {useQueryGuards} from '@/hooks/useQueryGuards';
import {ConfirmModal} from '@/components/modals/ConfirmModal';
import {NotebookToolbar} from './NotebookToolbar';
import {NotebookHistoryPanel} from './NotebookHistoryPanel';
import {NotebookCellWrapper} from './NotebookCellWrapper';
import {AddCellButton} from './AddCellButton';
import {RunAllSummary} from './RunAllSummary';
import {ParamsPanel} from './ParamsPanel';
import {NotebookOutline} from './NotebookOutline';
import {NotebookReportView} from './NotebookReportView';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {usePlatformCapabilities} from '@/hooks/usePlatformCapabilities';

interface CachedRunInputs {
    cellId: string;
    sourceSql: string;
    connectionId: string;
    sql: string;
    schema: string | null | undefined;
    dialectFingerprint: string;
    limit: number;
    prerequisites: Array<{id: string; result: NotebookCell['result']}>;
}

// The notebook store keeps results in memory across tab remounts.
const cachedRunInputs = new WeakMap<QueryResult, CachedRunInputs>();

interface NotebookViewProps {
    tab: Tab;
    updateTab: (id: string, partial: Partial<Tab>) => void;
    connectionId: string;
    /** Whether this notebook tab is the active one (gates keyboard shortcuts). */
    isActive: boolean;
}

export function NotebookView({tab, updateTab, connectionId, isActive}: NotebookViewProps) {
    const client = useTabularisClient();
    const platform = usePlatformCapabilities();
    const {t} = useTranslation();
    const {activeSchema, activeCapabilities, selectedDatabases, activeDriver} = useDatabase();
    // Lets notebook parameters skip `@name` inside string literals and comments.
    const sqlDialect = resolveNotebookSqlSyntax(activeCapabilities, activeDriver);
    const typedParamsSupported = supportsTypedParams(sqlDialect);
    const variableOptions = useMemo(
        () => ({
            ...variableOptionsForDriver(activeCapabilities ?? activeDriver, activeDriver),
            dialect: sqlDialect,
        }),
        [activeCapabilities, activeDriver, sqlDialect],
    );
    const isMultiDb = usesMultiDatabaseLayout(activeCapabilities, selectedDatabases);
    const effectiveSchema = tab.schema || activeSchema || (isMultiDb ? selectedDatabases[0] : null);
    useSqlAutocompleteRegistration(connectionId, {
        schema: effectiveSchema,
        database: tab.database,
        enabled: isActive,
    });
    const {settings} = useSettings();
    const {showAlert} = useAlert();
    const {matchesShortcut} = useKeybindings();
    const {
        pending: dangerousQuery,
        guardQuery: guardQueryExecution,
        resolve: resolveDangerousQuery,
    } = useQueryGuards(connectionId);

    // The same snapshot feeds edits and execution results, including RPCs
    // that settle after a view of this notebook unmounts.
    const notebookId = tab.notebookId;
    const readNotebook = useCallback(
        () => (notebookId ? getNotebookState(notebookId) : undefined),
        [notebookId],
    );
    const subscribe = useCallback(
        (listener: () => void) =>
            notebookId ? subscribeNotebookState(notebookId, listener) : () => {},
        [notebookId],
    );
    const notebook = useSyncExternalStore(subscribe, readNotebook);
    const readNotebookCells = useCallback(() => readNotebook()?.cells ?? [], [readNotebook]);

    const [runningNotebookId, setRunningNotebookId] = useState<string | null>(null);
    const isRunning = runningNotebookId === notebookId;
    const [runAllResult, setRunAllResult] = useState<RunAllResult | null>(null);
    const [isClearOutputsConfirmOpen, setIsClearOutputsConfirmOpen] = useState(false);
    const [viewMode, setViewMode] = useState<NotebookViewMode>('edit');
    const [executedParamsByCell, setExecutedParamsByCell] = useState<Record<string, string>>({});
    // Rows edited in the Parameters panel and not applied yet. Kept here so they
    // survive a switch between Edit and Report view; never saved, never in undo.
    const [paramDrafts, setParamDrafts] = useState<ParamDrafts>({});
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    // Gap-based insertion point in [0, cells.length]; `null` while not dragging.
    const [dropPos, setDropPos] = useState<number | null>(null);
    const cellRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const autoScrollSpeedRef = useRef(0);
    const autoScrollRafRef = useRef<number | null>(null);
    const activeRunRef = useRef<{notebookId: string; controller: AbortController} | null>(null);
    useEffect(
        () => () => {
            const run = activeRunRef.current;
            if (run && run.notebookId === notebookId) run.controller.abort();
        },
        [notebookId],
    );

    // Undo/redo history (autosave means edits are otherwise irreversible).
    const [history, setHistory] = useState<NotebookHistory>(createHistory);
    const historyRef = useRef<NotebookHistory>(history);
    const isActiveRef = useRef(isActive);
    const [showHistory, setShowHistory] = useState(false);
    const canUndo = history.past.length > 0;
    const canRedo = history.future.length > 0;

    useEffect(() => {
        isActiveRef.current = isActive;
    }, [isActive]);

    useEffect(() => {
        historyRef.current = history;
    }, [history]);

    // Commit a new history (updates both the ref used by callbacks and state).
    const commitHistory = useCallback((next: NotebookHistory) => {
        historyRef.current = next;
        setHistory(next);
    }, []);

    // Reset undo/redo history (e.g. after importing a different notebook).
    const resetHistory = useCallback(() => {
        commitHistory(createHistory());
    }, [commitHistory]);

    // Load notebook from disk when not already cached
    useEffect(() => {
        if (notebookId && !readNotebook()) {
            void loadNotebook(notebookId, connectionId, client);
        }
    }, [client, connectionId, notebookId, readNotebook]);

    // Sync tab title to notebook store
    useEffect(() => {
        if (tab.notebookId) {
            setNotebookTitle(tab.notebookId, tab.title);
        }
    }, [tab.notebookId, tab.title]);

    const cells = notebook?.cells ?? [];
    const stopOnError = notebook?.stopOnError ?? false;
    const params = useMemo(() => notebook?.params ?? [], [notebook?.params]);
    const currentParamsSignature = useMemo(() => JSON.stringify(params), [params]);
    const outdatedCellIds = useMemo(() => {
        const set = new Set<string>();
        for (const [cellId, ranParams] of Object.entries(executedParamsByCell)) {
            if (ranParams !== currentParamsSignature) {
                set.add(cellId);
            }
        }
        return set;
    }, [executedParamsByCell, currentParamsSignature]);

    const updateNotebook = useCallback(
        (
            newCells: NotebookCell[],
            extraState?: {
                stopOnError?: boolean;
                params?: NotebookParam[];
            },
        ) => {
            if (!notebookId) return;
            const prevState = readNotebook();
            const newState: NotebookState = {
                cells: newCells,
                stopOnError: extraState?.stopOnError ?? prevState?.stopOnError,
                params: extraState?.params ?? prevState?.params,
            };
            if (prevState) {
                const next = recordEdit(historyRef.current, prevState, newState, Date.now());
                if (next !== historyRef.current) commitHistory(next);
            }
            storeSetState(notebookId, newState);
        },
        [commitHistory, notebookId, readNotebook],
    );

    /** Apply a state from the history without recording a new entry. */
    const applyHistoryState = useCallback(
        (snapshot: NotebookState) => {
            if (notebookId) {
                storeSetState(
                    notebookId,
                    restoreNotebookDocument(snapshot, readNotebook() ?? null),
                );
            }
        },
        [notebookId, readNotebook],
    );

    const handleUndo = useCallback(() => {
        const current = readNotebook();
        if (!current) return;
        const step = undoHistory(historyRef.current, current);
        if (!step) return;
        commitHistory(step.history);
        applyHistoryState(step.state);
    }, [applyHistoryState, commitHistory, readNotebook]);

    const handleRedo = useCallback(() => {
        const current = readNotebook();
        if (!current) return;
        const step = redoHistory(historyRef.current, current);
        if (!step) return;
        commitHistory(step.history);
        applyHistoryState(step.state);
    }, [applyHistoryState, commitHistory, readNotebook]);

    const handleJump = useCallback(
        (index: number) => {
            const current = readNotebook();
            if (!current) return;
            const step = jumpToHistory(historyRef.current, current, index);
            if (!step) return;
            commitHistory(step.history);
            applyHistoryState(step.state);
            setShowHistory(false);
        },
        [applyHistoryState, commitHistory, readNotebook],
    );

    const updateCell = useCallback(
        (cellId: string, partial: Partial<NotebookCell>) => {
            updateNotebook(updateCellInCells(readNotebookCells(), cellId, partial));
        },
        [readNotebookCells, updateNotebook],
    );

    const focusCell = useCallback((cellId: string) => {
        const tryFocus = (attempts: number) => {
            const el = cellRefsMap.current.get(cellId);
            if (!el) {
                if (attempts < 10) requestAnimationFrame(() => tryFocus(attempts + 1));
                return;
            }
            const monacoTextarea = el.querySelector<HTMLTextAreaElement>('.monaco-editor textarea');
            if (monacoTextarea) {
                monacoTextarea.focus();
                return;
            }
            const textarea = el.querySelector<HTMLTextAreaElement>('textarea');
            if (textarea) {
                textarea.focus();
                return;
            }
            if (attempts < 10) requestAnimationFrame(() => tryFocus(attempts + 1));
        };
        requestAnimationFrame(() => tryFocus(0));
    }, []);

    /** Commit cells that contain the new cell `newCellId`, then scroll to and focus it. */
    const insertCells = useCallback(
        (newCells: NotebookCell[], newCellId: string) => {
            flushSync(() => updateNotebook(newCells));
            cellRefsMap.current
                .get(newCellId)
                ?.scrollIntoView({behavior: 'smooth', block: 'start'});
            focusCell(newCellId);
        },
        [updateNotebook, focusCell],
    );

    const addCell = useCallback(
        (type: NotebookCellType, afterIndex?: number): string => {
            const newCells = addCellToCells(readNotebookCells(), type, afterIndex);
            const insertAt = afterIndex !== undefined ? afterIndex + 1 : newCells.length - 1;
            const newCellId = newCells[insertAt].id;
            insertCells(newCells, newCellId);
            return newCellId;
        },
        [insertCells, readNotebookCells],
    );

    const deleteCell = useCallback(
        (cellId: string) => {
            updateNotebook(removeCellFromCells(readNotebookCells(), cellId));
        },
        [readNotebookCells, updateNotebook],
    );

    const toggleStopOnError = useCallback(() => {
        updateNotebook(readNotebookCells(), {stopOnError: !stopOnError});
    }, [readNotebookCells, updateNotebook, stopOnError]);

    const handleParamsChange = useCallback(
        (newParams: NotebookParam[]) => {
            updateNotebook(readNotebookCells(), {params: newParams});
        },
        [readNotebookCells, updateNotebook],
    );

    /** Why typed parameters stop a cell, one line per parameter. */
    const describeParamErrors = useCallback(
        (errors: ParamError[]) =>
            errors
                .map(({name, reference, kind, issue}) =>
                    t(`editor.notebook.params.errors.${kind}`, {
                        name,
                        reference,
                        reason: issue ? t(`editor.notebook.params.issues.${issue}`) : '',
                    }),
                )
                .join('\n'),
        [t],
    );

    const runPlan = useCallback(
        async (request: NotebookRunRequest) => {
            if (!notebookId) return;
            const release = acquireNotebookRun(notebookId);
            if (!release) {
                showAlert(t('editor.notebook.execution.busy'), {kind: 'info'});
                return;
            }

            const controller = new AbortController();
            activeRunRef.current?.controller.abort();
            activeRunRef.current = {notebookId, controller};
            const {signal} = controller;
            try {
                // Editors debounce document writes. Capture what the user sees,
                // including references just entered in another cell.
                flushPendingEditorChanges();
                const state = readNotebook();
                if (!state) return;
                const runParams = state.params ?? [];
                const paramSignature = JSON.stringify(runParams);
                const requestedLimit = Math.floor(settings.resultPageSize);
                const limit =
                    Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 100;
                const {identifierQuote, escapeBackslashes, backslashLiterals, booleanLiterals} =
                    variableOptions;
                const dialectFingerprint = JSON.stringify([
                    sqlDialect.dialect,
                    sqlDialect.options,
                    identifierQuote,
                    escapeBackslashes,
                    backslashLiterals,
                    booleanLiterals,
                ]);
                const planned = buildNotebookExecutionPlan({
                    cells: state.cells,
                    request,
                    fallbackSchema: effectiveSchema,
                    connectionId,
                    schemaIsDatabase: isMultiDb,
                    syntax: sqlDialect,
                    prepare: (sql) =>
                        runParams.length
                            ? resolveParams(sql, runParams, sqlDialect)
                            : {sql, errors: []},
                    canReuse: (node, snapshot) => {
                        const prior = node.cell.result && cachedRunInputs.get(node.cell.result);
                        if (!prior) return false;
                        return (
                            node.cell.id === prior.cellId &&
                            node.cell.content === prior.sourceSql &&
                            connectionId === prior.connectionId &&
                            node.schema === prior.schema &&
                            node.sql === prior.sql &&
                            dialectFingerprint === prior.dialectFingerprint &&
                            limit === prior.limit &&
                            node.prerequisites.length === prior.prerequisites.length &&
                            node.prerequisites.every(
                                (index, i) =>
                                    prior.prerequisites[i].id === snapshot[index].id &&
                                    prior.prerequisites[i].result === snapshot[index].result,
                            )
                        );
                    },
                });

                const cellLabel = (index: number) =>
                    t('editor.notebook.execution.cell', {number: index + 1});
                if (planned.kind === 'invalid') {
                    const summary = createRunAllResult(
                        request.mode,
                        planned.targetCount,
                        planned.targetCount,
                    );
                    summary.preflightErrors = planned.issues.map((issue) => {
                        if (issue.kind === 'cycle') {
                            return t('editor.notebook.execution.cycle', {
                                path: issue.path.map(cellLabel).join(' → '),
                            });
                        }
                        if (issue.kind === 'self') {
                            return t('editor.notebook.execution.self', {
                                cell: cellLabel(issue.index),
                            });
                        }
                        return t(`editor.notebook.execution.${issue.kind}`, {
                            cell: cellLabel(issue.index),
                            reference: issue.reference,
                            interpolation: {escapeValue: false},
                        });
                    });
                    setRunAllResult(summary);
                    return;
                }
                const {plan} = planned;
                if (!plan.steps.length && !plan.skipped) return;

                setRunningNotebookId(notebookId);
                setRunAllResult(null);
                updateTab(tab.id, {isLoading: true});
                const readCells = () => {
                    if (signal.aborted) return [];
                    flushPendingEditorChanges();
                    return readNotebookCells();
                };
                const patchRuntime = (
                    id: string,
                    patch: (live: NotebookState) => Partial<NotebookCell> | undefined,
                ) => {
                    const update = (live: NotebookState) => {
                        if (!live.cells.some((item) => item.id === id)) return live;
                        const partial = patch(live);
                        if (!partial) return live;
                        return {...live, cells: updateCellInCells(live.cells, id, partial)};
                    };
                    return updateNotebookRuntime(notebookId, update);
                };
                let onAbort: () => void;
                const unmounted = new Promise<false>((resolve) => {
                    onAbort = () => resolve(false);
                    signal.addEventListener('abort', onAbort, {once: true});
                });
                const result = await executeNotebookPlan(plan, {
                    stopOnError: state.stopOnError ?? false,
                    readCells,
                    execute: async (node, inputs, checkBeforeSend): Promise<CellRunOutcome> => {
                        const {cell, sql, schema} = node;
                        const {id} = cell;
                        const failBeforeSend = (
                            error: string,
                            keepOutput = false,
                        ): CellRunOutcome => {
                            patchRuntime(id, () => ({
                                error,
                                ...(keepOutput ? {} : {result: null}),
                            }));
                            return {kind: 'failed', error, sent: false};
                        };
                        patchRuntime(id, () => ({isLoading: true}));
                        try {
                            if (node.paramErrors.length)
                                return failBeforeSend(describeParamErrors(node.paramErrors));
                            const resolved = resolveQueryVariables(
                                sql,
                                inputs,
                                variableOptions,
                                node.references,
                            );
                            if (resolved.unresolvedRefs.length) {
                                return failBeforeSend(
                                    t('editor.notebook.execution.missing', {
                                        cell: cellLabel(node.index),
                                        reference: resolved.unresolvedRefs
                                            .map((ref) => ref.match)
                                            .join(', '),
                                        interpolation: {escapeValue: false},
                                    }),
                                );
                            }

                            // Judge the SQL actually sent, independently of opt-in and batching.
                            const canAutoRetryOnAmbiguousOutcome = isEffectFreeNotebookQuery(
                                resolved.sql,
                                sqlDialect,
                            );
                            const hasUnconfirmedWrite = () =>
                                !canAutoRetryOnAmbiguousOutcome &&
                                !(request.mode === 'cell' && request.cellId === id) &&
                                hasUnconfirmedNotebookWrite(notebookId, id, readNotebookCells());
                            const failUnconfirmed = () =>
                                failBeforeSend(
                                    t('editor.notebook.execution.unconfirmedWrite'),
                                    true,
                                );
                            if (hasUnconfirmedWrite()) return failUnconfirmed();

                            const allowed = await Promise.race([
                                guardQueryExecution(resolved.sql, signal),
                                unmounted,
                            ]);
                            const changed = checkBeforeSend();
                            if (changed) return changed;
                            if (!allowed) {
                                return {
                                    kind: 'failed',
                                    error: t('editor.notebook.execution.guardDenied'),
                                    sent: false,
                                };
                            }
                            if (hasUnconfirmedWrite()) return failUnconfirmed();

                            patchRuntime(id, () => ({error: undefined, result: null}));
                            const start = performance.now();
                            const writeFingerprint = canAutoRetryOnAmbiguousOutcome
                                ? undefined
                                : JSON.stringify([resolved.sql, connectionId, schema ?? null]);
                            if (writeFingerprint)
                                setUnconfirmedNotebookWrite(notebookId, id, writeFingerprint, true);
                            let outcome: Extract<CellRunOutcome, {kind: 'success' | 'failed'}>;
                            try {
                                const response = await client.call('execute_query', {
                                    connectionId,
                                    query: resolved.sql,
                                    limit,
                                    page: 1,
                                    ...(schema ? {schema} : {}),
                                });
                                outcome = {kind: 'success', result: {...response}};
                            } catch (error) {
                                outcome = {
                                    kind: 'failed',
                                    error: error instanceof Error ? error.message : String(error),
                                    sent: true,
                                };
                            }

                            // Flush the current editor before checking the captured input, even
                            // if a different view now owns the notebook.
                            flushPendingEditorChanges();
                            const committed = patchRuntime(id, (live) => {
                                if (
                                    checkNotebookInputs(plan, node, live.cells, {
                                        allowDisabledCell: true,
                                    }) ||
                                    node.prerequisites.some(
                                        (index) =>
                                            live.cells[index].result !== inputs[index].result,
                                    )
                                )
                                    return;
                                const current = live.cells.find((item) => item.id === id)!;
                                const executionTime = performance.now() - start;
                                const response = outcome.kind === 'success' ? outcome.result : null;
                                const error = outcome.kind === 'failed' ? outcome.error : undefined;
                                if (response) {
                                    cachedRunInputs.set(response, {
                                        cellId: id,
                                        sourceSql: cell.content,
                                        connectionId,
                                        schema,
                                        sql,
                                        dialectFingerprint,
                                        limit,
                                        prerequisites: node.prerequisites.map((index) => ({
                                            id: inputs[index].id,
                                            result: inputs[index].result,
                                        })),
                                    });
                                }
                                return {
                                    result: response,
                                    error,
                                    executionTime,
                                    history: addHistoryEntry(
                                        current.history ?? [],
                                        createHistoryEntry(
                                            cell.content.trim(),
                                            response,
                                            error,
                                            executionTime,
                                        ),
                                    ),
                                };
                            });
                            if (committed && !signal.aborted) {
                                setExecutedParamsByCell((prev) => ({
                                    ...prev,
                                    [id]: paramSignature,
                                }));
                            }
                            if (outcome.kind === 'success') {
                                // An unapplied result cannot feed this run's consumers.
                                // Leave its write fingerprint intact for any future retry.
                                if (!committed) return {kind: 'changed', sent: true};
                                if (writeFingerprint)
                                    setUnconfirmedNotebookWrite(
                                        notebookId,
                                        id,
                                        writeFingerprint,
                                        false,
                                    );
                            }
                            return outcome;
                        } catch (error) {
                            const changed = checkBeforeSend();
                            return (
                                changed ??
                                failBeforeSend(
                                    error instanceof Error ? error.message : String(error),
                                )
                            );
                        } finally {
                            patchRuntime(id, () => ({isLoading: false}));
                        }
                    },
                }).finally(() => signal.removeEventListener('abort', onAbort));
                if (!signal.aborted) setRunAllResult(result);
            } finally {
                release();
                if (activeRunRef.current?.controller === controller) {
                    activeRunRef.current = null;
                    setRunningNotebookId(null);
                    updateTab(tab.id, {isLoading: false});
                }
            }
        },
        [
            client,
            connectionId,
            describeParamErrors,
            effectiveSchema,
            guardQueryExecution,
            isMultiDb,
            notebookId,
            readNotebook,
            readNotebookCells,
            settings.resultPageSize,
            showAlert,
            sqlDialect,
            t,
            tab.id,
            updateTab,
            variableOptions,
        ],
    );

    const runAll = useCallback(() => runPlan({mode: 'all'}), [runPlan]);

    const handleExport = useCallback(async () => {
        // Export what the editors show, including a keystroke still held back.
        flushPendingEditorChanges();
        try {
            const downloaded = await downloadNotebook(platform, tab.title, {
                cells: readNotebookCells(),
                params,
                stopOnError,
            });
            if (downloaded) {
                showAlert(t('editor.notebook.exportSuccess'), {kind: 'info'});
            }
        } catch (e) {
            console.error('Notebook export failed:', e);
            showAlert(
                t('editor.notebook.exportError') ||
                    `Export failed: ${e instanceof Error ? e.message : String(e)}`,
                {kind: 'error'},
            );
        }
    }, [params, platform, readNotebookCells, showAlert, stopOnError, t, tab.title]);

    const handleExportHtml = useCallback(async () => {
        // Export what the editors show, including a keystroke still held back.
        flushPendingEditorChanges();
        try {
            const downloaded = await downloadNotebookHtml(platform, tab.title, {
                cells: readNotebookCells(),
                params,
                stopOnError,
            });
            if (downloaded) {
                showAlert(t('editor.notebook.exportSuccess'), {kind: 'info'});
            }
        } catch (e) {
            console.error('HTML export failed:', e);
            showAlert(
                t('editor.notebook.exportError') ||
                    `Export failed: ${e instanceof Error ? e.message : String(e)}`,
                {kind: 'error'},
            );
        }
    }, [params, platform, readNotebookCells, showAlert, stopOnError, t, tab.title]);

    const handleExportSql = useCallback(async () => {
        // Export what the editors show, including a keystroke still held back.
        flushPendingEditorChanges();
        try {
            const outcome = await downloadNotebookSql(platform, tab.title, {
                cells: readNotebookCells(),
            });
            if (outcome === 'empty') {
                showAlert(t('editor.notebook.exportSqlEmpty'), {kind: 'info'});
            } else if (outcome === 'downloaded') {
                showAlert(t('editor.notebook.exportSuccess'), {kind: 'info'});
            }
        } catch (e) {
            console.error('SQL export failed:', e);
            showAlert(
                t('editor.notebook.exportError') ||
                    `Export failed: ${e instanceof Error ? e.message : String(e)}`,
                {kind: 'error'},
            );
        }
    }, [platform, readNotebookCells, showAlert, t, tab.title]);

    const handleExportMarkdown = useCallback(async () => {
        // Export what the editors show, including a keystroke still held back.
        flushPendingEditorChanges();
        try {
            const outcome = await downloadNotebookMarkdown(platform, tab.title, {
                cells: readNotebookCells(),
            });
            if (outcome === 'empty') {
                showAlert(t('editor.notebook.exportMarkdownEmpty'), {kind: 'info'});
            } else if (outcome === 'downloaded') {
                showAlert(t('editor.notebook.exportSuccess'), {kind: 'info'});
            }
        } catch (e) {
            console.error('Markdown export failed:', e);
            showAlert(
                t('editor.notebook.exportError') ||
                    `Export failed: ${e instanceof Error ? e.message : String(e)}`,
                {kind: 'error'},
            );
        }
    }, [platform, readNotebookCells, showAlert, t, tab.title]);

    const handleImport = useCallback(async () => {
        try {
            const imported = await chooseNotebookImport(platform);
            if (!imported) return;
            const {title, state: importedState} = imported;

            // Create a new notebook file for the imported content
            const {notebookId: newId} = await createNotebookFromState(
                title,
                importedState,
                connectionId,
                client,
            );

            // Cancel unsent work and confirmations before replacing the document.
            activeRunRef.current?.controller.abort();
            updateTab(tab.id, {notebookId: newId, title, isLoading: false});
            resetHistory();
            setParamDrafts({});
            setRunAllResult(null);
            setExecutedParamsByCell({});

            showAlert(t('editor.notebook.importSuccess'), {kind: 'info'});
        } catch {
            showAlert(t('editor.notebook.invalidFile'), {kind: 'error'});
        }
    }, [client, connectionId, platform, resetHistory, showAlert, t, tab.id, updateTab]);

    // Drag & Drop handlers
    const handleDragStart = useCallback(
        (index: number) => (e: React.DragEvent) => {
            setDragIndex(index);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(index));

            // Show a small "held card" under the cursor instead of the browser's
            // default faded in-place screenshot, so it feels like carrying the cell.
            const cell = readNotebookCells()[index];
            if (cell) {
                const preview = createCellDragPreview(document, {
                    name: cell.name?.trim() || t('editor.notebook.cellNamePlaceholder'),
                    typeLabel:
                        cell.type === 'sql'
                            ? t('editor.notebook.sqlCell')
                            : t('editor.notebook.markdownCell'),
                    type: cell.type,
                });
                e.dataTransfer.setDragImage(preview, 12, 12);
                // The browser snapshots the element synchronously on drag start; drop
                // it from the DOM on the next tick.
                setTimeout(() => preview.remove(), 0);
            }
        },
        [readNotebookCells, t],
    );

    const stopAutoScroll = useCallback(() => {
        if (autoScrollRafRef.current !== null) {
            cancelAnimationFrame(autoScrollRafRef.current);
            autoScrollRafRef.current = null;
        }
        autoScrollSpeedRef.current = 0;
    }, []);

    // rAF loop so the list keeps scrolling while the cursor is held near an edge,
    // even when no further dragover events fire (native DnD doesn't auto-scroll).
    const stepAutoScroll = useCallback(() => {
        const tick = () => {
            const container = scrollContainerRef.current;
            const speed = autoScrollSpeedRef.current;
            if (!container || speed === 0) {
                autoScrollRafRef.current = null;
                return;
            }
            container.scrollTop += speed;
            autoScrollRafRef.current = requestAnimationFrame(tick);
        };
        tick();
    }, []);

    const handleDragEnd = useCallback(() => {
        setDragIndex(null);
        setDropPos(null);
        stopAutoScroll();
    }, [stopAutoScroll]);

    const handleDragOver = useCallback(
        (index: number) => (e: React.DragEvent) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            // Above the cell's midpoint drops before it, below drops after it.
            const rect = e.currentTarget.getBoundingClientRect();
            const after = e.clientY > rect.top + rect.height / 2;
            setDropPos(after ? index + 1 : index);
        },
        [],
    );

    // Drive edge auto-scroll from the scroll container so a tall cell can't trap
    // the drag — without this you can't reach the edge to scroll past it.
    const handleContainerDragOver = useCallback(
        (e: React.DragEvent) => {
            if (dragIndex === null) return;
            const container = scrollContainerRef.current;
            if (!container) return;
            const speed = computeAutoScrollSpeed(container.getBoundingClientRect(), e.clientY);
            autoScrollSpeedRef.current = speed;
            if (speed !== 0 && autoScrollRafRef.current === null) {
                autoScrollRafRef.current = requestAnimationFrame(stepAutoScroll);
            }
        },
        [dragIndex, stepAutoScroll],
    );

    const handleDrop = useCallback(
        (index: number) => (e: React.DragEvent) => {
            e.preventDefault();
            const fromIndex = dragIndex;
            const rect = e.currentTarget.getBoundingClientRect();
            const insertAt = e.clientY > rect.top + rect.height / 2 ? index + 1 : index;
            setDragIndex(null);
            setDropPos(null);
            stopAutoScroll();
            if (fromIndex === null) return;
            updateNotebook(moveCell(readNotebookCells(), fromIndex, insertAt));
        },
        [dragIndex, readNotebookCells, updateNotebook, stopAutoScroll],
    );

    // Cancel any in-flight auto-scroll frame if the view unmounts mid-drag.
    useEffect(() => stopAutoScroll, [stopAutoScroll]);

    const scrollToCell = useCallback((cellId: string) => {
        const el = cellRefsMap.current.get(cellId);
        el?.scrollIntoView({behavior: 'smooth', block: 'start'});
    }, []);

    // Keyboard shortcuts (only for the active notebook tab):
    // Ctrl+Shift+Enter → Run All, Cmd/Ctrl+Z → Undo, Cmd/Ctrl+Shift+Z / Ctrl+Y → Redo.
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isActiveRef.current) return;

            if (matchesShortcut(e, 'notebook_run_all')) {
                e.preventDefault();
                runAll();
                return;
            }

            if (viewMode === 'report') return;

            const mod = e.metaKey || e.ctrlKey;
            if (!mod) return;
            const key = e.key.toLowerCase();
            if (key !== 'z' && key !== 'y') return;

            // Defer to a focused cell editor / input so their own undo keeps working.
            const el = document.activeElement as HTMLElement | null;
            if (el && (el.closest('.monaco-editor') || isTypingTarget(el))) {
                return;
            }

            if (key === 'y' || (key === 'z' && e.shiftKey)) {
                e.preventDefault();
                handleRedo();
            } else if (key === 'z') {
                e.preventDefault();
                handleUndo();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [matchesShortcut, runAll, handleUndo, handleRedo, viewMode]);

    const collapseAll = useCallback(() => {
        updateNotebook(readNotebookCells().map((c) => ({...c, isCollapsed: true})));
    }, [readNotebookCells, updateNotebook]);

    const expandAll = useCallback(() => {
        updateNotebook(readNotebookCells().map((c) => ({...c, isCollapsed: false})));
    }, [readNotebookCells, updateNotebook]);

    // Clearing outputs only touches live runtime state: nothing is executed or
    // deleted from the saved notebook, and it is not an undo step.
    const isExecuting = isRunning || cells.some((c) => c.isLoading);
    const canClearOutputs = !isExecuting && hasCellOutputs(cells);

    // Append a document-only copy of a cell; never while anything is executing.
    const duplicateCell = useCallback(
        (cellId: string) => {
            if (isExecuting) return;
            const current = readNotebookCells();
            const newCells = duplicateCellToEnd(current, cellId);
            if (newCells === current) return;
            insertCells(newCells, newCells[newCells.length - 1].id);
        },
        [isExecuting, insertCells, readNotebookCells],
    );

    const clearOutputs = useCallback(() => {
        setIsClearOutputsConfirmOpen(false);
        if (isExecuting) return;
        updateNotebook(clearCellOutputs(readNotebookCells()));
        setExecutedParamsByCell({});
        setRunAllResult(null);
    }, [isExecuting, readNotebookCells, updateNotebook]);

    const handleViewModeChange = useCallback((mode: NotebookViewMode) => {
        setViewMode(mode);
        if (mode === 'report') {
            setShowHistory(false);
        }
    }, []);

    // The query plan explains what the cell would run: parameters first, then
    // cell references. A parameter that cannot be sent stops the plan as well.
    const queryPlanProps = (cell: NotebookCell) => {
        if (cell.type !== 'sql' || !cell.isQueryPlanVisible || cell.isDisabled) return {};
        const resolved = resolveParams(cell.content.trim(), params, sqlDialect);
        return {
            explainQuery: resolveQueryVariables(resolved.sql, cells, variableOptions),
            explainError:
                resolved.errors.length > 0 ? describeParamErrors(resolved.errors) : undefined,
        };
    };

    const toolbarProps = {
        onAddSqlCell: () => addCell('sql'),
        onAddMarkdownCell: () => addCell('markdown'),
        onRunAll: runAll,
        onExport: handleExport,
        onExportHtml: handleExportHtml,
        onExportSql: handleExportSql,
        onExportMarkdown: handleExportMarkdown,
        onImport: handleImport,
        isRunning,
        stopOnError,
        onToggleStopOnError: toggleStopOnError,
        onCollapseAll: collapseAll,
        onExpandAll: expandAll,
        onClearOutputs: () => setIsClearOutputsConfirmOpen(true),
        canClearOutputs,
        onUndo: handleUndo,
        onRedo: handleRedo,
        canUndo,
        canRedo,
        onToggleHistory: () => setShowHistory((v) => !v),
        historyOpen: showHistory,
        viewMode,
        onViewModeChange: handleViewModeChange,
    };

    // Loading state
    if (!notebook) {
        return (
            <div className="flex flex-col h-full">
                <NotebookToolbar {...toolbarProps} />
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted">
                    <Loader2 size={32} className="animate-spin opacity-40" />
                </div>
            </div>
        );
    }

    // Empty state
    if (cells.length === 0) {
        return (
            <div className="flex flex-col h-full">
                <NotebookToolbar {...toolbarProps} />
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted">
                    <BookOpen size={32} className="opacity-40" />
                    <p className="text-sm">{t('editor.notebook.emptyNotebook')}</p>
                </div>
            </div>
        );
    }

    const historyView = historyTimeline(history, notebook);

    // A drop line is shown in gap `pos` unless it'd leave the cell where it is.
    const showLineAt = (pos: number) =>
        dropPos === pos && dragIndex !== null && pos !== dragIndex && pos !== dragIndex + 1;
    const renderDropLine = (placement: 'top' | 'bottom') => (
        <div
            className={`pointer-events-none absolute ${
                placement === 'top' ? '-top-1.5' : '-bottom-1.5'
            } left-0 right-0 z-10 flex items-center gap-1`}
        >
            <span className="h-2 w-2 shrink-0 rounded-full bg-accent-primary shadow-[0_0_6px_var(--accent-primary)]" />
            <span className="h-0.5 flex-1 rounded-full bg-accent-primary shadow-[0_0_6px_var(--accent-primary)]" />
        </div>
    );

    return (
        <div className="flex flex-col h-full relative">
            <ConfirmModal
                key={dangerousQuery?.confirmationId}
                isOpen={!!dangerousQuery}
                onClose={() => resolveDangerousQuery(false)}
                onConfirm={() => resolveDangerousQuery(true)}
                title={t(
                    dangerousQuery
                        ? DANGEROUS_QUERY_I18N[dangerousQuery.kind].title
                        : 'editor.dangerousQueryTitle',
                )}
                message={t(
                    dangerousQuery
                        ? DANGEROUS_QUERY_I18N[dangerousQuery.kind].message
                        : 'editor.dangerousQueryMessage',
                )}
                sql={dangerousQuery?.sql}
                confirmLabel={t('editor.dangerousQueryConfirm')}
                variant="danger"
                confirmDelaySeconds={settings.safetyConfirmationDelayEnabled ? 5 : undefined}
            />
            <ConfirmModal
                isOpen={isClearOutputsConfirmOpen}
                onClose={() => setIsClearOutputsConfirmOpen(false)}
                onConfirm={clearOutputs}
                title={t('editor.notebook.clearOutputs')}
                message={t('editor.notebook.clearOutputsConfirm')}
                confirmLabel={t('editor.notebook.clearOutputs')}
                variant="warning"
            />
            <NotebookToolbar {...toolbarProps} />
            {viewMode === 'report' ? (
                <NotebookReportView
                    cells={cells}
                    params={params}
                    onParamsChange={handleParamsChange}
                    paramDrafts={paramDrafts}
                    onParamDraftsChange={setParamDrafts}
                    typedParamsSupported={typedParamsSupported}
                    runAllResult={runAllResult}
                    onDismissRunAllResult={() => setRunAllResult(null)}
                    onSwitchToEdit={() => handleViewModeChange('edit')}
                    outdatedCellIds={outdatedCellIds}
                />
            ) : (
                <>
                    {showHistory && (
                        <NotebookHistoryPanel
                            states={historyView.states}
                            currentIndex={historyView.currentIndex}
                            onJump={handleJump}
                            onClose={() => setShowHistory(false)}
                        />
                    )}
                    <div
                        ref={scrollContainerRef}
                        onDragOver={handleContainerDragOver}
                        className="flex-1 overflow-auto p-4 space-y-0"
                    >
                        <ParamsPanel
                            params={params}
                            onParamsChange={handleParamsChange}
                            drafts={paramDrafts}
                            onDraftsChange={setParamDrafts}
                            typedSupported={typedParamsSupported}
                        />
                        <NotebookOutline
                            cells={cells}
                            onScrollToCell={scrollToCell}
                            onCellNameGenerated={(cellId, name) => updateCell(cellId, {name})}
                        />

                        {runAllResult && (
                            <RunAllSummary
                                result={runAllResult}
                                cells={cells}
                                onDismiss={() => setRunAllResult(null)}
                                onScrollToCell={scrollToCell}
                            />
                        )}

                        <AddCellButton
                            onAddSql={() => addCell('sql', -1)}
                            onAddMarkdown={() => addCell('markdown', -1)}
                        />
                        {cells.map((cell, index) => (
                            <div
                                key={cell.id}
                                ref={(el) => {
                                    if (el) cellRefsMap.current.set(cell.id, el);
                                    else cellRefsMap.current.delete(cell.id);
                                }}
                                onDragOver={handleDragOver(index)}
                                onDrop={handleDrop(index)}
                                className="relative scroll-mt-4"
                            >
                                {showLineAt(index) && renderDropLine('top')}
                                <NotebookCellWrapper
                                    cell={cell}
                                    index={index}
                                    totalCells={cells.length}
                                    onUpdate={(partial) => updateCell(cell.id, partial)}
                                    onDelete={() => deleteCell(cell.id)}
                                    onMoveUp={() => {
                                        if (index > 0)
                                            updateNotebook(
                                                reorderCells(readNotebookCells(), index, index - 1),
                                            );
                                    }}
                                    onMoveDown={() => {
                                        if (index < cells.length - 1)
                                            updateNotebook(
                                                reorderCells(readNotebookCells(), index, index + 1),
                                            );
                                    }}
                                    onRun={() => runPlan({mode: 'cell', cellId: cell.id})}
                                    onRunAffected={() =>
                                        runPlan({mode: 'affected', cellId: cell.id})
                                    }
                                    isRunBusy={isRunning}
                                    onDuplicate={() => duplicateCell(cell.id)}
                                    canDuplicate={!isExecuting}
                                    connectionId={connectionId}
                                    {...queryPlanProps(cell)}
                                    activeSchema={cell.schema || effectiveSchema || undefined}
                                    selectedDatabases={isMultiDb ? selectedDatabases : undefined}
                                    onSchemaChange={
                                        isMultiDb
                                            ? (schema) => updateCell(cell.id, {schema})
                                            : undefined
                                    }
                                    isDragging={dragIndex === index}
                                    dragHandleProps={{
                                        draggable: true,
                                        onDragStart: handleDragStart(index),
                                        onDragEnd: handleDragEnd,
                                    }}
                                />
                                <AddCellButton
                                    onAddSql={() => addCell('sql', index)}
                                    onAddMarkdown={() => addCell('markdown', index)}
                                />
                                {index === cells.length - 1 &&
                                    showLineAt(cells.length) &&
                                    renderDropLine('bottom')}
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
