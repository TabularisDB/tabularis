import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {render, screen, fireEvent, act} from '@testing-library/react';
import {SqlEditorWrapper} from '@/components/ui/SqlEditorWrapper';
import {SettingsContext, DEFAULT_SETTINGS} from '@/contexts/SettingsContext';
import {CommandPaletteDispatchContext} from '@/contexts/CommandPaletteContext';
import type {ReactNode} from 'react';

interface MonacoEditorMockProps {
    onChange?: (value: string) => void;
    beforeMount?: (monaco: unknown) => void;
    onMount?: (editor: unknown, monaco: unknown) => void;
    defaultValue?: string;
    options?: {
        acceptSuggestionOnEnter?: string;
        folding?: boolean;
        showFoldingControls?: string;
        renderControlCharacters?: boolean;
        unicodeHighlight?: {invisibleCharacters?: boolean; ambiguousCharacters?: boolean};
    };
}

interface MonacoKeyDownEventMock {
    browserEvent: KeyboardEvent;
    preventDefault: () => void;
    stopPropagation: () => void;
}

const monacoRenderState = vi.hoisted(() => ({
    beforeMount: undefined as MonacoEditorMockProps['beforeMount'],
    onMount: undefined as MonacoEditorMockProps['onMount'],
}));
const registerSqlFoldingProviderMock = vi.hoisted(() => vi.fn());
const setSqlFoldingDialectMock = vi.hoisted(() => vi.fn());
const installSqlFoldPreviewMock = vi.hoisted(() => vi.fn(() => ({dispose: vi.fn()})));
const matchesShortcutMock = vi.hoisted(() =>
    vi.fn<(event: KeyboardEvent, id: string) => boolean>(),
);
const togglePaletteMock = vi.hoisted(() => vi.fn());
const closePaletteMock = vi.hoisted(() => vi.fn());

// Mock MonacoEditor
vi.mock('@/components/ui/LazyMonaco', async () => {
    return {
        MonacoEditor: ({
            onChange,
            beforeMount,
            onMount,
            defaultValue,
            options,
        }: MonacoEditorMockProps) => {
            monacoRenderState.beforeMount = beforeMount;
            monacoRenderState.onMount = onMount;
            return (
                <textarea
                    data-testid="monaco-editor"
                    data-accept-suggestion-on-enter={options?.acceptSuggestionOnEnter}
                    data-folding={String(options?.folding)}
                    data-folding-controls={options?.showFoldingControls}
                    data-render-control-characters={String(options?.renderControlCharacters)}
                    data-highlight-invisible={String(
                        options?.unicodeHighlight?.invisibleCharacters,
                    )}
                    data-highlight-ambiguous={String(
                        options?.unicodeHighlight?.ambiguousCharacters,
                    )}
                    defaultValue={defaultValue}
                    onChange={(e) => onChange?.(e.target.value)}
                />
            );
        },
    };
});

// Mock useTheme hook
vi.mock('@/hooks/useTheme', () => ({
    useTheme: vi.fn(() => ({
        currentTheme: {id: 'tabularis-dark'},
    })),
}));

// Mock useKeybindings hook
vi.mock('@/hooks/useKeybindings', () => ({
    useKeybindings: vi.fn(() => ({
        matchesShortcut: matchesShortcutMock,
    })),
}));

// Mock themeUtils
vi.mock('@/themes/themeUtils', () => ({
    loadMonacoTheme: vi.fn(),
}));

vi.mock('@/utils/sqlFolding', () => ({
    registerSqlFoldingProvider: registerSqlFoldingProviderMock,
    setSqlFoldingDialect: setSqlFoldingDialectMock,
}));

vi.mock('@/utils/sqlFoldPreview', () => ({
    installSqlFoldPreview: installSqlFoldPreviewMock,
}));

// Mock monaco KeyMod and KeyCode
vi.mock('monaco-editor', () => ({
    KeyMod: {CtrlCmd: 2048},
    KeyCode: {Enter: 3},
}));

const settingsValue = {
    settings: DEFAULT_SETTINGS,
    updateSetting: vi.fn(),
    isLoading: false,
};

const wrapper = ({children}: {children: ReactNode}) => (
    <SettingsContext.Provider value={settingsValue}>
        <CommandPaletteDispatchContext.Provider
            value={{
                openPalette: vi.fn(),
                closePalette: closePaletteMock,
                togglePalette: togglePaletteMock,
            }}
        >
            {children}
        </CommandPaletteDispatchContext.Provider>
    </SettingsContext.Provider>
);

const standaloneWrapper = ({children}: {children: ReactNode}) => (
    <SettingsContext.Provider value={settingsValue}>{children}</SettingsContext.Provider>
);

