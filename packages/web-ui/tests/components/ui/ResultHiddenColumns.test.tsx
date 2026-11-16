import {describe, it, expect, vi, beforeEach} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {ResultEntryContent} from '@/components/ui/ResultEntryContent';
import {StackedResultItem} from '@/components/ui/StackedResultItem';
import {resetHiddenColumns} from '@/hooks/useHiddenColumns';
import type {QueryResult, QueryResultEntry} from '@/types/editor';

// The shared mock returns the bare key; these tests need the count it was given.
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: {count?: number}) =>
            options?.count === undefined ? key : `${key}:${options.count}`,
        i18n: {language: 'en', changeLanguage: vi.fn()},
    }),
    initReactI18next: {type: '3rdParty', init: vi.fn()},
}));

// Stands in for the grid's header menu: hides the second column.
vi.mock('@/components/ui/DataGrid', () => ({
    DataGrid: ({
        hiddenColumns,
        onHiddenColumnsChange,
    }: {
        hiddenColumns?: ReadonlySet<number>;
        onHiddenColumnsChange?: (hidden: ReadonlySet<number>) => void;
    }) => (
        <div data-testid="data-grid" data-hidden={[...(hiddenColumns ?? [])].join(',')}>
            <button type="button" onClick={() => onHiddenColumnsChange?.(new Set([1]))}>
                hide name
            </button>
        </div>
    ),
}));

const result: QueryResult = {
    columns: ['id', 'name', 'email'],
    rows: [[1, 'Ada', 'ada@example.com']],
    affected_rows: 0,
};

const entry: QueryResultEntry = {
    id: 'tab1-result-0',
    queryIndex: 0,
    query: 'SELECT * FROM users',
    result,
    error: '',
    executionTime: 12,
    isLoading: false,
    page: 1,
    activeTable: null,
    pkColumns: null,
};

const gridProps = {
    connectionId: 'c1',
    copyFormat: 'csv' as const,
    csvDelimiter: ',',
    csvIncludeHeaders: true,
    onPageChange: vi.fn(),
};

const chip = () => screen.queryByRole('button', {name: /columnVisibility\.hiddenLabel/});

describe('hidden columns in result panels (#1299)', () => {
    beforeEach(() => {
        resetHiddenColumns();
    });

    it('shows the count in a result status bar once the grid hides a column', () => {
        render(<ResultEntryContent {...gridProps} entry={entry} />);
        expect(chip()).toBeNull();

        fireEvent.click(screen.getByText('hide name'));
        expect(screen.getByTestId('data-grid')).toHaveAttribute('data-hidden', '1');
        expect(chip()).toHaveTextContent('dataGrid.columnVisibility.hiddenCount:1');
    });

    it('keeps the hidden columns when the result panel remounts', () => {
        const first = render(<ResultEntryContent {...gridProps} entry={entry} />);
        fireEvent.click(screen.getByText('hide name'));
        first.unmount();

        render(<ResultEntryContent {...gridProps} entry={{...entry, result: {...result}}} />);
        expect(screen.getByTestId('data-grid')).toHaveAttribute('data-hidden', '1');
    });

    it('shows the count in a stacked result header without collapsing it', () => {
        const onToggleCollapse = vi.fn();
        const props = {
            ...gridProps,
            entry,
            aiEnabled: false,
            aiRenaming: false,
            onToggleCollapse,
            onCopyAllRows: vi.fn(),
            onRename: vi.fn(),
            onRerun: vi.fn(),
            onAiRename: vi.fn(),
            onClose: vi.fn(),
        };
        const {rerender} = render(<StackedResultItem {...props} collapsed={false} />);

        fireEvent.click(screen.getByText('hide name'));
        expect(chip()).toHaveTextContent('dataGrid.columnVisibility.hiddenCount:1');

        fireEvent.click(chip()!);
        fireEvent.click(screen.getByText('email'));
        expect(onToggleCollapse).not.toHaveBeenCalled();

        rerender(<StackedResultItem {...props} collapsed />);
        expect(chip()).toBeNull();
    });
});
