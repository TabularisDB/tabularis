import {VIM_STATUS_LINE_HEIGHT} from '@/utils/editorLayout';
import {useState, useCallback, useEffect, useRef} from 'react';
import {useTranslation} from 'react-i18next';
import type {OnMount} from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import {SqlEditorWrapper} from '@/components/ui/SqlEditorWrapper';
import {useSettings} from '@/hooks/useSettings';
import {NotebookAiButtons} from './NotebookAiButtons';
import {CellSectionHeader} from './CellSectionHeader';
import {findOpenReference, type ReferenceSuggestion} from '@/utils/notebookAlias';

interface SqlCellEditorProps {
    cellId: string;
    content: string;
    onContentChange: (content: string) => void;
    onRun: () => void;
    connectionId: string;
    schema?: string;
    collapsed?: boolean;
    onToggleCollapse: () => void;
    /** What a `{{` can complete to: other cells' aliases and positions. */
    getReferenceSuggestions?: () => ReferenceSuggestion[];
}

export function SqlCellEditor({
    cellId,
    content,
    onContentChange,
    onRun,
    connectionId,
    schema,
    collapsed,
    onToggleCollapse,
    getReferenceSuggestions,
}: SqlCellEditorProps) {
    const {settings} = useSettings();
    const {t} = useTranslation();
    const [editorHeight, setEditorHeight] = useState(60);
    const suggestionsRef = useRef(getReferenceSuggestions);
    useEffect(() => {
        suggestionsRef.current = getReferenceSuggestions;
    }, [getReferenceSuggestions]);
    const positionDetail = useCallback(
        (n: number) => t('editor.notebook.alias.completionDetail', {n}),
        [t],
    );
    const onMount: OnMount = useCallback(
        (editor, monaco) => {
            const sync = () => setEditorHeight(Math.max(60, editor.getContentHeight()));
            editor.onDidContentSizeChange(sync);
            sync();

            if (!monaco?.languages) return;
            // `{{` completes to the other cells' aliases and positions, in this editor only.
            const provider = monaco.languages.registerCompletionItemProvider('sql', {
                triggerCharacters: ['{'],
                provideCompletionItems: (
                    model: Monaco.editor.ITextModel,
                    position: Monaco.Position,
                ) => {
                    const suggestions = suggestionsRef.current?.() ?? [];
                    if (model !== editor.getModel() || suggestions.length === 0) {
                        return {suggestions: []};
                    }
                    const line = model.getLineContent(position.lineNumber);
                    const open = findOpenReference(line, position.column - 1);
                    if (!open) return {suggestions: []};
                    const range = {
                        startLineNumber: position.lineNumber,
                        endLineNumber: position.lineNumber,
                        startColumn: open.start + 1,
                        endColumn: open.end + 1,
                    };
                    return {
                        suggestions: suggestions.map((s, i) => ({
                            label: s.label,
                            kind:
                                s.kind === 'alias'
                                    ? monaco.languages.CompletionItemKind.Reference
                                    : monaco.languages.CompletionItemKind.Variable,
                            detail: positionDetail(s.cellIndex + 1),
                            insertText: `${s.label}}}`,
                            filterText: s.label,
                            sortText: String(i).padStart(4, '0'),
                            range,
                        })),
                    };
                },
            });
            editor.onDidDispose(() => provider.dispose());
        },
        [positionDetail],
    );

    return (
        <div>
            <CellSectionHeader
                label={t('editor.notebook.sectionQuery')}
                collapsed={!!collapsed}
                onToggle={onToggleCollapse}
                divider={false}
            />
            {!collapsed && (
                <div
                    className="relative"
                    style={{
                        height:
                            editorHeight + (settings.editorVimMode ? VIM_STATUS_LINE_HEIGHT : 0),
                    }}
                >
                    <SqlEditorWrapper
                        height="100%"
                        initialValue={content}
                        onChange={onContentChange}
                        onRun={onRun}
                        onMount={onMount}
                        editorKey={`notebook-${cellId}`}
                        options={{
                            padding: {top: 8, bottom: 8},
                            lineNumbers: 'off',
                            scrollbar: {alwaysConsumeMouseWheel: false},
                        }}
                    />
                    {settings.aiEnabled && (
                        <NotebookAiButtons
                            content={content}
                            onInsert={onContentChange}
                            connectionId={connectionId}
                            schema={schema}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
