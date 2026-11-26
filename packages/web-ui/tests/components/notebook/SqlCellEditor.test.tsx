import {act, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {SqlCellEditor} from '@/components/notebook/SqlCellEditor';
import {SettingsContext, DEFAULT_SETTINGS} from '@/contexts/SettingsContext';
import type {OnMount} from '@monaco-editor/react';

let mount: OnMount;
vi.mock('@/components/ui/SqlEditorWrapper', () => ({
    SqlEditorWrapper: ({onMount}: {onMount: OnMount}) => {
        mount = onMount;
        return <div data-testid="cell-editor" />;
    },
}));

const props = {
    cellId: 'height-regression',
    content: 'SELECT 1;\nSELECT 2;',
    onContentChange: vi.fn(),
    onRun: vi.fn(),
    connectionId: 'sqlite-fixture',
    onToggleCollapse: vi.fn(),
};

function cell(vim: boolean) {
    return (
        <SettingsContext.Provider
            value={{
                settings: {...DEFAULT_SETTINGS, aiEnabled: false, editorVimMode: vim},
                updateSetting: vi.fn(),
                isLoading: false,
            }}
        >
            <SqlCellEditor {...props} />
        </SettingsContext.Provider>
    );
}

describe('SqlCellEditor height', () => {
    it('reserves room for Vim without taking height from the SQL content, including on toggle', () => {
        const {rerender} = render(cell(false));
        let resize = () => {};
        let contentHeight = 200;
        act(() =>
            mount(
                {
                    getContentHeight: () => contentHeight,
                    onDidContentSizeChange: (listener: () => void) => {
                        resize = listener;
                    },
                } as unknown as Parameters<OnMount>[0],
                {} as Parameters<OnMount>[1],
            ),
        );
        const container = screen.getByTestId('cell-editor').parentElement!;
        expect(container.style.height).toBe('200px');
        rerender(cell(true));
        expect(container.style.height).toBe('224px');
        act(() => {
            contentHeight = 320;
            resize();
        });
        expect(container.style.height).toBe('344px');
        rerender(cell(false));
        expect(container.style.height).toBe('320px');
    });

    it('preserves the minimum editor height for an empty cell', () => {
        render(cell(true));
        act(() =>
            mount(
                {
                    getContentHeight: () => 20,
                    onDidContentSizeChange: vi.fn(),
                } as unknown as Parameters<OnMount>[0],
                {} as Parameters<OnMount>[1],
            ),
        );
        expect(screen.getByTestId('cell-editor').parentElement!.style.height).toBe('84px');
    });
});

describe('SqlCellEditor reference completion', () => {
    interface Provider {
        triggerCharacters: string[];
        provideCompletionItems: (
            model: unknown,
            position: {lineNumber: number; column: number},
        ) => {suggestions: Array<Record<string, unknown>>};
    }

    function mountWith(getReferenceSuggestions?: () => Array<Record<string, unknown>>) {
        render(
            <SettingsContext.Provider
                value={{
                    settings: {...DEFAULT_SETTINGS, aiEnabled: false},
                    updateSetting: vi.fn(),
                    isLoading: false,
                }}
            >
                <SqlCellEditor
                    {...props}
                    getReferenceSuggestions={
                        getReferenceSuggestions as Parameters<
                            typeof SqlCellEditor
                        >[0]['getReferenceSuggestions']
                    }
                />
            </SettingsContext.Provider>,
        );
        let provider: Provider | undefined;
        let disposeListener = () => {};
        const dispose = vi.fn();
        let line = '';
        const model = {getLineContent: () => line};
        act(() =>
            mount(
                {
                    getContentHeight: () => 60,
                    onDidContentSizeChange: vi.fn(),
                    getModel: () => model,
                    onDidDispose: (listener: () => void) => {
                        disposeListener = listener;
                    },
                } as unknown as Parameters<OnMount>[0],
                {
                    languages: {
                        registerCompletionItemProvider: (_language: string, p: Provider) => {
                            provider = p;
                            return {dispose};
                        },
                        CompletionItemKind: {Reference: 1, Variable: 2},
                    },
                } as unknown as Parameters<OnMount>[1],
            ),
        );
        const complete = (text: string, column: number, target: unknown = model) => {
            line = text;
            return provider!.provideCompletionItems(target, {lineNumber: 3, column}).suggestions;
        };
        return {provider: provider!, complete, dispose, disposeEditor: () => disposeListener()};
    }

    const suggestions = [
        {label: 'sales', cellIndex: 0, kind: 'alias'},
        {label: 'cell_1', cellIndex: 0, kind: 'position'},
    ];

    it('completes {{ to aliases first, replacing a closing }} already there', () => {
        const {provider, complete} = mountWith(() => suggestions);
        expect(provider.triggerCharacters).toEqual(['{']);
        // Cursor after `FROM {{` (1-based column 8), Monaco auto-closed the braces.
        const items = complete('FROM {{}}', 8);
        expect(items.map((i) => [i.label, i.insertText, i.kind])).toEqual([
            ['sales', 'sales}}', 1],
            ['cell_1', 'cell_1}}', 2],
        ]);
        expect(items[0].range).toEqual({
            startLineNumber: 3,
            endLineNumber: 3,
            startColumn: 8,
            endColumn: 10,
        });
        expect(items[0].detail).toBe('editor.notebook.alias.completionDetail');
    });

    it('offers nothing outside a reference, in another editor or without targets', () => {
        const {complete} = mountWith(() => suggestions);
        expect(complete('SELECT sa', 10)).toEqual([]);
        expect(complete('FROM {{', 8, {getLineContent: () => 'FROM {{'})).toEqual([]);
        const empty = mountWith(() => []);
        expect(empty.complete('FROM {{', 8)).toEqual([]);
    });

    it('removes its provider with the editor', () => {
        const {dispose, disposeEditor} = mountWith(() => suggestions);
        disposeEditor();
        expect(dispose).toHaveBeenCalled();
    });
});
