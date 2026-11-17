import {fireEvent, render, screen, within} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {NotebookDependencies} from '@/components/notebook/NotebookDependencies';
import type {NotebookCell} from '@/types/notebook';

// Interpolate options so cell labels and diagnostics are distinguishable.
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) => {
            const short = key.replace('editor.notebook.dependencies.', '');
            if (short === 'namedCell') return `#${options?.position} ${options?.name}`;
            if (short === 'unnamedCell') return `SQL #${options?.position}`;
            return options ? `${short} ${JSON.stringify(options)}` : short;
        },
    }),
}));

function sql(id: string, content: string, extra: Partial<NotebookCell> = {}): NotebookCell {
    return {id, type: 'sql', content, ...extra};
}

const cells: NotebookCell[] = [
    sql('sales', 'SELECT * FROM orders', {name: 'Sales', isCollapsed: true}),
    sql('summary', 'SELECT * FROM {{cell_1}} WHERE d >= @start_date', {name: 'Revenue summary'}),
    sql('chart', 'SELECT * FROM {{cell_2}}', {name: 'Monthly chart'}),
];

function open(ui: React.ReactElement) {
    const result = render(ui);
    fireEvent.click(screen.getByRole('button', {name: /title/}));
    return result;
}

describe('NotebookDependencies', () => {
    it('renders nothing without SQL cells', () => {
        const {container} = render(
            <NotebookDependencies
                cells={[{id: 'm', type: 'markdown', content: '# Hi'}]}
                params={[]}
                onRevealCell={vi.fn()}
            />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('starts collapsed and toggles with an accessible button', () => {
        render(<NotebookDependencies cells={cells} params={[]} onRevealCell={vi.fn()} />);
        const toggle = screen.getByRole('button', {name: /title/});
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('combobox', {name: 'selectCell'})).toBeInTheDocument();
    });

    it('shows uses, parameters and used-by for the selected cell', () => {
        open(
            <NotebookDependencies
                cells={cells}
                params={[{name: 'start_date', value: '2026-01-01'}]}
                onRevealCell={vi.fn()}
            />,
        );
        fireEvent.change(screen.getByRole('combobox'), {target: {value: 'summary'}});

        const uses = screen.getByRole('region', {name: 'uses'});
        expect(within(uses).getByRole('button', {name: '#1 Sales'})).toBeInTheDocument();
        const params = screen.getByRole('region', {name: 'params'});
        expect(within(params).getByText('start_date')).toBeInTheDocument();
        expect(within(params).queryByText('undefinedParam')).not.toBeInTheDocument();
        const usedBy = screen.getByRole('region', {name: 'usedBy'});
        expect(within(usedBy).getByRole('button', {name: '#3 Monthly chart'})).toBeInTheDocument();
    });

    it('reveals a referenced cell without running it', () => {
        const onRevealCell = vi.fn();
        open(<NotebookDependencies cells={cells} params={[]} onRevealCell={onRevealCell} />);
        fireEvent.change(screen.getByRole('combobox'), {target: {value: 'summary'}});
        fireEvent.click(screen.getByRole('button', {name: '#1 Sales'}));
        expect(onRevealCell).toHaveBeenCalledWith('sales');
    });

    it('shows an empty state for an isolated cell', () => {
        open(
            <NotebookDependencies
                cells={[sql('a', 'SELECT 1')]}
                params={[]}
                onRevealCell={vi.fn()}
            />,
        );
        expect(screen.getByText('empty')).toBeInTheDocument();
        expect(screen.queryByRole('region')).not.toBeInTheDocument();
    });

    it('distinguishes missing targets, undefined parameters and cycles', () => {
        open(
            <NotebookDependencies
                cells={[
                    sql('a', 'SELECT * FROM {{cell_2}}, {{cell_7}} WHERE x = @missing'),
                    sql('b', 'SELECT * FROM {{cell_1}}'),
                ]}
                params={[]}
                onRevealCell={vi.fn()}
            />,
        );
        expect(screen.getByText('missingTarget {"position":7}')).toBeInTheDocument();
        expect(screen.getByText('undefinedParam')).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('SQL #1 → SQL #2 → SQL #1');
    });

    it('falls back to the first SQL cell when the selected cell is deleted', () => {
        const {rerender} = open(
            <NotebookDependencies cells={cells} params={[]} onRevealCell={vi.fn()} />,
        );
        fireEvent.change(screen.getByRole('combobox'), {target: {value: 'chart'}});
        expect(screen.getByRole('combobox')).toHaveValue('chart');
        rerender(
            <NotebookDependencies cells={cells.slice(0, 2)} params={[]} onRevealCell={vi.fn()} />,
        );
        expect(screen.getByRole('combobox')).toHaveValue('sales');
    });
});
