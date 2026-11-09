import {useEffect} from 'react';
import {useTranslation} from 'react-i18next';
import type * as Monaco from 'monaco-editor';
import {analyzeDocument} from '@/utils/sqlDiagnosticsDocument';
import type {RelationResolver, SqlDiagnostic, SqlDiagnosticCode} from '@/utils/sqlDiagnostics';

/** Marker owner: keeps these markers apart from any other source of markers. */
export const SQL_DIAGNOSTICS_OWNER = 'tabularis-sql-diagnostics';
export const SQL_DIAGNOSTICS_DEBOUNCE_MS = 500;

export interface SqlDiagnosticsOptions {
    resolveRelation: RelationResolver;
}

export interface SqlDiagnosticsTarget {
    editor: Monaco.editor.IStandaloneCodeEditor;
    monaco: typeof Monaco;
}

const MESSAGE_KEYS: Record<SqlDiagnosticCode, string> = {
    unresolvedRelation: 'editor.diagnostics.unresolvedRelation',
    unresolvedColumn: 'editor.diagnostics.unresolvedColumn',
    unresolvedAlias: 'editor.diagnostics.unresolvedAlias',
    ambiguousColumn: 'editor.diagnostics.ambiguousColumn',
    unsupportedConstruct: 'editor.diagnostics.unsupportedConstruct',
    metadataUnavailable: 'editor.diagnostics.metadataUnavailable',
};

/**
 * Publishes metadata-aware SQL diagnostics as Monaco markers on the editor's
 * model. Analysis is debounced, cancelled by the next edit, and its result is
 * dropped when the text or the options changed while it ran. Nothing is sent
 * to the server except the column lookups of relations the query names.
 * Disabled (and markers removed) while `options` is undefined.
 */
export function useSqlDiagnostics(
    target: SqlDiagnosticsTarget | null,
    options: SqlDiagnosticsOptions | undefined,
) {
    const {t} = useTranslation();
    const editor = target?.editor;
    const monaco = target?.monaco;
    const resolveRelation = options?.resolveRelation;

    useEffect(() => {
        const model = editor?.getModel();
        if (!editor || !monaco || !model || !resolveRelation) return;

        const toMarker = (diagnostic: SqlDiagnostic): Monaco.editor.IMarkerData => {
            const start = model.getPositionAt(diagnostic.start);
            const end = model.getPositionAt(diagnostic.end);
            return {
                severity:
                    diagnostic.severity === 'error'
                        ? monaco.MarkerSeverity.Error
                        : diagnostic.severity === 'warning'
                          ? monaco.MarkerSeverity.Warning
                          : monaco.MarkerSeverity.Info,
                message: t(MESSAGE_KEYS[diagnostic.code], {name: diagnostic.name}),
                code: diagnostic.code,
                source: 'Tabularis',
                startLineNumber: start.lineNumber,
                startColumn: start.column,
                endLineNumber: end.lineNumber,
                endColumn: end.column,
            };
        };

        let timer: ReturnType<typeof setTimeout> | null = null;
        let controller: AbortController | null = null;

        const run = () => {
            timer = null;
            controller?.abort();
            const current = new AbortController();
            controller = current;
            const versionId = model.getVersionId();

            analyzeDocument(model.getValue(), {resolveRelation, signal: current.signal})
                .then((diagnostics) => {
                    if (current.signal.aborted || model.isDisposed()) return;
                    if (model.getVersionId() !== versionId) return;
                    monaco.editor.setModelMarkers(
                        model,
                        SQL_DIAGNOSTICS_OWNER,
                        diagnostics.map(toMarker),
                    );
                })
                .catch((error: unknown) => {
                    console.error('SQL diagnostics failed:', error);
                });
        };

        const schedule = () => {
            if (timer) clearTimeout(timer);
            controller?.abort();
            timer = setTimeout(run, SQL_DIAGNOSTICS_DEBOUNCE_MS);
        };

        const subscription = model.onDidChangeContent(schedule);
        schedule();

        return () => {
            subscription.dispose();
            if (timer) clearTimeout(timer);
            controller?.abort();
            if (!model.isDisposed())
                monaco.editor.setModelMarkers(model, SQL_DIAGNOSTICS_OWNER, []);
        };
    }, [editor, monaco, resolveRelation, t]);
}
