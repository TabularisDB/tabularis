import type {ComponentProps} from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {SqlCellResult} from '@/components/notebook/SqlCellResult';
import type {QueryResult} from '@/types/editor';

vi.mock('react-i18next', () => {
    const t = (key: string, options?: Record<string, unknown>) =>
        options ? `${key} ${JSON.stringify(options)}` : key;
    return {useTranslation: () => ({t, i18n: {language: 'en-US'}})};
});
vi.mock('@/components/ui/DataGrid', () => ({
    DataGrid: () => <div data-testid="data-grid" />,
}));
vi.mock('@/components/ui/ErrorDisplay', () => ({
    ErrorDisplay: ({error}: {error: string}) => <div data-testid="error">{error}</div>,
}));
vi.mock('@/components/notebook/CellChart', () => ({
    CellChart: () => <div data-testid="chart" />,
}));
vi.mock('@/components/notebook/ResultToolbar', () => ({
    ResultToolbar: () => null,
}));

const oneRow: QueryResult = {columns: ['active_users'], rows: [[1240]], affected_rows: 0};

function makeProps(
    overrides: Partial<ComponentProps<typeof SqlCellResult>> = {},
): ComponentProps<typeof SqlCellResult> {
    return {
        result: oneRow,
        onToggleResultCollapse: vi.fn(),
        onToggleChartVisible: vi.fn(),
        onKpiConfigChange: vi.fn(),
        onToggleKpiVisible: vi.fn(),
        ...overrides,
    };
}

describe('SqlCellResult KPI', () => {
    it('shows the configured value as a large number next to the table', () => {
        render(
            <SqlCellResult
                {...makeProps({kpiConfig: {column: 'active_users', label: 'Active users'}})}
            />,
        );
        expect(screen.getByTestId('data-grid')).toBeInTheDocument();
        const card = screen.getByRole('region', {name: 'Active users'});
        expect(card).toHaveTextContent('1,240');
    });

    it('creates a default configuration when the KPI is first opened', () => {
        const props = makeProps();
        render(<SqlCellResult {...props} />);
        fireEvent.click(screen.getByText('editor.notebook.sectionKpi'));
        expect(props.onKpiConfigChange).toHaveBeenCalledWith({
            column: 'active_users',
            label: 'active_users',
        });
        expect(props.onToggleKpiVisible).toHaveBeenCalledWith(true);
    });

    it('updates only the configuration when settings change', () => {
        const props = makeProps({kpiConfig: {column: 'active_users'}});
        const {rerender} = render(<SqlCellResult {...props} />);
        fireEvent.change(screen.getByLabelText('editor.notebook.kpiDecimals'), {
            target: {value: '2'},
        });
        expect(props.onKpiConfigChange).toHaveBeenLastCalledWith({
            column: 'active_users',
            decimals: 2,
        });
        rerender(<SqlCellResult {...props} kpiConfig={{column: 'active_users', decimals: 2}} />);
        fireEvent.change(screen.getByLabelText('editor.notebook.kpiDecimals'), {
            target: {value: ''},
        });
        expect(props.onKpiConfigChange).toHaveBeenLastCalledWith({
            column: 'active_users',
            decimals: null,
        });
        fireEvent.change(screen.getByLabelText('editor.notebook.kpiPrefix'), {
            target: {value: '$'},
        });
        expect(props.onKpiConfigChange).toHaveBeenLastCalledWith({
            column: 'active_users',
            decimals: 2,
            prefix: '$',
        });
    });

    it('explains a multi-row result instead of showing its first row', () => {
        render(
            <SqlCellResult
                {...makeProps({
                    result: {columns: ['n'], rows: [[1], [2]], affected_rows: 0},
                    kpiConfig: {column: 'n'},
                })}
            />,
        );
        expect(screen.getByRole('status')).toHaveTextContent(
            'editor.notebook.kpiState.multipleRows {"count":2}',
        );
        expect(screen.getByRole('region', {name: 'n'})).not.toHaveTextContent(/^n1$/);
    });

    it('keeps a missing column selectable and explains it', () => {
        render(<SqlCellResult {...makeProps({kpiConfig: {column: 'gone', label: 'Gone'}})} />);
        expect(screen.getByLabelText('editor.notebook.kpiColumn')).toHaveValue('gone');
        expect(screen.getByRole('status')).toHaveTextContent(
            'editor.notebook.kpiState.missingColumn',
        );
    });

    it('shows the error state under the query error', () => {
        render(
            <SqlCellResult
                {...makeProps({result: null, error: 'syntax error', kpiConfig: {column: 'n'}})}
            />,
        );
        expect(screen.getByTestId('error')).toHaveTextContent('syntax error');
        expect(screen.getByRole('status')).toHaveTextContent('editor.notebook.kpiState.error');
    });

    it('shows the absent-output state before the cell has run', () => {
        render(<SqlCellResult {...makeProps({result: null, kpiConfig: {column: 'n'}})} />);
        expect(screen.getByRole('status')).toHaveTextContent('editor.notebook.kpiState.noOutput');
    });

    it('renders nothing new for cells without a KPI that have not run', () => {
        const {container} = render(<SqlCellResult {...makeProps({result: null})} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('hides the KPI when it is toggled off', () => {
        render(
            <SqlCellResult
                {...makeProps({kpiConfig: {column: 'active_users'}, isKpiVisible: false})}
            />,
        );
        expect(screen.queryByRole('region')).not.toBeInTheDocument();
        expect(screen.getByText('editor.notebook.sectionKpi')).toBeInTheDocument();
    });
});
