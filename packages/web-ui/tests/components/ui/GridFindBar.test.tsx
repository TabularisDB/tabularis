import {createRef, type ComponentProps} from 'react';
import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {GridFindBar} from '@/components/ui/GridFindBar';
import {KeybindingsContext} from '@/contexts/KeybindingsContext';

vi.mock('lucide-react', async (importOriginal) => await importOriginal());
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) => {
            const templates: Record<string, string> = {
                'dataGrid.find.label': 'Find in results',
                'dataGrid.find.position': '{{current}} of {{total}}',
                'dataGrid.find.announcement': 'Match {{current}} of {{total}}',
                'dataGrid.find.noResults': 'No results',
                'dataGrid.find.matchCase': 'Match case',
                'dataGrid.find.previous': 'Previous match',
                'dataGrid.find.next': 'Next match',
                'dataGrid.find.close': 'Close find',
                'dataGrid.find.loadedRowsOnly': 'Loaded rows only ({{loaded}})',
                'dataGrid.find.loadedRowsOfTotal': 'Loaded rows only ({{loaded}} of {{total}})',
            };
            let result = templates[key] ?? key;
            for (const [name, value] of Object.entries(options ?? {})) {
                result = result.replaceAll(`{{${name}}}`, String(value));
            }
            return result;
        },
        i18n: {language: 'en', changeLanguage: vi.fn()},
    }),
}));

type BarProps = ComponentProps<typeof GridFindBar>;

function renderBar(overrides: Partial<BarProps> = {}) {
    const props: BarProps = {
        inputRef: createRef<HTMLInputElement>(),
        query: 'refund',
        caseSensitive: false,
        matchCount: 17,
        currentIndex: 2,
        hasUnloadedRows: false,
        loadedRowCount: 500,
        totalRowCount: null,
        onQueryChange: vi.fn(),
        onToggleCaseSensitive: vi.fn(),
        onNext: vi.fn(),
        onPrevious: vi.fn(),
        onClose: vi.fn(),
        ...overrides,
    };
    const view = render(
        <KeybindingsContext.Provider
            value={{
                shortcuts: [],
                matchesShortcut: (event, id) =>
                    id === 'find_in_grid' && event.ctrlKey && event.key.toLowerCase() === 'f',
                saveOverride: async () => {},
                resetOverride: async () => {},
                overrides: {},
                isMac: false,
            }}
        >
            <GridFindBar {...props} />
        </KeybindingsContext.Provider>,
    );
    const input = screen.getByRole('searchbox', {name: 'Find in results'});
    return {props, input, ...view};
}

describe('GridFindBar', () => {
    it('opens with the query selected in a labelled search field', () => {
        const {input} = renderBar();
        expect(screen.getByRole('search', {name: 'Find in results'})).toBeInTheDocument();
        expect(input).toHaveFocus();
        expect(input).toHaveValue('refund');
        expect((input as HTMLInputElement).selectionStart).toBe(0);
        expect((input as HTMLInputElement).selectionEnd).toBe(6);
    });

    it('shows and announces the position of the current match', () => {
        renderBar();
        expect(screen.getByText('3 of 17')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Match 3 of 17');
    });

    it('formats large counts', () => {
        renderBar({matchCount: 12345, currentIndex: 999});
        const position = `${(1000).toLocaleString()} of ${(12345).toLocaleString()}`;
        expect(screen.getByText(position)).toBeInTheDocument();
    });

    it('reports a query without matches', () => {
        renderBar({matchCount: 0, currentIndex: -1});
        expect(screen.getByText('No results', {selector: '[aria-hidden="true"]'})).toHaveClass(
            'text-accent-error',
        );
        expect(screen.getByRole('status')).toHaveTextContent('No results');
        expect(screen.getByRole('button', {name: 'Previous match'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Next match'})).toBeDisabled();
    });

    it('stays quiet while the query is empty', () => {
        renderBar({query: '', matchCount: 0, currentIndex: -1});
        expect(screen.queryByText('No results')).not.toBeInTheDocument();
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('reports every change of the query', () => {
        const {input, props} = renderBar();
        fireEvent.change(input, {target: {value: 'refunded'}});
        expect(props.onQueryChange).toHaveBeenCalledWith('refunded');
    });

    it('moves with Enter and Shift+Enter', () => {
        const {input, props} = renderBar();
        fireEvent.keyDown(input, {key: 'Enter'});
        expect(props.onNext).toHaveBeenCalledTimes(1);
        fireEvent.keyDown(input, {key: 'Enter', shiftKey: true});
        expect(props.onPrevious).toHaveBeenCalledTimes(1);
    });

    it('ignores Enter while an input method is composing', () => {
        const {input, props} = renderBar();
        fireEvent.keyDown(input, {key: 'Enter', isComposing: true});
        expect(props.onNext).not.toHaveBeenCalled();
    });

    it('moves with the arrow buttons without taking focus from the field', () => {
        const {input, props} = renderBar();
        const next = screen.getByRole('button', {name: 'Next match'});
        const previous = screen.getByRole('button', {name: 'Previous match'});
        expect(fireEvent.mouseDown(next)).toBe(false);
        fireEvent.click(next);
        fireEvent.click(previous);
        expect(props.onNext).toHaveBeenCalledTimes(1);
        expect(props.onPrevious).toHaveBeenCalledTimes(1);
        expect(input).toHaveFocus();
    });

    it('closes with Escape from the field and from the buttons', () => {
        const {input, props} = renderBar();
        fireEvent.keyDown(input, {key: 'Escape'});
        fireEvent.keyDown(screen.getByRole('button', {name: 'Next match'}), {key: 'Escape'});
        expect(props.onClose).toHaveBeenCalledTimes(2);
    });

    it('closes with the close button', () => {
        const {props} = renderBar();
        fireEvent.click(screen.getByRole('button', {name: 'Close find'}));
        expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it('selects the query again on the find shortcut', () => {
        const {input} = renderBar();
        (input as HTMLInputElement).setSelectionRange(6, 6);
        expect(fireEvent.keyDown(input, {key: 'f', ctrlKey: true})).toBe(false);
        expect((input as HTMLInputElement).selectionStart).toBe(0);
        expect((input as HTMLInputElement).selectionEnd).toBe(6);
    });

    it('toggles case sensitivity and exposes its state', () => {
        const {props, rerender} = renderBar();
        const toggle = screen.getByRole('button', {name: 'Match case'});
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(toggle);
        expect(props.onToggleCaseSensitive).toHaveBeenCalledTimes(1);

        rerender(<GridFindBar {...props} caseSensitive />);
        expect(screen.getByRole('button', {name: 'Match case'})).toHaveAttribute(
            'aria-pressed',
            'true',
        );
    });

    it('says when only the loaded rows are searched', () => {
        const {input} = renderBar({hasUnloadedRows: true, totalRowCount: 12340});
        const scope = `Loaded rows only (500 of ${(12340).toLocaleString()})`;
        expect(screen.getByText(scope)).toBeInTheDocument();
        expect(input).toHaveAccessibleDescription(scope);
    });

    it('says so without a known total too', () => {
        renderBar({hasUnloadedRows: true});
        expect(screen.getByText('Loaded rows only (500)')).toBeInTheDocument();
    });

    it('does not mention loaded rows when the whole result is loaded', () => {
        const {input} = renderBar();
        expect(screen.queryByText(/Loaded rows only/)).not.toBeInTheDocument();
        expect(input).not.toHaveAttribute('aria-describedby');
    });
});
