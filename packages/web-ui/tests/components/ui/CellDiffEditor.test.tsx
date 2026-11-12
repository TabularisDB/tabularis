import {beforeEach, describe, expect, it, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import {CellDiffEditor} from '@/components/ui/CellDiffEditor';
import type {Theme} from '@/types/theme';

interface MonacoDiffMockProps {
    modified?: string;
    options?: Record<string, unknown>;
}

const lastProps: {current: MonacoDiffMockProps | null} = {current: null};

vi.mock('@/components/ui/LazyMonaco', () => ({
    MonacoDiffEditor: (props: MonacoDiffMockProps) => {
        lastProps.current = props;
        return (
            <textarea
                data-testid="monaco-diff-editor"
                value={props.modified ?? ''}
                onChange={() => undefined}
            />
        );
    },
}));

vi.mock('@/themes/themeUtils', () => ({
    loadMonacoTheme: vi.fn(),
}));

const mockEditorTheme: {current: Theme} = {
    current: {id: 'tabularis-dark'} as unknown as Theme,
};

vi.mock('@/hooks/useEditorTheme', () => ({
    useEditorTheme: () => mockEditorTheme.current,
}));

describe('CellDiffEditor', () => {
    beforeEach(() => {
        lastProps.current = null;
        vi.clearAllMocks();
    });

    it.each(['json', 'sql'] as const)(
        'keeps wrapping enabled by default for %s diffs without a wrap prop',
        (language) => {
            render(
                <CellDiffEditor
                    original="before"
                    modified="after"
                    language={language}
                    readOnly
                    renderSideBySide={language === 'sql'}
                />,
            );

            expect(lastProps.current?.options).toMatchObject({
                wordWrap: 'on',
                diffWordWrap: 'on',
            });
        },
    );

    it.each([false, true])(
        'updates both diff wrapping options without remounting the mocked editor (side-by-side: %s)',
        (renderSideBySide) => {
            const props = {
                original: 'original content',
                modified: 'modified content',
                language: 'json' as const,
                renderSideBySide,
            };
            const {rerender} = render(<CellDiffEditor {...props} />);
            const editor = screen.getByTestId('monaco-diff-editor') as HTMLTextAreaElement;

            expect(lastProps.current?.options).toMatchObject({
                wordWrap: 'on',
                diffWordWrap: 'on',
            });
            // These textarea values only show that the mocked editor node is reused after rerender.
            editor.focus();
            editor.scrollTop = 16;
            editor.setSelectionRange(1, 6);

            rerender(<CellDiffEditor {...props} wrapLines={false} />);

            expect(lastProps.current?.options).toMatchObject({
                wordWrap: 'off',
                diffWordWrap: 'off',
            });
            expect(screen.getByTestId('monaco-diff-editor')).toBe(editor);
            expect(editor.scrollTop).toBe(16);
            expect(editor.selectionStart).toBe(1);
            expect(editor.selectionEnd).toBe(6);
            expect(editor).toHaveValue('modified content');
        },
    );
});
