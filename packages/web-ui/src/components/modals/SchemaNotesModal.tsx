import {useCallback, useEffect, useId, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {X, Loader2, NotebookPen, Upload, Download, Eye, Pencil} from 'lucide-react';
import {Modal} from '@/components/ui/Modal';
import {SchemaNoteMarkdown} from '@/components/ui/SchemaNoteMarkdown';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {usePlatformCapabilities} from '@/hooks/usePlatformCapabilities';
import type {TableTarget} from '@/types/databaseObjects';
import type {TableColumn} from '@/types/editor';
import type {SchemaNoteTarget, SchemaNotesState} from '@/types/schemaNotes';
import {formatColumnType} from '@/utils/columnType';
import {
    SCHEMA_NOTES_FILE_FILTER,
    columnsWithNotes,
    describeTarget,
    findNote,
    groupNotesByDomain,
    noteKey,
    noteTarget,
    schemaNotesFileName,
} from '@/utils/schemaNotes';

interface SchemaNotesModalProps {
    isOpen: boolean;
    onClose: () => void;
    target: TableTarget;
    connectionName: string;
}

interface Draft {
    target: SchemaNoteTarget;
    domain: string;
    note: string;
}

interface TableMetadata {
    key: string;
    columns: TableColumn[];
    tableComment: string | null;
    tableFound: boolean | null;
    error: string | null;
}

const focusRing =
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const inputClass =
    'w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary text-sm focus:border-focus focus:outline-none disabled:opacity-60';
const secondaryButton = `px-3 py-2 text-sm text-secondary hover:text-primary border border-strong rounded-lg flex items-center gap-2 disabled:opacity-50 ${focusRing}`;
const decoder = new TextDecoder('utf-8', {fatal: true});
const encoder = new TextEncoder();

export const SchemaNotesModal = ({
    isOpen,
    onClose,
    target,
    connectionName,
}: SchemaNotesModalProps) => {
    const {t} = useTranslation();
    const client = useTabularisClient();
    const platform = usePlatformCapabilities();
    const titleId = useId();
    const fieldId = useId();
    const {connectionId} = target;

    const [notes, setNotes] = useState<SchemaNotesState | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [current, setCurrent] = useState<SchemaNoteTarget>(() =>
        noteTarget({database: target.database, schema: target.schema, table: target.tableName}),
    );
    const [metadata, setMetadata] = useState<TableMetadata | null>(null);
    const [drafts, setDrafts] = useState<Record<string, Draft>>({});
    const [projectDraft, setProjectDraft] = useState<string | null>(null);
    const [preview, setPreview] = useState(false);
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);

    const currentKey = noteKey(current);
    const dirty = projectDraft !== null || Object.keys(drafts).length > 0;
    const readOnly = notes === null || busy;

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        client
            .call('get_schema_notes', {connectionId})
            .then((state) => {
                if (!cancelled) setNotes(state);
            })
            .catch((error: unknown) => {
                if (!cancelled) setLoadError(String(error));
            });
        return () => {
            cancelled = true;
        };
    }, [client, connectionId, isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        const scope = {
            connectionId,
            ...(current.database ? {database: current.database} : {}),
            ...(current.schema ? {schema: current.schema} : {}),
        };
        Promise.allSettled([
            client.call('get_columns', {...scope, tableName: current.table}),
            client.call('get_tables', scope),
        ]).then(([columns, tables]) => {
            if (cancelled) return;
            const table =
                tables.status === 'fulfilled'
                    ? tables.value.find((entry) => entry.name === current.table)
                    : undefined;
            setMetadata({
                key: currentKey,
                columns: columns.status === 'fulfilled' ? columns.value : [],
                tableComment: table?.comment ?? null,
                tableFound: tables.status === 'fulfilled' ? Boolean(table) : null,
                error:
                    columns.status === 'rejected' && tables.status === 'rejected'
                        ? String(columns.reason)
                        : null,
            });
        });
        return () => {
            cancelled = true;
        };
    }, [client, connectionId, current, currentKey, isOpen]);

    const groups = useMemo(() => (notes ? groupNotesByDomain(notes) : []), [notes]);
    const currentMetadata = metadata?.key === currentKey ? metadata : null;
    const columns = useMemo(
        () =>
            notes && currentMetadata
                ? columnsWithNotes(
                      notes,
                      current,
                      currentMetadata.columns.map((column) => column.name),
                  )
                : [],
        [current, currentMetadata, notes],
    );

    const valueFor = useCallback(
        (objectTarget: SchemaNoteTarget): {domain: string; note: string} => {
            const draft = drafts[noteKey(objectTarget)];
            if (draft) return draft;
            const stored = notes ? findNote(notes, objectTarget) : undefined;
            return {domain: stored?.domain ?? '', note: stored?.note ?? ''};
        },
        [drafts, notes],
    );

    const edit = (objectTarget: SchemaNoteTarget, change: Partial<Draft>) => {
        const key = noteKey(objectTarget);
        setStatus(null);
        setDrafts((previous) => ({
            ...previous,
            [key]: {...valueFor(objectTarget), ...previous[key], ...change, target: objectTarget},
        }));
    };

    const save = async () => {
        if (!notes) return;
        setBusy(true);
        setActionError(null);
        let latest = notes;
        const remaining = {...drafts};
        try {
            for (const [key, draft] of Object.entries(drafts)) {
                const stored = findNote(latest, draft.target);
                const unchanged =
                    (stored?.note ?? '') === draft.note &&
                    (stored?.domain ?? '') === draft.domain.trim();
                if (!unchanged) {
                    latest = await client.call('set_schema_note', {
                        connectionId,
                        target: draft.target,
                        domain: draft.target.column ? null : draft.domain.trim() || null,
                        note: draft.note,
                    });
                }
                delete remaining[key];
            }
            if (projectDraft !== null && projectDraft !== latest.projectNote) {
                latest = await client.call('set_schema_note', {
                    connectionId,
                    target: null,
                    domain: null,
                    note: projectDraft,
                });
            }
            setProjectDraft(null);
            setStatus(t('schemaNotes.saved'));
        } catch (error) {
            setActionError(String(error));
        } finally {
            setNotes(latest);
            setDrafts(remaining);
            setBusy(false);
        }
    };

    const toggleAi = async (enabled: boolean) => {
        setBusy(true);
        setActionError(null);
        try {
            setNotes(await client.call('set_schema_notes_ai_context', {connectionId, enabled}));
        } catch (error) {
            setActionError(String(error));
        } finally {
            setBusy(false);
        }
    };

    const importNotes = async () => {
        setActionError(null);
        setStatus(null);
        try {
            const file = await platform.chooseInputFile({
                title: t('schemaNotes.import'),
                filters: SCHEMA_NOTES_FILE_FILTER,
            });
            if (!file) return;
            setBusy(true);
            const contents = decoder.decode(await platform.readInputFile(file.reference));
            setNotes(await client.call('import_schema_notes', {connectionId, contents}));
            setStatus(t('schemaNotes.imported', {name: file.name}));
        } catch (error) {
            setActionError(String(error));
        } finally {
            setBusy(false);
        }
    };

    const exportNotes = async () => {
        setActionError(null);
        setStatus(null);
        try {
            const contents = await client.call('export_schema_notes', {connectionId});
            await platform.downloadFile({
                fileName: schemaNotesFileName(connectionName),
                contents: encoder.encode(contents),
                mimeType: 'application/json',
                title: t('schemaNotes.export'),
                filters: SCHEMA_NOTES_FILE_FILTER,
            });
        } catch (error) {
            setActionError(String(error));
        }
    };

    const tableValue = valueFor(current);
    const projectValue = projectDraft ?? notes?.projectNote ?? '';

    const noteField = (
        id: string,
        label: string,
        value: string,
        onChange: (value: string) => void,
        rows = 2,
    ) =>
        preview ? (
            <div className="min-h-[2rem] px-3 py-2 bg-base border border-default rounded-lg">
                {value.trim() ? (
                    <SchemaNoteMarkdown content={value} />
                ) : (
                    <span className="text-xs text-muted">{t('schemaNotes.empty')}</span>
                )}
            </div>
        ) : (
            <textarea
                id={id}
                aria-label={label}
                value={value}
                rows={rows}
                disabled={readOnly}
                spellCheck
                placeholder={t('schemaNotes.notePlaceholder')}
                onChange={(event) => onChange(event.target.value)}
                className={`${inputClass} resize-y font-mono`}
            />
        );

    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="bg-elevated border border-strong rounded-xl shadow-2xl w-[1000px] max-w-[95vw] h-[85vh] overflow-hidden flex flex-col"
            >
                <div className="flex items-center justify-between p-4 border-b border-default bg-base">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 bg-accent-primary/15 rounded-lg">
                            <NotebookPen size={20} className="text-accent" />
                        </div>
                        <div className="min-w-0">
                            <h2 id={titleId} className="text-lg font-semibold text-primary">
                                {t('schemaNotes.title')}
                            </h2>
                            <p className="text-xs text-secondary">{t('schemaNotes.subtitle')}</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        aria-label={t('common.close')}
                        onClick={onClose}
                        className={`text-secondary hover:text-primary transition-colors rounded ${focusRing}`}
                    >
                        <X size={20} />
                    </button>
                </div>

                {loadError && (
                    <div
                        role="alert"
                        className="mx-4 mt-4 text-error-text text-sm bg-error-bg p-3 rounded border border-error-border"
                    >
                        <p className="font-medium">{t('schemaNotes.loadFailed')}</p>
                        <p className="mt-1 break-words font-mono text-xs">{loadError}</p>
                    </div>
                )}

                <div className="flex flex-1 min-h-0">
                    <nav
                        aria-label={t('schemaNotes.documented')}
                        className="w-64 shrink-0 border-r border-default overflow-y-auto p-3 space-y-3"
                    >
                        <h3 className="text-xs uppercase font-bold text-muted">
                            {t('schemaNotes.documented')}
                        </h3>
                        {notes && groups.length === 0 && (
                            <p className="text-xs text-muted">{t('schemaNotes.noNotes')}</p>
                        )}
                        {groups.map((group) => (
                            <div key={group.domain || '\u0000'}>
                                <p className="text-xs font-semibold text-secondary mb-1">
                                    {group.domain || t('schemaNotes.noDomain')}
                                </p>
                                <ul className="space-y-0.5">
                                    {group.tables.map((entry) => {
                                        const selected = noteKey(entry.target) === currentKey;
                                        return (
                                            <li key={noteKey(entry.target)}>
                                                <button
                                                    type="button"
                                                    aria-current={selected ? 'true' : undefined}
                                                    onClick={() => setCurrent(entry.target)}
                                                    className={`w-full text-left px-2 py-1 rounded text-xs font-mono break-all ${
                                                        selected
                                                            ? 'bg-accent-primary/15 text-primary'
                                                            : 'text-secondary hover:text-primary hover:bg-surface-secondary'
                                                    } ${focusRing}`}
                                                >
                                                    {describeTarget(entry.target)}
                                                    {entry.columnCount > 0 && (
                                                        <span className="ml-1 text-muted">
                                                            {t('schemaNotes.columnCount', {
                                                                count: entry.columnCount,
                                                            })}
                                                        </span>
                                                    )}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        ))}
                    </nav>

                    <div className="flex-1 min-w-0 overflow-y-auto p-6 space-y-6">
                        {!notes && !loadError ? (
                            <div className="text-center py-8 text-muted">
                                <Loader2 size={24} className="animate-spin mx-auto mb-2" />
                                {t('schemaNotes.loading')}
                            </div>
                        ) : (
                            <>
                                <section className="space-y-2">
                                    <label
                                        htmlFor={`${fieldId}-project`}
                                        className="text-xs uppercase font-bold text-muted block"
                                    >
                                        {t('schemaNotes.projectNote', {name: connectionName})}
                                    </label>
                                    {noteField(
                                        `${fieldId}-project`,
                                        t('schemaNotes.projectNote', {name: connectionName}),
                                        projectValue,
                                        (value) => {
                                            setStatus(null);
                                            setProjectDraft(value);
                                        },
                                    )}
                                </section>

                                <section className="space-y-3">
                                    <div>
                                        <h3 className="text-sm font-semibold text-primary font-mono break-all">
                                            {describeTarget(current)}
                                        </h3>
                                        {currentMetadata?.tableFound === false && (
                                            <p className="text-xs text-accent-warning mt-1">
                                                {t('schemaNotes.tableNotFound')}
                                            </p>
                                        )}
                                        {currentMetadata?.error && (
                                            <p className="text-xs text-muted mt-1">
                                                {t('schemaNotes.metadataUnavailable')}
                                            </p>
                                        )}
                                    </div>
                                    {currentMetadata?.tableComment && (
                                        <div className="text-xs text-secondary">
                                            <span className="uppercase font-bold text-muted mr-2">
                                                {t('schemaNotes.databaseComment')}
                                            </span>
                                            <span className="whitespace-pre-wrap">
                                                {currentMetadata.tableComment}
                                            </span>
                                        </div>
                                    )}
                                    <div>
                                        <label
                                            htmlFor={`${fieldId}-domain`}
                                            className="text-xs uppercase font-bold text-muted block mb-1"
                                        >
                                            {t('schemaNotes.domain')}
                                        </label>
                                        <input
                                            id={`${fieldId}-domain`}
                                            value={tableValue.domain}
                                            disabled={readOnly || preview}
                                            placeholder={t('schemaNotes.domainPlaceholder')}
                                            onChange={(event) =>
                                                edit(current, {domain: event.target.value})
                                            }
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label
                                            htmlFor={`${fieldId}-table`}
                                            className="text-xs uppercase font-bold text-muted block mb-1"
                                        >
                                            {t('schemaNotes.tableNote')}
                                        </label>
                                        {noteField(
                                            `${fieldId}-table`,
                                            t('schemaNotes.tableNote'),
                                            tableValue.note,
                                            (value) => edit(current, {note: value}),
                                            3,
                                        )}
                                    </div>
                                </section>

                                <section className="space-y-3">
                                    <h3 className="text-xs uppercase font-bold text-muted">
                                        {t('schemaNotes.columns')}
                                    </h3>
                                    {!currentMetadata && (
                                        <Loader2 size={16} className="animate-spin text-muted" />
                                    )}
                                    {columns.map(({name, found}, index) => {
                                        const columnTarget = noteTarget(current, name);
                                        const column = currentMetadata?.columns.find(
                                            (entry) => entry.name === name,
                                        );
                                        const id = `${fieldId}-column-${index}`;
                                        return (
                                            <div
                                                key={name}
                                                className="border border-default rounded-lg p-3 space-y-2"
                                            >
                                                <div className="flex items-baseline gap-2 flex-wrap">
                                                    <label
                                                        htmlFor={id}
                                                        className="text-sm font-mono text-primary"
                                                    >
                                                        {name}
                                                    </label>
                                                    {column && (
                                                        <span className="text-xs font-mono text-accent">
                                                            {formatColumnType(column)}
                                                        </span>
                                                    )}
                                                    {!found && (
                                                        <span className="text-xs text-accent-warning">
                                                            {t('schemaNotes.columnNotFound')}
                                                        </span>
                                                    )}
                                                </div>
                                                {column?.comment && (
                                                    <p className="text-xs text-secondary">
                                                        <span className="uppercase font-bold text-muted mr-2">
                                                            {t('schemaNotes.databaseComment')}
                                                        </span>
                                                        <span className="whitespace-pre-wrap">
                                                            {column.comment}
                                                        </span>
                                                    </p>
                                                )}
                                                {noteField(
                                                    id,
                                                    t('schemaNotes.columnNote', {column: name}),
                                                    valueFor(columnTarget).note,
                                                    (value) => edit(columnTarget, {note: value}),
                                                )}
                                            </div>
                                        );
                                    })}
                                </section>
                            </>
                        )}
                    </div>
                </div>

                <div className="p-4 border-t border-default bg-base/50 space-y-3">
                    {(actionError || status) && (
                        <p
                            role={actionError ? 'alert' : 'status'}
                            className={`text-sm break-words ${actionError ? 'text-error-text' : 'text-accent-success'}`}
                        >
                            {actionError ?? status}
                        </p>
                    )}
                    <div className="flex items-center gap-3 flex-wrap">
                        <label className="flex items-start gap-2 text-sm text-secondary max-w-md">
                            <input
                                type="checkbox"
                                className="mt-1"
                                checked={notes?.includeInAiContext ?? false}
                                disabled={readOnly}
                                onChange={(event) => void toggleAi(event.target.checked)}
                            />
                            <span>
                                {t('schemaNotes.includeInAi')}
                                <span className="block text-xs text-muted">
                                    {t('schemaNotes.includeInAiHint')}
                                </span>
                            </span>
                        </label>
                        <div className="flex-1" />
                        <button
                            type="button"
                            aria-pressed={preview}
                            onClick={() => setPreview((value) => !value)}
                            className={secondaryButton}
                        >
                            {preview ? <Pencil size={14} /> : <Eye size={14} />}
                            {preview ? t('schemaNotes.edit') : t('schemaNotes.preview')}
                        </button>
                        <button
                            type="button"
                            onClick={() => void importNotes()}
                            disabled={readOnly || dirty}
                            title={dirty ? t('schemaNotes.saveBeforeImport') : undefined}
                            className={secondaryButton}
                        >
                            <Upload size={14} />
                            {t('schemaNotes.import')}
                        </button>
                        <button
                            type="button"
                            onClick={() => void exportNotes()}
                            disabled={readOnly}
                            className={secondaryButton}
                        >
                            <Download size={14} />
                            {t('schemaNotes.export')}
                        </button>
                        <button
                            type="button"
                            onClick={() => void save()}
                            disabled={readOnly || !dirty}
                            className={`px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 disabled:opacity-50 text-inverse rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${focusRing}`}
                        >
                            {busy && <Loader2 size={14} className="animate-spin" />}
                            {t('schemaNotes.save')}
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );
};