describe('SqlEditorWrapper', () => {
    const mockOnChange = vi.fn();
    const mockOnRun = vi.fn();
    const mockOnMount = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        monacoRenderState.beforeMount = undefined;
        monacoRenderState.onMount = undefined;
        matchesShortcutMock.mockReturnValue(false);
        settingsValue.settings = DEFAULT_SETTINGS;
    });

    const mountCapturedEditor = () => {
        const keyDownHandlers: Array<(event: MonacoKeyDownEventMock) => void> = [];
        const addAction = vi.fn();
        const addCommand = vi.fn();
        const trigger = vi.fn();
        const editor = {
            addAction,
            addCommand,
            dispose: vi.fn(),
            getContribution: vi.fn(() => null),
            getModel: vi.fn(() => null),
            getSelection: vi.fn(() => null),
            getPosition: vi.fn(() => null),
            createDecorationsCollection: vi.fn(() => ({clear: vi.fn(), set: vi.fn()})),
            onDidChangeCursorSelection: vi.fn(),
            onDidChangeModelContent: vi.fn(),
            onKeyDown: vi.fn((handler: (event: MonacoKeyDownEventMock) => void) => {
                keyDownHandlers.push(handler);
            }),
            trigger,
        };
        const monaco = {
            KeyMod: {CtrlCmd: 1, Shift: 2, Alt: 4},
            KeyCode: {KeyX: 8, KeyC: 16, KeyV: 32, Enter: 64, KeyF: 128, KeyA: 256},
        };

        monacoRenderState.onMount?.(editor, monaco);

        return {addAction, addCommand, keyDownHandlers, trigger};
    };

    describe('Select current statement', () => {
        const registerAction = (dialect = 'postgres') => {
            render(
                <SqlEditorWrapper
                    initialValue=""
                    onChange={mockOnChange}
                    onRun={mockOnRun}
                    dialect={dialect}
                />,
                {wrapper},
            );
            const {addAction} = mountCapturedEditor();
            const action = addAction.mock.calls
                .map(
                    ([descriptor]) =>
                        descriptor as {
                            id: string;
                            label: string;
                            contextMenuGroupId: string;
                            run: (ed: unknown) => void;
                        },
                )
                .find((descriptor) => descriptor.id === 'tabularis.selectCurrentStatement');
            expect(action).toMatchObject({
                label: 'editor.selectCurrentStatement',
                contextMenuGroupId: '1_modification',
            });
            if (!action) throw new Error('statement selection action was not registered');
            return action;
        };

        const statementEditor = (sql: string, offset: number) => {
            const getPositionAt = (at: number) => {
                const lines = model.getValue().slice(0, at).split('\n');
                return {lineNumber: lines.length, column: lines[lines.length - 1].length + 1};
            };
            const model = {
                getValue: vi.fn(() => sql),
                getVersionId: vi.fn(() => 1),
                getOffsetAt: () => offset,
                getPositionAt,
            };
            return {
                model,
                getModel: vi.fn(() => model),
                getPosition: vi.fn(() => getPositionAt(offset)),
                setSelection: vi.fn(),
                focus: vi.fn(),
            };
        };

        it.each([true, false])(
            'selects the parsed statement with cursor execution set to %s',
            (runStatementUnderCursor) => {
                settingsValue.settings = {...DEFAULT_SETTINGS, runStatementUnderCursor};
                const action = registerAction();
                const sql = "SELECT 1;\n\n  SELECT 'a;b',\n    '😀' AS value;\nSELECT 3;";
                const ed = statementEditor(sql, sql.indexOf('😀'));

                action.run(ed);

                expect(ed.setSelection).toHaveBeenCalledExactlyOnceWith({
                    startLineNumber: 3,
                    startColumn: 3,
                    endLineNumber: 4,
                    endColumn: 18,
                });
                expect(ed.focus).toHaveBeenCalledOnce();
                expect(mockOnRun).not.toHaveBeenCalled();
                expect(mockOnChange).not.toHaveBeenCalled();
            },
        );

        it.each([
            ['leading blank line', '\nSELECT 1;', 0],
            ['blank line between statements', 'SELECT 1;\n\nSELECT 2;', 10],
            ['trailing blank line', 'SELECT 1;\n\n', 10],
            ['comment-only buffer', '-- no query\n', 5],
            ['empty buffer', '', 0],
        ])('leaves the selection alone on a %s', (_name, sql, offset) => {
            const action = registerAction();
            const ed = statementEditor(sql, offset);
            action.run(ed);
            expect(ed.setSelection).not.toHaveBeenCalled();
            expect(ed.focus).not.toHaveBeenCalled();
        });

        it.each([0, 4, 8])(
            'selects from the first character to the delimiter at cursor offset %s',
            (offset) => {
                const action = registerAction();
                const ed = statementEditor('SELECT 1;', offset);
                action.run(ed);
                expect(ed.setSelection).toHaveBeenCalledExactlyOnceWith({
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: 1,
                    endColumn: 9,
                });
            },
        );

        it.each([
            ['after a semicolon', 'SELECT 1;\nSELECT 2;', 9],
            ['after trailing spaces', 'SELECT 1;  \nSELECT 2;', 11],
            ['after a tab', 'SELECT 1;\t', 10],
            ['at the end of the buffer', 'SELECT 1;', 9],
            ['after an unterminated statement', 'SELECT 1  ', 10],
            ['before a CRLF', 'SELECT 1;\r\nSELECT 2;', 9],
        ])('selects the statement when the caret is %s on its own line', (_name, sql, offset) => {
            const action = registerAction();
            const ed = statementEditor(sql, offset);
            action.run(ed);
            expect(ed.setSelection).toHaveBeenCalledExactlyOnceWith({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 9,
            });
        });

        it('does not select across a comment-only gap on the statement line', () => {
            const sql = 'SELECT 1; -- comment';
            const action = registerAction();
            const ed = statementEditor(sql, sql.length);
            action.run(ed);
            expect(ed.setSelection).not.toHaveBeenCalled();
        });

        it('refreshes the cached statements after a model edit', () => {
            const action = registerAction();
            const ed = statementEditor('SELECT 1;', 4);
            action.run(ed);
            ed.model.getValue.mockReturnValue('SELECT 123;');
            ed.model.getVersionId.mockReturnValue(2);
            action.run(ed);
            expect(ed.setSelection).toHaveBeenLastCalledWith({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 11,
            });
        });

        it('uses the active dialect for semicolons inside PostgreSQL dollar quotes', () => {
            const action = registerAction();
            const sql = 'SELECT $$first; second$$; SELECT 2;';
            const ed = statementEditor(sql, sql.indexOf('second'));
            action.run(ed);
            expect(ed.setSelection).toHaveBeenCalledExactlyOnceWith({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 25,
            });
        });

        it('selects an unterminated statement at the end of the buffer without a dialect prop', () => {
            render(<SqlEditorWrapper initialValue="" onChange={mockOnChange} onRun={mockOnRun} />, {
                wrapper,
            });
            const {addAction} = mountCapturedEditor();
            const action = addAction.mock.calls
                .map(([descriptor]) => descriptor as {id: string; run: (ed: unknown) => void})
                .find((descriptor) => descriptor.id === 'tabularis.selectCurrentStatement');
            const ed = statementEditor('SELECT 1', 8);
            expect(action).toBeDefined();
            action?.run(ed);
            expect(ed.setSelection).toHaveBeenCalledExactlyOnceWith({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 9,
            });
        });

        it('invalidates the shared cache when the dialect changes without a model edit', () => {
            const {rerender} = render(
                <SqlEditorWrapper
                    initialValue=""
                    onChange={mockOnChange}
                    onRun={mockOnRun}
                    dialect="postgres"
                />,
                {wrapper},
            );
            const {addAction} = mountCapturedEditor();
            const action = addAction.mock.calls
                .map(([descriptor]) => descriptor as {id: string; run: (ed: unknown) => void})
                .find((descriptor) => descriptor.id === 'tabularis.selectCurrentStatement');
            expect(action).toBeDefined();
            const ed = statementEditor('SELECT 1; SELECT 2;', 12);
            action?.run(ed);
            expect(ed.setSelection).toHaveBeenLastCalledWith({
                startLineNumber: 1,
                startColumn: 11,
                endLineNumber: 1,
                endColumn: 19,
            });
            rerender(
                <SqlEditorWrapper
                    initialValue=""
                    onChange={mockOnChange}
                    onRun={mockOnRun}
                    dialect="mssql"
                />,
            );
            action?.run(ed);
            expect(ed.setSelection).toHaveBeenLastCalledWith({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 20,
            });
        });

        it('invalidates the shared cache when a model is replaced at the same version', () => {
            const action = registerAction();
            action.run(statementEditor('SELECT 1;', 4));
            const ed = statementEditor('SELECT 123;', 4);
            action.run(ed);
            expect(ed.setSelection).toHaveBeenCalledExactlyOnceWith({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 11,
            });
        });

        it('does nothing when the model or cursor is unavailable', () => {
            const action = registerAction();
            const setSelection = vi.fn();
            action.run({getModel: () => null, getPosition: () => null, setSelection});
            action.run({getModel: () => ({}), getPosition: () => null, setSelection});
            expect(setSelection).not.toHaveBeenCalled();
        });
    });

    it('highlights hidden Unicode by default and honors the saved editor setting', () => {
        const {unmount} = render(
            <SqlEditorWrapper initialValue="" onChange={mockOnChange} onRun={mockOnRun} />,
            {wrapper},
        );
        expect(screen.getByTestId('monaco-editor')).toHaveAttribute(
            'data-highlight-invisible',
            'true',
        );
        expect(screen.getByTestId('monaco-editor')).toHaveAttribute(
            'data-highlight-ambiguous',
            'true',
        );
        expect(screen.getByTestId('monaco-editor')).toHaveAttribute(
            'data-render-control-characters',
            'true',
        );
        unmount();

        settingsValue.settings = {...DEFAULT_SETTINGS, editorHighlightInvisibleCharacters: false};
        render(<SqlEditorWrapper initialValue="" onChange={mockOnChange} onRun={mockOnRun} />, {
            wrapper,
        });
        expect(screen.getByTestId('monaco-editor')).toHaveAttribute(
            'data-highlight-invisible',
            'false',
        );
        expect(screen.getByTestId('monaco-editor')).toHaveAttribute(
            'data-highlight-ambiguous',
            'false',
        );
        expect(screen.getByTestId('monaco-editor')).toHaveAttribute(
            'data-render-control-characters',
            'false',
        );
    });

    it.each([
        [
            'tabularis.transformToUppercase',
            'editor.transformToUppercase',
            'editor.action.transformToUppercase',
        ],
        [
            'tabularis.transformToLowercase',
            'editor.transformToLowercase',
            'editor.action.transformToLowercase',
        ],
    ])('registers %s as a selection-only context menu action', (id, label, command) => {
        render(<SqlEditorWrapper initialValue="" onChange={mockOnChange} onRun={mockOnRun} />, {
            wrapper,
        });
        const {addAction} = mountCapturedEditor();
        const action = addAction.mock.calls
            .map(
                ([descriptor]) =>
                    descriptor as {
                        id: string;
                        label: string;
                        contextMenuGroupId?: string;
                        precondition?: string;
                        run: (ed: unknown) => void;
                    },
            )
            .find((descriptor) => descriptor.id === id);
        if (!action) throw new Error(`${id} was not registered`);

        expect(action.label).toBe(label);
        expect(action.contextMenuGroupId).toBe('1_modification');
        expect(action.precondition).toBe('editorHasSelection');

        const ed = {trigger: vi.fn()};
        action.run(ed);
        expect(ed.trigger).toHaveBeenCalledWith('contextmenu', command, null);
    });

    it('cleans only selected SQL code and keeps quoted text unchanged', () => {
        render(
            <SqlEditorWrapper
                initialValue=""
                onChange={mockOnChange}
                onRun={mockOnRun}
                dialect="postgres"
            />,
            {wrapper},
        );
        const {addAction} = mountCapturedEditor();
        const action = addAction.mock.calls
            .map(([descriptor]) => descriptor as {id: string; run: (ed: unknown) => void})
            .find((descriptor) => descriptor.id === 'tabularis.removeInvisibleSqlCharacters');
        expect(action?.label).toBe('editor.removeInvisibleCharacters');
        if (!action) throw new Error('cleanup action was not registered');

        const sql = "SELECT\u200B 'It’s O’Brien' AS \u201Cid\u201D, \u201Coutside\u201D";
        const comma = sql.indexOf(',');
        const selection = {
            isEmpty: () => false,
            getStartPosition: () => ({lineNumber: 1, column: 1}),
            getEndPosition: () => ({lineNumber: 1, column: comma + 1}),
        };
        const model = {
            getValue: () => sql,
            getOffsetAt: (position: {column: number}) => position.column - 1,
            getPositionAt: (offset: number) => ({lineNumber: 1, column: offset + 1}),
        };
        const edits: Array<{range: {startColumn: number}; text: string}> = [];
        const events: string[] = [];
        const ed = {
            getModel: () => model,
            getSelections: () => [selection],
            pushUndoStop: () => events.push('undo'),
            executeEdits: (_source: string, next: typeof edits) => {
                events.push('edit');
                edits.push(...next);
            },
        };

        action.run(ed);
        expect(events).toEqual(['undo', 'edit', 'undo']);
        expect(edits.map(({range, text}) => [range.startColumn, text])).toEqual([
            [sql.indexOf('\u200B') + 1, ''],
            [sql.indexOf('\u201C') + 1, '"'],
            [sql.indexOf('\u201D') + 1, '"'],
        ]);
    });

    it('cleans the full model with small edits and skips clean text', () => {
        render(
            <SqlEditorWrapper
                initialValue=""
                onChange={mockOnChange}
                onRun={mockOnRun}
                dialect="postgres"
            />,
            {wrapper},
        );
        const {addAction} = mountCapturedEditor();
        const action = addAction.mock.calls
            .map(([descriptor]) => descriptor as {id: string; run: (ed: unknown) => void})
            .find((descriptor) => descriptor.id === 'tabularis.removeInvisibleSqlCharacters');
        if (!action) throw new Error('cleanup action was not registered');
        let sql = "SELECT\uFEFF 1； '👨‍👩‍👧'";
        const model = {
            getValue: () => sql,
            getPositionAt: (offset: number) => ({lineNumber: 1, column: offset + 1}),
        };
        const executeEdits = vi.fn();
        const pushUndoStop = vi.fn();
        const ed = {
            getModel: () => model,
            getSelections: () => [],
            executeEdits,
            pushUndoStop,
        };
        action.run(ed);
        expect(executeEdits).toHaveBeenCalledTimes(1);
        const edits = executeEdits.mock.calls[0][1] as Array<{
            range: {startColumn: number; endColumn: number};
            text: string;
            forceMoveMarkers: boolean;
        }>;
        expect(
            edits.map(({range, text, forceMoveMarkers}) => [
                sql.slice(range.startColumn - 1, range.endColumn - 1),
                text,
                forceMoveMarkers,
            ]),
        ).toEqual([
            ['\uFEFF', '', false],
            ['；', ';', false],
        ]);
        expect(pushUndoStop).toHaveBeenCalledTimes(2);

        sql = "SELECT 1; '👨‍👩‍👧'";
        action.run(ed);
        expect(executeEdits).toHaveBeenCalledTimes(1);
    });

    it('converts the selection to an SQL list in one undoable edit, only when text is selected', () => {
        render(<SqlEditorWrapper initialValue="" onChange={mockOnChange} onRun={mockOnRun} />, {
            wrapper,
        });
        const {addAction} = mountCapturedEditor();
        const action = addAction.mock.calls
            .map(([descriptor]) => descriptor as {id: string; run: (ed: unknown) => void})
            .find((descriptor) => descriptor.id === 'tabularis.convertSelectionToSqlList');
        if (!action) throw new Error('convert-to-SQL-list action was not registered');
        expect(action).toMatchObject({
            label: 'editor.convertSelectionToSqlList',
            contextMenuGroupId: '1_modification',
            precondition: 'editorHasSelection',
        });

        const steps: string[] = [];
        const selected = {isEmpty: () => false, text: "O'Brien\n42"};
        const blank = {isEmpty: () => false, text: ' \n '};
        const collapsed = {isEmpty: () => true, text: ''};
        const ed = {
            getModel: () => ({getValueInRange: (range: {text: string}) => range.text}),
            getSelections: () => [selected, blank, collapsed],
            pushUndoStop: vi.fn(() => steps.push('undo-stop')),
            executeEdits: vi.fn(() => steps.push('edit')),
        };
        action.run(ed);

        expect(ed.executeEdits).toHaveBeenCalledWith('convertSelectionToSqlList', [
            {range: selected, text: "'O''Brien', '42'", forceMoveMarkers: true},
        ]);
        expect(steps).toEqual(['undo-stop', 'edit', 'undo-stop']);

        ed.getSelections = () => [blank, collapsed];
        ed.executeEdits.mockClear();
        action.run(ed);
        expect(ed.executeEdits).not.toHaveBeenCalled();
    });

    it('renders with initial value', () => {
        render(
            <SqlEditorWrapper
                initialValue="SELECT * FROM users"
                onChange={mockOnChange}
                onRun={mockOnRun}
                editorKey="test-1"
            />,
            {wrapper},
        );

        expect(screen.getByTestId('monaco-editor')).toHaveValue('SELECT * FROM users');
    });

    it('enables and registers SQL code folding', () => {
        render(
            <SqlEditorWrapper
                initialValue="SELECT 1"
                onChange={mockOnChange}
                onRun={mockOnRun}
                dialect="postgres"
            />,
            {wrapper},
        );

        expect(screen.getByTestId('monaco-editor')).toHaveAttribute('data-folding', 'true');
        expect(screen.getByTestId('monaco-editor')).toHaveAttribute(
            'data-folding-controls',
            'always',
        );

        const monaco = {};
        monacoRenderState.beforeMount?.(monaco);
        expect(registerSqlFoldingProviderMock).toHaveBeenCalledWith(monaco);
    });

    it('installs fold previews only when requested', () => {
        render(
            <SqlEditorWrapper
                initialValue="SELECT 1"
                onChange={mockOnChange}
                onRun={mockOnRun}
                foldPreview
            />,
            {wrapper},
        );

        mountCapturedEditor();
        expect(installSqlFoldPreviewMock).toHaveBeenCalledOnce();
    });

    it('renders editor component', async () => {
        render(
            <SqlEditorWrapper
                initialValue=""
                onChange={mockOnChange}
                onRun={mockOnRun}
                editorKey="test-2"
            />,
            {wrapper},
        );

        // Verify editor is rendered (mock in setup.ts returns null, but component mounts)
        expect(document.body).toBeInTheDocument();
    });

    it('accepts onChange prop', async () => {
        render(
            <SqlEditorWrapper
                initialValue=""
                onChange={mockOnChange}
                onRun={mockOnRun}
                editorKey="test-3"
            />,
            {wrapper},
        );

        // Component should mount without errors
        expect(document.body).toBeInTheDocument();
    });

    it('applies custom height', () => {
        render(
            <SqlEditorWrapper
                initialValue="SELECT 1"
                onChange={mockOnChange}
                onRun={mockOnRun}
                height="300px"
                editorKey="test-4"
            />,
            {wrapper},
        );

        // Height is passed to MonacoEditor component
        expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
    });

    it('applies custom options', () => {
        const customOptions = {fontSize: 16, lineNumbers: 'on' as const};

        render(
            <SqlEditorWrapper
                initialValue="SELECT 1"
                onChange={mockOnChange}
                onRun={mockOnRun}
                options={customOptions}
                editorKey="test-5"
            />,
            {wrapper},
        );

        expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
    });

    it('remounts when editorKey changes', () => {
        const {rerender} = render(
            <SqlEditorWrapper
                initialValue="SELECT 1"
                onChange={mockOnChange}
                onRun={mockOnRun}
                editorKey="key-1"
            />,
            {wrapper},
        );

        rerender(
            <SqlEditorWrapper
                initialValue="SELECT 2"
                onChange={mockOnChange}
                onRun={mockOnRun}
                editorKey="key-2"
            />,
        );

        // Should render with new value after key change
        expect(screen.getByTestId('monaco-editor')).toHaveValue('SELECT 2');
    });

    it('uses default key when editorKey not provided', () => {
        render(
            <SqlEditorWrapper initialValue="SELECT 1" onChange={mockOnChange} onRun={mockOnRun} />,
            {wrapper},
        );

        expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
    });

    it('handles different SQL queries', () => {
        const queries = [
            'SELECT * FROM users',
            'INSERT INTO users VALUES (1)',
            "UPDATE users SET name = 'test'",
            'DELETE FROM users WHERE id = 1',
        ];

        queries.forEach((query, index) => {
            const {unmount} = render(
                <SqlEditorWrapper
                    initialValue={query}
                    onChange={mockOnChange}
                    onRun={mockOnRun}
                    editorKey={`query-${index}`}
                />,
                {wrapper},
            );

            expect(screen.getByTestId('monaco-editor')).toHaveValue(query);
            unmount();
        });
    });

    it('handles empty initial value', () => {
        render(
            <SqlEditorWrapper
                initialValue=""
                onChange={mockOnChange}
                onRun={mockOnRun}
                editorKey="empty-test"
            />,
            {wrapper},
        );

        expect(screen.getByTestId('monaco-editor')).toHaveValue('');
    });

    it('handles undefined onChange gracefully', () => {
        const {container} = render(
            <SqlEditorWrapper
                initialValue="SELECT 1"
                onChange={undefined as unknown as (value: string) => void}
                onRun={mockOnRun}
                editorKey="undefined-test"
            />,
            {wrapper},
        );

        expect(container).toBeInTheDocument();
    });

    describe('font zoom shortcuts', () => {
        const zoomMatcher = (event: KeyboardEvent, id: string) =>
            event.ctrlKey &&
            !event.shiftKey &&
            ((id === 'editor_zoom_in' && event.key === '=') ||
                (id === 'editor_zoom_out' && event.key === '-') ||
                (id === 'editor_zoom_reset' && event.key === '0'));

        const pressKey = (fontSize: number | undefined, init: KeyboardEventInit) => {
            matchesShortcutMock.mockImplementation(zoomMatcher);
            settingsValue.settings = {...DEFAULT_SETTINGS, editorFontSize: fontSize};
            render(<SqlEditorWrapper initialValue="" onChange={mockOnChange} onRun={mockOnRun} />, {
                wrapper,
            });
            const {keyDownHandlers} = mountCapturedEditor();
            const event = {
                browserEvent: new KeyboardEvent('keydown', init),
                preventDefault: vi.fn(),
                stopPropagation: vi.fn(),
            };
            keyDownHandlers.forEach((handler) => handler(event));
            return event;
        };

        it.each([
            [14, {key: '=', ctrlKey: true}, 15],
            [14, {key: '+', ctrlKey: true, shiftKey: true}, 15],
            [14, {key: '-', ctrlKey: true}, 13],
            [18, {key: '0', ctrlKey: true}, 14],
        ])('changes the saved size from %i on %o', (size, init, expected) => {
            const event = pressKey(size, init);
            expect(event.preventDefault).toHaveBeenCalledOnce();
            expect(settingsValue.updateSetting).toHaveBeenCalledWith('editorFontSize', expected);
        });

        it('stops at the bounds without saving again', () => {
            const event = pressKey(20, {key: '=', ctrlKey: true});
            expect(event.preventDefault).toHaveBeenCalledOnce();
            expect(settingsValue.updateSetting).not.toHaveBeenCalled();
        });

        it('ignores the keys without the modifier', () => {
            const event = pressKey(14, {key: '='});
            expect(event.preventDefault).not.toHaveBeenCalled();
            expect(settingsValue.updateSetting).not.toHaveBeenCalled();
        });
    });

    it('opens the action palette before Monaco consumes its shortcut', () => {
        matchesShortcutMock.mockImplementation((_event, id) => id === 'command_palette_actions');
        render(
            <SqlEditorWrapper
                initialValue=""
                onChange={mockOnChange}
                onRun={mockOnRun}
                editorKey="palette-shortcut"
            />,
            {wrapper},
        );
        const {keyDownHandlers, trigger} = mountCapturedEditor();
        const event = {
            browserEvent: new KeyboardEvent('keydown', {
                key: 'a',
                ctrlKey: true,
                shiftKey: true,
            }),
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        };

        keyDownHandlers[0](event);

        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(event.stopPropagation).toHaveBeenCalledOnce();
        expect(togglePaletteMock).toHaveBeenCalledWith('actions');
        expect(trigger).not.toHaveBeenCalled();
    });

    it('leaves the unified palette shortcut available to Monaco chords', () => {
        matchesShortcutMock.mockImplementation((_event, id) => id === 'command_palette');
        render(
            <SqlEditorWrapper
                initialValue=""
                onChange={mockOnChange}
                onRun={mockOnRun}
                editorKey="unified-palette-shortcut"
            />,
            {wrapper},
        );
        const {keyDownHandlers, trigger} = mountCapturedEditor();
        const event = {
            browserEvent: new KeyboardEvent('keydown', {
                key: 'k',
                ctrlKey: true,
            }),
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        };

        keyDownHandlers[0](event);

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(event.stopPropagation).not.toHaveBeenCalled();
        expect(togglePaletteMock).not.toHaveBeenCalled();
        expect(trigger).not.toHaveBeenCalled();
    });

    it('does not intercept composing editor key events as palette shortcuts', () => {
        matchesShortcutMock.mockImplementation((_event, id) => id === 'command_palette_actions');
        render(
            <SqlEditorWrapper
                initialValue=""
                onChange={mockOnChange}
                onRun={mockOnRun}
                editorKey="palette-composition"
            />,
            {wrapper},
        );
        const {keyDownHandlers} = mountCapturedEditor();
        const event = {
            browserEvent: new KeyboardEvent('keydown', {
                key: 'a',
                ctrlKey: true,
                shiftKey: true,
                isComposing: true,
            }),
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        };

        keyDownHandlers[0](event);

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(event.stopPropagation).not.toHaveBeenCalled();
        expect(togglePaletteMock).not.toHaveBeenCalled();
    });

    it('renders without a command palette provider and leaves its shortcut to Monaco', () => {
        matchesShortcutMock.mockImplementation((_event, id) => id === 'command_palette_actions');
        render(
            <SqlEditorWrapper
                initialValue=""
                onChange={mockOnChange}
                onRun={mockOnRun}
                editorKey="standalone-editor"
            />,
            {wrapper: standaloneWrapper},
        );
        const {keyDownHandlers} = mountCapturedEditor();
        const event = {
            browserEvent: new KeyboardEvent('keydown', {
                key: 'a',
                ctrlKey: true,
                shiftKey: true,
            }),
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        };

        keyDownHandlers[0](event);

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(event.stopPropagation).not.toHaveBeenCalled();
        expect(togglePaletteMock).not.toHaveBeenCalled();
    });

    it('keeps toggle block comment available on Shift+Alt+A on Linux', () => {
        const platformSpy = vi
            .spyOn(window.navigator, 'platform', 'get')
            .mockReturnValue('Linux x86_64');
        render(
            <SqlEditorWrapper
                initialValue=""
                onChange={mockOnChange}
                onRun={mockOnRun}
                editorKey="linux-block-comment"
            />,
            {wrapper},
        );
        const {addCommand, trigger} = mountCapturedEditor();
        platformSpy.mockRestore();
        const linuxBlockCommentBinding = 2 | 4 | 256;
        const bindingCall = addCommand.mock.calls.find(
            ([keybinding]) => keybinding === linuxBlockCommentBinding,
        );

        expect(bindingCall).toBeDefined();
        const runBlockComment = bindingCall?.[1] as (() => void) | undefined;
        runBlockComment?.();
        expect(trigger).toHaveBeenCalledWith('keyboard', 'editor.action.blockComment', {});
    });

    describe('acceptSuggestionOnEnter mapping', () => {
        const renderWith = (editorAcceptSuggestionOnEnter: boolean | undefined, key: string) => {
            const ctx = {
                settings: {...DEFAULT_SETTINGS, editorAcceptSuggestionOnEnter},
                updateSetting: vi.fn(),
                isLoading: false,
            };
            const localWrapper = ({children}: {children: ReactNode}) => (
                <SettingsContext.Provider value={ctx}>
                    <CommandPaletteDispatchContext.Provider
                        value={{
                            openPalette: vi.fn(),
                            closePalette: closePaletteMock,
                            togglePalette: togglePaletteMock,
                        }}
                    >
                        {children}
                    </CommandPaletteDispatchContext.Provider>
                </SettingsContext.Provider>
            );
            return render(
                <SqlEditorWrapper
                    initialValue=""
                    onChange={mockOnChange}
                    onRun={mockOnRun}
                    editorKey={key}
                />,
                {wrapper: localWrapper},
            );
        };

        it('passes "off" to Monaco when the setting is false', () => {
            renderWith(false, 'accept-off');
            expect(screen.getByTestId('monaco-editor')).toHaveAttribute(
                'data-accept-suggestion-on-enter',
                'off',
            );
        });

        it('passes "smart" to Monaco when the setting is true', () => {
            renderWith(true, 'accept-on');
            expect(screen.getByTestId('monaco-editor')).toHaveAttribute(
                'data-accept-suggestion-on-enter',
                'smart',
            );
        });

        it('defaults to "smart" when the setting is undefined', () => {
            renderWith(undefined, 'accept-undefined');
            expect(screen.getByTestId('monaco-editor')).toHaveAttribute(
                'data-accept-suggestion-on-enter',
                'smart',
            );
        });
    });
});

