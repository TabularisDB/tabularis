import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {NotebookOutline} from '@/components/notebook/NotebookOutline';
import type {NotebookCell} from '@/types/notebook';
import type {QueryResult} from '@/types/editor';

vi.mock('@/hooks/useTabularisClient', () => import('../../support/tauriBackedHooks'));
vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({settings: {aiEnabled: false}}),
}));

function makeQueryResult(overrides: Partial<QueryResult> = {}): QueryResult {
    return {
        columns: [],
        rows: [],
        affected_rows: 0,
        ...overrides,
    };
}

function makeCell(overrides: Partial<NotebookCell> = {}): NotebookCell {
    return {
        id: 'cell-1',
        type: 'sql',
        content: 'SELECT 1',
        ...overrides,
    };
}

describe('NotebookOutline', () => {
    it('renders outline entries and allows filtering by query', () => {
        const onScrollToCell = vi.fn();
        const cells: NotebookCell[] = [
            makeCell({id: 'c1', type: 'markdown', content: '# Setup'}),
            makeCell({id: 'c2', type: 'sql', content: 'SELECT 1', name: 'Revenue Query'}),
            makeCell({id: 'c3', type: 'sql', content: 'SELECT 2', name: 'User Metrics'}),
        ];

        render(<NotebookOutline cells={cells} onScrollToCell={onScrollToCell} />);

        expect(screen.getByText('Setup')).toBeInTheDocument();
        expect(screen.getByText('Revenue Query')).toBeInTheDocument();
        expect(screen.getByText('User Metrics')).toBeInTheDocument();

        const input = screen.getByPlaceholderText('editor.notebook.filterOutline');
        fireEvent.change(input, {target: {value: 'revenue'}});

        expect(screen.getByText('Revenue Query')).toBeInTheDocument();
        expect(screen.queryByText('Setup')).not.toBeInTheDocument();
        expect(screen.queryByText('User Metrics')).not.toBeInTheDocument();
    });

    it('updates matches dynamically when cell names or headings change (#1513)', () => {
        const onScrollToCell = vi.fn();
        const initialCells: NotebookCell[] = [
            makeCell({id: 'c1', type: 'markdown', content: '# Initial Heading'}),
            makeCell({id: 'c2', type: 'sql', content: 'SELECT 1', name: 'Initial Name'}),
        ];

        const {rerender} = render(
            <NotebookOutline cells={initialCells} onScrollToCell={onScrollToCell} />,
        );

        const input = screen.getByPlaceholderText('editor.notebook.filterOutline');
        fireEvent.change(input, {target: {value: 'updated'}});

        expect(screen.getByText('editor.notebook.noOutlineMatches')).toBeInTheDocument();

        // Update cell name and heading while outline and filter are active
        const updatedCells: NotebookCell[] = [
            makeCell({id: 'c1', type: 'markdown', content: '# Updated Heading'}),
            makeCell({id: 'c2', type: 'sql', content: 'SELECT 1', name: 'Updated Name'}),
        ];

        rerender(<NotebookOutline cells={updatedCells} onScrollToCell={onScrollToCell} />);

        expect(screen.queryByText('editor.notebook.noOutlineMatches')).not.toBeInTheDocument();
        expect(screen.getByText('Updated Heading')).toBeInTheDocument();
        expect(screen.getByText('Updated Name')).toBeInTheDocument();
    });

    it('restores full list and refocuses input when clear button is clicked (#1513, #1519)', () => {
        const onScrollToCell = vi.fn();
        const cells: NotebookCell[] = [
            makeCell({id: 'c1', type: 'markdown', content: '# Heading 1'}),
            makeCell({id: 'c2', type: 'sql', content: 'SELECT 1', name: 'SQL Query'}),
        ];

        render(<NotebookOutline cells={cells} onScrollToCell={onScrollToCell} />);

        const input = screen.getByPlaceholderText('editor.notebook.filterOutline');
        fireEvent.change(input, {target: {value: 'heading'}});

        const clearBtn = screen.getByLabelText('editor.notebook.clearOutlineFilter');
        expect(clearBtn).toHaveClass('focus-visible:outline');

        fireEvent.click(clearBtn);

        expect(input).toHaveValue('');
        expect(document.activeElement).toBe(input);
        expect(screen.getByText('Heading 1')).toBeInTheDocument();
        expect(screen.getByText('SQL Query')).toBeInTheDocument();
    });

    it('stops event propagation on Escape key when clearing non-empty filter (#1519)', () => {
        const onScrollToCell = vi.fn();
        const parentListener = vi.fn();
        const cells: NotebookCell[] = [makeCell({id: 'c1', type: 'sql', content: 'SELECT 1'})];

        render(
            <div onKeyDown={parentListener}>
                <NotebookOutline cells={cells} onScrollToCell={onScrollToCell} />
            </div>,
        );

        const input = screen.getByPlaceholderText('editor.notebook.filterOutline');
        fireEvent.change(input, {target: {value: 'test'}});

        fireEvent.keyDown(input, {key: 'Escape'});

        expect(parentListener).not.toHaveBeenCalled();
        expect(input).toHaveValue('');
    });

    it('renders execution status and updates dynamically while outline is visible (#1514, #1520)', () => {
        const onScrollToCell = vi.fn();
        const cells: NotebookCell[] = [
            makeCell({
                id: 'c1',
                type: 'sql',
                content: 'SELECT 1',
                name: 'Query 1',
                isLoading: true,
            }),
            makeCell({
                id: 'c2',
                type: 'sql',
                content: 'SELECT 2',
                name: 'Query 2',
                error: 'Syntax error',
            }),
            makeCell({
                id: 'c3',
                type: 'sql',
                content: 'SELECT 3',
                name: 'Query 3',
                result: makeQueryResult(),
            }),
        ];

        const {rerender} = render(
            <NotebookOutline cells={cells} onScrollToCell={onScrollToCell} />,
        );

        // Verify indicators by aria-label and role="img"
        const runningIndicator = screen.getByRole('img', {name: 'editor.notebook.statusRunning'});
        expect(runningIndicator).toHaveClass('text-muted');

        const failedIndicator = screen.getByRole('img', {name: 'editor.notebook.statusFailed'});
        expect(failedIndicator).toHaveClass('text-accent-error');

        const outputIndicator = screen.getByRole('img', {
            name: 'editor.notebook.statusOutputAvailable',
        });
        expect(outputIndicator).toHaveClass('text-muted');

        // Dynamically transition c1 from running to has_output and clear c3's output
        const updatedCells: NotebookCell[] = [
            makeCell({
                id: 'c1',
                type: 'sql',
                content: 'SELECT 1',
                name: 'Query 1',
                isLoading: false,
                result: makeQueryResult({columns: ['col'], rows: [['val']]}),
            }),
            makeCell({
                id: 'c2',
                type: 'sql',
                content: 'SELECT 2',
                name: 'Query 2',
                error: 'Syntax error',
            }),
            makeCell({
                id: 'c3',
                type: 'sql',
                content: 'SELECT 3',
                name: 'Query 3',
                result: null,
            }),
        ];

        rerender(<NotebookOutline cells={updatedCells} onScrollToCell={onScrollToCell} />);

        // c1 now has output, running is gone
        expect(
            screen.queryByRole('img', {name: 'editor.notebook.statusRunning'}),
        ).not.toBeInTheDocument();
        const outputIndicators = screen.getAllByRole('img', {
            name: 'editor.notebook.statusOutputAvailable',
        });
        expect(outputIndicators).toHaveLength(1);
    });
});
