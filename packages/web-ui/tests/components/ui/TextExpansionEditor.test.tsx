import {describe, it, expect, vi} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import {TextExpansionEditor} from '@/components/ui/TextExpansionEditor';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: {count?: number}) =>
            options?.count !== undefined ? `${key}=${options.count}` : key,
    }),
}));

vi.mock('@/hooks/useContainerWidth', () => ({
    MIN_SIDE_BY_SIDE_WIDTH: 480,
    useContainerWidth: () => ({ref: {current: null}, width: 600}),
}));

vi.mock('@/components/ui/CellCodeEditor', () => ({
    CellCodeEditor: ({
        value,
        onChange,
        readOnly,
        wrapLines,
    }: {
        value: string;
        onChange: (next: string) => void;
        readOnly: boolean;
        wrapLines: boolean;
    }) => (
        <textarea
            data-testid="editor"
            data-wrap-lines={String(wrapLines)}
            value={value}
            readOnly={readOnly}
            onChange={(e) => onChange(e.target.value)}
        />
    ),
}));

vi.mock('@/components/ui/CellDiffEditor', () => ({
    CellDiffEditor: ({
        original,
        modified,
        onChange,
        readOnly,
        renderSideBySide,
        wrapLines,
    }: {
        original: string;
        modified: string;
        onChange?: (next: string) => void;
        readOnly: boolean;
        renderSideBySide: boolean;
        wrapLines: boolean;
    }) => (
        <textarea
            data-testid="diff-editor"
            data-original={original}
            data-side-by-side={String(renderSideBySide)}
            data-wrap-lines={String(wrapLines)}
            value={modified}
            readOnly={readOnly}
            onChange={(e) => onChange?.(e.target.value)}
        />
    ),
}));

const stats = () => screen.getByTestId('text-stats').textContent;

