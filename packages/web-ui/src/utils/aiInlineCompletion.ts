import type * as Monaco from 'monaco-editor';
import type {TypedCommandCaller} from '@/api/contract';
import {createRequestId} from '@/api/errors';
import type {DatabaseContextType, TableInfo} from '@/contexts/DatabaseContext';

export interface AiInlineContext {
    key: string;
    schema: string;
    dialect: string;
}

/** Allowlist metadata fields: never serialize result rows, defaults or connection objects. */
export function inlineSchema(tables: readonly TableInfo[]): string {
    return tables
        .slice(0, 100)
        .map(({name, schema}) => JSON.stringify({name, schema}))
        .join('\n')
        .slice(0, 8000);
}

export function inlineTables(
    state: Pick<
        DatabaseContextType,
        | 'tables'
        | 'schemaDataMap'
        | 'databaseDataMap'
        | 'nestedDatabaseDataMap'
        | 'activeCapabilities'
        | 'activeSchema'
        | 'activeDatabaseName'
    >,
    schema: string | null | undefined,
    database: string | null | undefined,
): readonly TableInfo[] {
    if (database && state.nestedDatabaseDataMap[database]) {
        return schema
            ? (state.nestedDatabaseDataMap[database].schemaDataMap[schema]?.tables ?? [])
            : [];
    }
    if (!state.activeCapabilities?.schemas && database && state.databaseDataMap[database]) {
        return state.databaseDataMap[database].tables;
    }
    // A different database must never inherit the active database's cached names.
    if (database && database !== state.activeDatabaseName) return [];
    if (state.activeCapabilities?.schemas && schema) {
        return (
            state.schemaDataMap[schema]?.tables ??
            (schema === state.activeSchema ? state.tables : [])
        );
    }
    return state.tables;
}

export function inlineContext(model: Monaco.editor.ITextModel, position: Monaco.IPosition) {
    const offset = model.getOffsetAt(position);
    const start = model.getPositionAt(Math.max(0, offset - 4000));
    const end = model.getPositionAt(offset + 1000);
    return {
        prefix: model.getValueInRange({
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
        }),
        suffix: model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column,
        }),
    };
}

/** Monaco owns Tab/Escape, accessibility and the single undoable insertion. No run callback. */
export function installAiInlineCompletion(
    editor: Monaco.editor.IStandaloneCodeEditor,
    monaco: typeof Monaco,
    client: TypedCommandCaller,
    options: AiInlineContext & {provider: string; model: string},
): Monaco.IDisposable {
    let disposed = false;
    let composing = false;
    let controller: AbortController | null = null;
    let retryAfter = 0;
    const invalidate = () => {
        controller?.abort();
        controller = null;
    };
    const dismiss = () => {
        invalidate();
        editor.trigger('ai-inline', 'editor.action.inlineSuggest.hide', undefined);
    };
    const listeners = [
        editor.onDidChangeModelContent(invalidate),
        editor.onDidChangeCursorSelection(invalidate),
        editor.onDidChangeModel(invalidate),
        editor.onDidBlurEditorText(dismiss),
        editor.onDidCompositionStart(() => {
            composing = true;
            dismiss();
        }),
        editor.onDidCompositionEnd(() => {
            composing = false;
        }),
    ];
    const provider = monaco.languages.registerInlineCompletionsProvider('sql', {
        async provideInlineCompletions(model, position, context, token) {
            if (
                disposed ||
                composing ||
                token.isCancellationRequested ||
                Date.now() < retryAfter ||
                editor.getModel() !== model ||
                !editor.hasTextFocus() ||
                editor.getOption(monaco.editor.EditorOption.readOnly) ||
                (editor.getSelections()?.length ?? 0) !== 1 ||
                !editor.getSelection()?.isEmpty() ||
                context.selectedSuggestionInfo
            )
                return {items: []};
            const {prefix, suffix} = inlineContext(model, position);
            if (!prefix.trim()) return {items: []};
            controller?.abort();
            const current = new AbortController();
            controller = current;
            const version = model.getVersionId();
            const cancellation = token.onCancellationRequested(() => current.abort());
            try {
                const ready = await new Promise<boolean>((resolve) => {
                    const aborted = () => {
                        clearTimeout(timer);
                        resolve(false);
                    };
                    const timer = setTimeout(() => {
                        current.signal.removeEventListener('abort', aborted);
                        resolve(true);
                    }, 600);
                    current.signal.addEventListener('abort', aborted, {once: true});
                    if (current.signal.aborted) aborted();
                });
                if (!ready || disposed || composing || current.signal.aborted) return {items: []};
                const requestId = createRequestId();
                const text = await new Promise<string | null>((resolve) => {
                    const aborted = () => {
                        void client.call('cancel_ai_inline', {requestId}).catch(() => {});
                        resolve(null);
                    };
                    current.signal.addEventListener('abort', aborted, {once: true});
                    void client
                        .call('complete_ai_inline', {
                            req: {
                                requestId,
                                provider: options.provider,
                                model: options.model,
                                prefix,
                                suffix,
                                schema: options.schema,
                                dialect: options.dialect,
                            },
                        })
                        .then(
                            (text) => {
                                current.signal.removeEventListener('abort', aborted);
                                resolve(text);
                            },
                            () => {
                                current.signal.removeEventListener('abort', aborted);
                                if (!current.signal.aborted) retryAfter = Date.now() + 30_000;
                                resolve(null);
                            },
                        );
                });
                if (
                    !text ||
                    text.length > 4000 ||
                    text.includes('\0') ||
                    current.signal.aborted ||
                    disposed ||
                    composing ||
                    model.isDisposed() ||
                    editor.getModel() !== model ||
                    model.getVersionId() !== version ||
                    !editor.hasTextFocus() ||
                    !editor.getPosition()?.equals(position)
                )
                    return {items: []};
                // Monaco permits multiline insertions only at the end of a line.
                if (
                    /[\r\n]/.test(text) &&
                    position.column !== model.getLineMaxColumn(position.lineNumber)
                )
                    return {items: []};
                return {
                    items: [
                        {
                            insertText: text,
                            range: new monaco.Range(
                                position.lineNumber,
                                position.column,
                                position.lineNumber,
                                position.column,
                            ),
                        },
                    ],
                    suppressSuggestions: false,
                };
            } finally {
                cancellation.dispose();
                if (controller === current) controller = null;
            }
        },
        disposeInlineCompletions() {},
    });
    return {
        dispose() {
            disposed = true;
            dismiss();
            provider.dispose();
            listeners.forEach((listener) => listener.dispose());
        },
    };
}
