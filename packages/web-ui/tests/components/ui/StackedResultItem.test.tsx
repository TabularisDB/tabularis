import {describe, it, expect, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import {StackedResultItem} from '@/components/ui/StackedResultItem';
import type {QueryResultEntry} from '@/types/editor';

vi.mock('@/components/ui/DataGrid', () => ({
    DataGrid: () => <div data-testid="data-grid" />,
}));

const entry: QueryResultEntry = {
    id: 'tab1-result-0',
    queryIndex: 0,
    query: 'SELECT id FROM items',
    result: {
        columns: ['id'],
        rows: [[1], [2], [3], [4], [5]],
        affected_rows: 0,
    },
    error: '',
    executionTime: 12,
    isLoading: false,
    page: 1,
    activeTable: null,
    pkColumns: null,
};

const props = {
    entry,
    connectionId: 'c1',
    copyFormat: 'csv' as const,
    csvDelimiter: ',',
    csvIncludeHeaders: true,
    collapsed: false,
    aiEnabled: false,
    aiRenaming: false,
    onToggleCollapse: vi.fn(),
    onPageChange: vi.fn(),
    onCopyAllRows: vi.fn(),
    onRename: vi.fn(),
    onRerun: vi.fn(),
    onAiRename: vi.fn(),
    onClose: vi.fn(),
};

// The box around the stacked grid, and the box inside the nested result content.
const gridBoxHeights = () => {
    const heights: string[] = [];
    let box = screen.getByTestId('data-grid').parentElement;
    while (box) {
        if (box.style.height) heights.push(box.style.height);
        box = box.parentElement;
    }
    return heights;
};

describe('StackedResultItem row density (#339)', () => {
    it('sizes the stacked grid for 35 px rows by default', () => {
        render(<StackedResultItem {...props} />);

        // header (35) + 5 rows (35)
        expect(gridBoxHeights()).toEqual(['210px', '210px']);
    });

    it('sizes the stacked grid and the nested result box for compact rows', () => {
        render(<StackedResultItem {...props} rowHeight={25} />);

        // header (35) + 5 compact rows (25)
        expect(gridBoxHeights()).toEqual(['160px', '160px']);
    });
});