describe('TextExpansionEditor text statistics', () => {
    it('shows zero counts for empty text', () => {
        render(
            <TextExpansionEditor value="" readOnly={false} onSave={vi.fn()} onCancel={vi.fn()} />,
        );
        expect(stats()).toContain('textStats.characters=0');
        expect(stats()).toContain('textStats.lines=0');
        expect(stats()).toContain('textStats.bytes=0');
    });

    it('distinguishes code points from UTF-8 bytes', () => {
        render(<TextExpansionEditor value={'A😀'} readOnly onSave={vi.fn()} onCancel={vi.fn()} />);
        expect(stats()).toContain('textStats.characters=2');
        expect(stats()).toContain('textStats.lines=1');
        expect(stats()).toContain('textStats.bytes=5');
    });

    it('updates as the draft changes without saving', () => {
        const onSave = vi.fn();
        render(
            <TextExpansionEditor value="ab" readOnly={false} onSave={onSave} onCancel={vi.fn()} />,
        );
        fireEvent.change(screen.getByTestId('editor'), {target: {value: 'ab\ncd'}});
        expect(stats()).toContain('textStats.characters=5');
        expect(stats()).toContain('textStats.lines=2');
        expect(stats()).toContain('textStats.bytes=5');
        expect(onSave).not.toHaveBeenCalled();
    });

    it('starts with wrapping enabled and keeps an unchanged draft clean when toggled', () => {
        const onSave = vi.fn();
        render(
            <TextExpansionEditor
                value="unchanged text"
                readOnly={false}
                onSave={onSave}
                onCancel={vi.fn()}
            />,
        );

        const toggle = screen.getByRole('button', {name: 'textViewer.wrapLines'});
        const editor = screen.getByTestId('editor') as HTMLTextAreaElement;
        const initialStats = stats();

        expect(toggle.getAttribute('aria-pressed')).toBe('true');
        expect(editor.dataset.wrapLines).toBe('true');
        // These textarea values only show that the mocked editor node is reused after the toggle.
        editor.focus();
        editor.scrollTop = 18;
        editor.setSelectionRange(2, 5);

        fireEvent.click(toggle);

        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByTestId('editor')).toBe(editor);
        expect(editor.dataset.wrapLines).toBe('false');
        expect(editor.value).toBe('unchanged text');
        expect(editor.scrollTop).toBe(18);
        expect(editor.selectionStart).toBe(2);
        expect(editor.selectionEnd).toBe(5);
        expect(stats()).toBe(initialStats);
        expect(screen.getByRole('button', {name: 'textViewer.save'}).hasAttribute('disabled')).toBe(
            true,
        );
        expect(onSave).not.toHaveBeenCalled();
    });

    it('applies the same wrap choice to inline and side-by-side diffs and retains it when switching views', () => {
        render(
            <TextExpansionEditor
                value="current text"
                originalValue="original text"
                readOnly={false}
                onSave={vi.fn()}
                onCancel={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByRole('button', {name: 'textInput.diff'}));
        const diff = screen.getByTestId('diff-editor');
        expect(diff.dataset.wrapLines).toBe('true');
        expect(diff.dataset.sideBySide).toBe('false');
        expect(diff.dataset.original).toBe('original text');
        expect(diff).toHaveValue('current text');

        fireEvent.click(screen.getByRole('button', {name: 'textViewer.wrapLines'}));
        expect(diff.dataset.wrapLines).toBe('false');

        fireEvent.click(screen.getByRole('button', {name: 'textInput.sideBySide'}));
        expect(screen.getByTestId('diff-editor').dataset.sideBySide).toBe('true');
        expect(screen.getByTestId('diff-editor').dataset.wrapLines).toBe('false');

        fireEvent.click(screen.getByRole('button', {name: 'textInput.diff'}));
        expect(screen.getByTestId('editor').dataset.wrapLines).toBe('false');
        expect(screen.getByTestId('editor')).toHaveValue('current text');

        fireEvent.click(screen.getByRole('button', {name: 'textInput.diff'}));
        expect(screen.getByTestId('diff-editor').dataset.wrapLines).toBe('false');
        expect(screen.getByTestId('diff-editor').dataset.sideBySide).toBe('true');
        expect(screen.getByTestId('diff-editor').dataset.original).toBe('original text');
    });

    it('keeps wrapping toggleable in read-only normal and diff views', () => {
        render(
            <TextExpansionEditor
                value="current text"
                originalValue="original text"
                readOnly
                onSave={vi.fn()}
                onCancel={vi.fn()}
            />,
        );

        const toggle = screen.getByRole('button', {name: 'textViewer.wrapLines'});
        fireEvent.click(toggle);
        expect(screen.getByTestId('editor').dataset.wrapLines).toBe('false');
        expect(screen.getByTestId('editor')).toHaveAttribute('readonly');

        fireEvent.click(screen.getByRole('button', {name: 'textInput.diff'}));
        expect(screen.getByTestId('diff-editor').dataset.wrapLines).toBe('false');
        expect(screen.getByTestId('diff-editor')).toHaveAttribute('readonly');

        fireEvent.click(toggle);
        expect(screen.getByTestId('diff-editor').dataset.wrapLines).toBe('true');
    });

    it('preserves the draft, original value, dirty state, and statistics when toggled and saved', () => {
        const onSave = vi.fn();
        render(
            <TextExpansionEditor
                value="current text"
                originalValue="original text"
                readOnly={false}
                onSave={onSave}
                onCancel={vi.fn()}
            />,
        );

        fireEvent.change(screen.getByTestId('editor'), {
            target: {value: 'edited draft\nwith two lines'},
        });
        const changedStats = stats();
        expect(screen.getByRole('button', {name: 'textViewer.save'}).hasAttribute('disabled')).toBe(
            false,
        );

        fireEvent.click(screen.getByRole('button', {name: 'textViewer.wrapLines'}));
        expect(screen.getByTestId('editor')).toHaveValue('edited draft\nwith two lines');
        expect(stats()).toBe(changedStats);
        expect(screen.getByRole('button', {name: 'textViewer.save'}).hasAttribute('disabled')).toBe(
            false,
        );

        fireEvent.click(screen.getByRole('button', {name: 'textInput.diff'}));
        expect(screen.getByTestId('diff-editor').dataset.original).toBe('original text');
        expect(screen.getByTestId('diff-editor')).toHaveValue('edited draft\nwith two lines');

        fireEvent.click(screen.getByRole('button', {name: 'textInput.diff'}));
        expect(screen.getByTestId('editor')).toHaveValue('edited draft\nwith two lines');
        expect(stats()).toBe(changedStats);
        fireEvent.click(screen.getByRole('button', {name: 'textViewer.save'}));
        expect(onSave).toHaveBeenCalledWith('edited draft\nwith two lines');
    });
});
