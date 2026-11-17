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
