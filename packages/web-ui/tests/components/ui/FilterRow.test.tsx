import {describe, it, expect, vi} from 'vitest';
import {act, render, screen, fireEvent} from '@testing-library/react';
import {FilterRow} from '@/components/ui/FilterRow';
import type {StructuredFilter} from '@/utils/filterBar';
import type {TableColumn} from '@/types/editor';

const col = (name: string, data_type: string): TableColumn => ({
    name,
    data_type,
    is_pk: false,
    is_nullable: true,
    is_auto_increment: false,
});
const columns = [col('status', 'varchar(20)'), col('payload', 'jsonb'), col('qty', 'integer')];

const renderRow = (
    filter: StructuredFilter,
    extra: Partial<React.ComponentProps<typeof FilterRow>> = {},
) => {
    const onChange = vi.fn();
    render(
        <FilterRow
            filter={filter}
            columns={columns}
            onChange={onChange}
            onRemove={vi.fn()}
            onApplySingle={vi.fn()}
            onDuplicate={vi.fn()}
            onEscape={vi.fn()}
            isApplied={false}
            onTriggerApplied={vi.fn()}
            {...extra}
        />,
    );
    return {onChange};
};

const pickerButton = () => screen.queryByRole('button', {name: 'toolbar.valuePicker.open'});

describe('FilterRow value picker', () => {
    const base: StructuredFilter = {
        id: 'f1',
        column: 'status',
        operator: '=',
        value: '',
    };

    it('is offered next to the value field when values can be loaded', () => {
        renderRow(base, {onLoadValues: vi.fn()});
        expect(pickerButton()).toBeInTheDocument();
    });

    it('is not offered without a loader (e.g. query results that are not a table)', () => {
        renderRow(base);
        expect(pickerButton()).not.toBeInTheDocument();
    });

    it('is not offered for JSON / BLOB columns', () => {
        renderRow({...base, column: 'payload'}, {onLoadValues: vi.fn()});
        expect(pickerButton()).not.toBeInTheDocument();
    });

    it('is not offered for operators without a single value field', () => {
        renderRow({...base, operator: 'IS NULL'}, {onLoadValues: vi.fn()});
        expect(pickerButton()).not.toBeInTheDocument();
        renderRow({...base, column: 'qty', operator: 'BETWEEN'}, {onLoadValues: vi.fn()});
        expect(pickerButton()).not.toBeInTheDocument();
    });

    it('loads values for this row and turns several picks into IN', async () => {
        const onLoadValues = vi.fn().mockResolvedValue([
            {value: 'open', count: 5},
            {value: 'Paris, TX', count: 2},
        ]);
        const {onChange} = renderRow(base, {onLoadValues});
        fireEvent.click(pickerButton()!);
        expect(onLoadValues).toHaveBeenCalledWith(base);
        fireEvent.click(await screen.findByRole('checkbox', {name: /^open/}));
        fireEvent.click(screen.getByRole('checkbox', {name: /Paris/}));
        fireEvent.click(screen.getByRole('button', {name: /toolbar.valuePicker.use/}));
        expect(onChange).toHaveBeenCalledWith({
            ...base,
            operator: 'IN',
            value: "open, 'Paris, TX'",
        });
    });

    it('turns a single pick into =', async () => {
        const onLoadValues = vi.fn().mockResolvedValue([{value: '007', count: 1}]);
        const {onChange} = renderRow({...base, operator: 'LIKE', value: '0%'}, {onLoadValues});
        fireEvent.click(pickerButton()!);
        fireEvent.click(await screen.findByRole('checkbox', {name: /007/}));
        fireEvent.click(screen.getByRole('button', {name: /toolbar.valuePicker.use/}));
        expect(onChange).toHaveBeenCalledWith({
            ...base,
            operator: '=',
            value: "'007'",
        });
    });
    it('discards pending values when the row changes and uses the current row on reopen', async () => {
        let resolveOld!: (value: {value: string; count: number}[]) => void;
        const oldRequest = new Promise<{value: string; count: number}[]>((resolve) => {
            resolveOld = resolve;
        });
        const onLoadValues = vi
            .fn()
            .mockReturnValueOnce(oldRequest)
            .mockResolvedValue([{value: '8', count: 2}]);
        const props = {
            columns,
            onChange: vi.fn(),
            onRemove: vi.fn(),
            onApplySingle: vi.fn(),
            onDuplicate: vi.fn(),
            onEscape: vi.fn(),
            isApplied: false,
            onTriggerApplied: vi.fn(),
            onLoadValues,
        };
        const {rerender} = render(
            <FilterRow {...props} filter={base} valuePickerContextKey="orders" />,
        );
        fireEvent.click(pickerButton()!);
        const next = {...base, column: 'qty', value: '7'};
        rerender(<FilterRow {...props} filter={next} valuePickerContextKey="orders" />);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        fireEvent.click(pickerButton()!);
        await act(async () => {
            resolveOld([{value: 'stale', count: 10}]);
        });
        expect(screen.queryByRole('checkbox', {name: /stale/})).not.toBeInTheDocument();
        fireEvent.click(await screen.findByRole('checkbox', {name: /8/}));
        fireEvent.click(screen.getByRole('button', {name: /toolbar.valuePicker.use/}));
        expect(onLoadValues).toHaveBeenLastCalledWith(next);
        expect(props.onChange).toHaveBeenCalledWith({...next, value: '8'});
    });

    it('keeps the picker open across unrelated renders but closes it when query context changes', async () => {
        const props = {
            columns,
            filter: base,
            onChange: vi.fn(),
            onRemove: vi.fn(),
            onApplySingle: vi.fn(),
            onDuplicate: vi.fn(),
            onEscape: vi.fn(),
            isApplied: false,
            onTriggerApplied: vi.fn(),
            onLoadValues: vi.fn().mockResolvedValue([{value: 'open', count: 1}]),
        };
        const {rerender} = render(<FilterRow {...props} valuePickerContextKey="connection-a" />);
        fireEvent.click(pickerButton()!);
        await screen.findByRole('checkbox', {name: /^open/});
        rerender(<FilterRow {...props} isApplied valuePickerContextKey="connection-a" />);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        rerender(<FilterRow {...props} valuePickerContextKey="connection-b" />);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});

describe('FilterRow match case toggle', () => {
    const textFilter: StructuredFilter = {
        id: 'f1',
        column: 'status',
        operator: 'contains',
        value: 'a',
    };
    const toggle = () => screen.queryByRole('checkbox', {name: 'toolbar.matchCase'});

    it('is hidden unless the connection supports it', () => {
        renderRow(textFilter);
        expect(toggle()).not.toBeInTheDocument();
    });

    it('is shown, checked by default, for text operators when supported', () => {
        renderRow(textFilter, {supportsMatchCase: true});
        expect(toggle()).toBeChecked();
    });

    it('is hidden for operators it does not affect', () => {
        renderRow({...textFilter, operator: '='}, {supportsMatchCase: true});
        expect(toggle()).not.toBeInTheDocument();
    });

    it('stores matchCase false when unticked', () => {
        const {onChange} = renderRow(textFilter, {supportsMatchCase: true});
        fireEvent.click(toggle()!);
        expect(onChange).toHaveBeenCalledWith({...textFilter, matchCase: false});
    });

    it('reflects an unticked filter', () => {
        renderRow({...textFilter, matchCase: false}, {supportsMatchCase: true});
        expect(toggle()).not.toBeChecked();
    });
});