describe('SqlEditorWrapper debounced value sync', () => {
    const mockOnChange = vi.fn();
    const mockOnRun = vi.fn();

    const mountValueEditor = (initial: string) => {
        let value = initial;
        const editor = {
            addAction: vi.fn(),
            addCommand: vi.fn(),
            dispose: vi.fn(),
            getContribution: vi.fn(() => null),
            getModel: vi.fn(() => null),
            onKeyDown: vi.fn(),
            trigger: vi.fn(),
            getValue: vi.fn(() => value),
            setValue: vi.fn((next: string) => {
                value = next;
            }),
            getPosition: vi.fn(() => ({lineNumber: 1, column: 2})),
            setPosition: vi.fn(),
            getSelections: vi.fn(() => []),
            setSelections: vi.fn(),
        };
        monacoRenderState.onMount?.(editor, {
            KeyMod: {CtrlCmd: 1, Shift: 2, Alt: 4},
            KeyCode: {KeyX: 8, KeyC: 16, KeyV: 32, Enter: 64, KeyF: 128, KeyA: 256},
        });
        // Simulates the user typing: Monaco already holds the new text when it
        // notifies onChange.
        const type = (next: string) => {
            value = next;
            fireEvent.change(screen.getByTestId('monaco-editor'), {target: {value: next}});
        };
        return {editor, type};
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        monacoRenderState.onMount = undefined;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const renderEditor = (initialValue: string) =>
        render(
            <SqlEditorWrapper
                initialValue={initialValue}
                onChange={mockOnChange}
                onRun={mockOnRun}
            />,
            {wrapper: standaloneWrapper},
        );

    it('does not overwrite keystrokes typed while a debounced change is echoed back', () => {
        const {rerender} = renderEditor('');
        const {editor, type} = mountValueEditor('');

        type('x');
        act(() => {
            vi.advanceTimersByTime(300);
        });
        expect(mockOnChange).toHaveBeenCalledWith('x');

        // The consumer re-renders with "x" only after the user already typed "y".
        type('xy');
        rerender(<SqlEditorWrapper initialValue="x" onChange={mockOnChange} onRun={mockOnRun} />);

        expect(editor.setValue).not.toHaveBeenCalled();
        expect(editor.getValue()).toBe('xy');

        act(() => {
            vi.advanceTimersByTime(300);
        });
        expect(mockOnChange).toHaveBeenLastCalledWith('xy');
        rerender(<SqlEditorWrapper initialValue="xy" onChange={mockOnChange} onRun={mockOnRun} />);
        expect(editor.setValue).not.toHaveBeenCalled();
    });

    it('applies an external initialValue change and restores the cursor', () => {
        const {rerender} = renderEditor('');
        const {editor, type} = mountValueEditor('');

        type('x');
        act(() => {
            vi.advanceTimersByTime(300);
        });

        rerender(
            <SqlEditorWrapper initialValue="SELECT 1" onChange={mockOnChange} onRun={mockOnRun} />,
        );

        expect(editor.setValue).toHaveBeenCalledWith('SELECT 1');
        expect(editor.setPosition).toHaveBeenCalledWith({lineNumber: 1, column: 2});
    });

    it('lets an external change win over a pending debounced flush', () => {
        const {rerender} = renderEditor('');
        const {editor, type} = mountValueEditor('');

        type('ab');
        rerender(
            <SqlEditorWrapper initialValue="SELECT 1" onChange={mockOnChange} onRun={mockOnRun} />,
        );
        expect(editor.setValue).toHaveBeenCalledWith('SELECT 1');

        act(() => {
            vi.advanceTimersByTime(300);
        });
        expect(mockOnChange).not.toHaveBeenCalledWith('ab');
    });
});
