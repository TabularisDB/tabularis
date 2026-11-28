import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {RunAllSummary} from '@/components/notebook/RunAllSummary';
import {createRunAllResult} from '@/utils/notebookRunAll';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: {number: number}) =>
            key === 'editor.notebook.execution.cell' ? `Cell #${opts?.number}` : key,
    }),
}));
vi.mock('lucide-react', () => vi.importActual('lucide-react'));

describe('RunAllSummary', () => {
    it('announces the counts and links a blocked consumer to its prerequisite', () => {
        const result = {
            ...createRunAllResult('affected', 3, 1),
            succeeded: 1,
            blocked: 1,
            blockedCells: [
                {
                    cellId: 'use',
                    cellIndex: 1,
                    prerequisite: {cellId: 'source', cellIndex: 0},
                },
            ],
        };
        const onScrollToCell = vi.fn();
        const onDismiss = vi.fn();
        const source = {id: 'source'};
        const consumer = {id: 'use'};
        const renderSummary = (cells: {id: string}[]) => (
            <RunAllSummary
                result={result}
                cells={cells}
                onDismiss={onDismiss}
                onScrollToCell={onScrollToCell}
            />
        );
        const view = render(renderSummary([source, consumer]));

        expect(screen.getByRole('status')).toHaveTextContent(/1\s+editor\.notebook\.blocked/);
        expect(screen.getByText('editor.notebook.execution.blockedBy')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Cell #2'}));
        expect(onScrollToCell).toHaveBeenLastCalledWith('use');
        fireEvent.click(screen.getByRole('button', {name: 'Cell #1'}));
        expect(onScrollToCell).toHaveBeenLastCalledWith('source');
        view.rerender(renderSummary([{id: 'other'}, consumer, source]));
        expect(screen.queryByRole('button', {name: 'Cell #1'})).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Cell #3'}));
        expect(onScrollToCell).toHaveBeenLastCalledWith('source');
        fireEvent.click(screen.getByRole('button', {name: 'common.dismiss'}));
        expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('announces preflight problems separately from database failures', () => {
        const result = {
            ...createRunAllResult('all', 2, 2),
            preflightErrors: ['Cell #2 references itself.'],
        };
        render(<RunAllSummary result={result} cells={[]} onDismiss={vi.fn()} />);
        expect(screen.getByRole('alert')).toHaveTextContent('Cell #2 references itself.');
        expect(screen.getByRole('status')).toHaveTextContent(
            'editor.notebook.execution.preflightFailed',
        );
        expect(screen.getByRole('status')).toHaveTextContent('2 editor.notebook.skipped');
        expect(screen.getByRole('status')).not.toHaveTextContent('editor.notebook.failed');
    });
});
