import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {RunAllSummary} from '@/components/notebook/RunAllSummary';
import {addBlocked, addSkipped, addSuccess, createRunAllResult} from '@/utils/notebookRunAll';

describe('RunAllSummary', () => {
    it('counts blocked cells and links each to the disabled prerequisite', () => {
        let result = addSuccess(createRunAllResult());
        result = addSkipped(result, 1);
        result = addBlocked(result, 'use', 1, [{cellId: 'off', cellIndex: 0}]);
        const onScrollToCell = vi.fn();
        render(
            <RunAllSummary result={result} onDismiss={vi.fn()} onScrollToCell={onScrollToCell} />,
        );
        expect(screen.getByText(/1\s+editor\.notebook\.blocked/)).toBeInTheDocument();
        expect(screen.getByText('editor.notebook.blockedWaitsOn')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: 'Cell #2'}));
        expect(onScrollToCell).toHaveBeenLastCalledWith('use');
        fireEvent.click(screen.getByRole('button', {name: 'Cell #1'}));
        expect(onScrollToCell).toHaveBeenLastCalledWith('off');
    });

    it('shows no blocked part when nothing was blocked', () => {
        render(<RunAllSummary result={addSuccess(createRunAllResult())} onDismiss={vi.fn()} />);
        expect(screen.queryByText(/editor\.notebook\.blocked/)).not.toBeInTheDocument();
    });
});
