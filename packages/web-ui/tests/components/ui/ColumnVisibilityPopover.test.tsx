import {describe, it, expect, vi} from 'vitest';
import {useState} from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {ColumnVisibilityPopover} from '@/components/ui/ColumnVisibilityPopover';

// The shared mock drops options; these tests read the counts.
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) =>
            options ? `${key}:${JSON.stringify(options)}` : key,
        i18n: {language: 'en', changeLanguage: vi.fn()},
    }),
    initReactI18next: {type: '3rdParty', init: vi.fn()},
}));

const columns = ['id', 'customer_id', 'created_by', 'updated_at'];
const wide = Array.from({length: 12}, (_, i) => `col_${i}`);

// Keeps the hidden set like a host would, so changes show up in the list.
function Host({
    cols = columns,
    initial = new Set<number>(),
    onChange = vi.fn(),
    onClose = vi.fn(),
    returnFocusTo,
}: {
    cols?: string[];
    initial?: ReadonlySet<number>;
    onChange?: (hidden: ReadonlySet<number>) => void;
    onClose?: () => void;
    returnFocusTo?: () => HTMLElement | null;
}) {
    const [hidden, setHidden] = useState<ReadonlySet<number>>(initial);
    return (
        <ColumnVisibilityPopover
            x={10}
            y={10}
            columns={cols}
            hidden={hidden}
            onChange={(next) => {
                setHidden(next);
                onChange(next);
            }}
            returnFocusTo={returnFocusTo}
            onClose={onClose}
        />
    );
}

const checkbox = (name: string) => screen.getByRole('checkbox', {name});

describe('ColumnVisibilityPopover', () => {
    it('lists every column with visible ones ticked, in result order', () => {
        render(<Host initial={new Set([2])} />);
        expect(screen.getByRole('dialog', {name: 'dataGrid.columnVisibility.title'})).toBeVisible();
        const boxes = screen.getAllByRole('checkbox');
        expect(boxes.map((box) => box.closest('label')?.textContent)).toEqual(columns);
        expect(checkbox('created_by')).not.toBeChecked();
        expect(checkbox('id')).toBeChecked();
        expect(screen.getByText(/dataGrid\.columnVisibility\.shown/).textContent).toContain(
            '"visible":3,"total":4',
        );
    });

    it('hides and shows a column as soon as it is toggled', () => {
        const onChange = vi.fn();
        render(<Host onChange={onChange} />);

        fireEvent.click(checkbox('updated_at'));
        expect([...onChange.mock.lastCall![0]]).toEqual([3]);
        expect(checkbox('updated_at')).not.toBeChecked();

        fireEvent.click(checkbox('updated_at'));
        expect(onChange.mock.lastCall![0].size).toBe(0);
        expect(checkbox('updated_at')).toBeChecked();
    });

    it('keeps the last visible column ticked and explains why', () => {
        const onChange = vi.fn();
        render(<Host initial={new Set([0, 1, 2])} onChange={onChange} />);

        const last = checkbox('updated_at');
        expect(last).toBeDisabled();
        expect(last.closest('label')).toHaveAttribute(
            'title',
            'dataGrid.columnVisibility.lastVisible',
        );
        fireEvent.click(last);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('shows every column with Show all, which is off while nothing is hidden', () => {
        const onChange = vi.fn();
        render(<Host initial={new Set([1, 3])} onChange={onChange} />);

        const showAll = screen.getByRole('button', {name: 'dataGrid.columnVisibility.showAll'});
        fireEvent.click(showAll);
        expect(onChange.mock.lastCall![0].size).toBe(0);
        expect(
            screen.getAllByRole('checkbox').every((box) => (box as HTMLInputElement).checked),
        ).toBe(true);
        expect(showAll).toBeDisabled();
    });

    it('adds a search field for wide results and filters by name', () => {
        render(<Host cols={wide} />);
        const search = screen.getByRole('searchbox', {name: 'dataGrid.searchColumns'});
        expect(search).toHaveFocus();

        fireEvent.change(search, {target: {value: 'COL_1'}});
        expect(
            screen.getAllByRole('checkbox').map((box) => box.closest('label')?.textContent),
        ).toEqual(['col_1', 'col_10', 'col_11']);

        fireEvent.change(search, {target: {value: 'nope'}});
        expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
        expect(screen.getByText('dataGrid.noMatchingColumns')).toBeInTheDocument();
    });

    it('shows only matching indices, reveals hidden matches, and restores all columns', () => {
        const onChange = vi.fn();
        const onClose = vi.fn();
        const cols = ['id', 'Customer_id', '', 'total', 'customer_name', 'id', 'status', 'date'];
        render(
            <Host cols={cols} initial={new Set([1, 4])} onChange={onChange} onClose={onClose} />,
        );
        const search = screen.getByRole('searchbox');
        expect(
            screen.queryByRole('button', {name: 'dataGrid.columnVisibility.showOnlyMatching'}),
        ).toBeNull();
        fireEvent.change(search, {target: {value: ' CUSTOMER '}});
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.click(
            screen.getByRole('button', {name: 'dataGrid.columnVisibility.showOnlyMatching'}),
        );
        expect([...onChange.mock.lastCall![0]]).toEqual([0, 2, 3, 5, 6, 7]);
        expect(
            screen.getAllByRole('checkbox').map((box) => box.closest('label')?.textContent),
        ).toEqual(['Customer_id', 'customer_name']);
        expect(
            screen.getAllByRole('checkbox').every((box) => (box as HTMLInputElement).checked),
        ).toBe(true);
        expect(screen.getByText(/dataGrid\.columnVisibility\.shown/).textContent).toContain(
            '"visible":2,"total":8',
        );
        expect(onClose).not.toHaveBeenCalled();

        fireEvent.change(search, {target: {value: 'id'}});
        fireEvent.click(
            screen.getByRole('button', {name: 'dataGrid.columnVisibility.showOnlyMatching'}),
        );
        expect([...onChange.mock.lastCall![0]]).toEqual([2, 3, 4, 6, 7]);
        fireEvent.click(screen.getByRole('button', {name: 'dataGrid.columnVisibility.showAll'}));
        expect(onChange.mock.lastCall![0].size).toBe(0);
        fireEvent.change(search, {target: {value: ''}});
        expect(
            screen.getAllByRole('checkbox').map((box) => box.closest('label')?.textContent),
        ).toEqual(cols.map((col) => col || "''"));
        expect(
            screen.getAllByRole('checkbox').every((box) => (box as HTMLInputElement).checked),
        ).toBe(true);
    });

    it('cannot hide all columns with an empty search or no matches', () => {
        const onChange = vi.fn();
        render(
            <Host
                cols={wide}
                initial={new Set(wide.slice(1).map((_, i) => i + 1))}
                onChange={onChange}
            />,
        );
        fireEvent.change(screen.getByRole('searchbox'), {target: {value: '   '}});
        expect(
            screen.queryByRole('button', {name: 'dataGrid.columnVisibility.showOnlyMatching'}),
        ).toBeNull();
        fireEvent.change(screen.getByRole('searchbox'), {target: {value: 'absent'}});
        const action = screen.getByRole('button', {
            name: 'dataGrid.columnVisibility.showOnlyMatching',
        });
        expect(action).toBeDisabled();
        fireEvent.click(action);
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.change(screen.getByRole('searchbox'), {target: {value: 'col_0'}});
        expect(checkbox('col_0')).toBeDisabled();
    });

    it.each(['{Enter}', ' '])('activates Show only matching with %s', async (key) => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Host cols={wide} onChange={onChange} />);
        await user.type(screen.getByRole('searchbox'), 'col_0');
        await user.tab();
        await user.tab();
        expect(
            screen.getByRole('button', {name: 'dataGrid.columnVisibility.showOnlyMatching'}),
        ).toHaveFocus();
        await user.keyboard(key);
        expect([...onChange.mock.lastCall![0]]).toEqual(wide.slice(1).map((_, i) => i + 1));
        expect(checkbox('col_0')).toBeChecked();
        expect(checkbox('col_0')).toBeDisabled();
    });

    it('has no search field for a narrow result and focuses the first checkbox', () => {
        render(<Host />);
        expect(screen.queryByRole('searchbox')).toBeNull();
        expect(checkbox('id')).toHaveFocus();
    });

    it('closes on Escape and returns focus to the opener', () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        const onClose = vi.fn();
        render(<Host onClose={onClose} returnFocusTo={() => opener} />);

        fireEvent.keyDown(checkbox('id'), {key: 'Escape'});
        expect(onClose).toHaveBeenCalledOnce();
        expect(opener).toHaveFocus();
        opener.remove();
    });

    it('stays open while the grid behind it scrolls', () => {
        const onClose = vi.fn();
        render(<Host onClose={onClose} />);

        fireEvent.scroll(window);
        fireEvent.scroll(document.body);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('closes on an outside click but not on a click inside', () => {
        const onClose = vi.fn();
        render(<Host onClose={onClose} />);

        fireEvent.mouseDown(checkbox('id'));
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.mouseDown(document.body);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('keeps keys and clicks from reaching the grid or a clickable host', () => {
        const onKeyDown = vi.fn();
        const onClick = vi.fn();
        render(
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stands in for the grid and a clickable result header
            <div onKeyDown={onKeyDown} onClick={onClick}>
                <Host />
            </div>,
        );

        fireEvent.keyDown(checkbox('id'), {key: 'ArrowDown'});
        fireEvent.keyDown(checkbox('id'), {key: 'Backspace'});
        fireEvent.click(screen.getByText('customer_id'));
        expect(onKeyDown).not.toHaveBeenCalled();
        expect(onClick).not.toHaveBeenCalled();

        // App shortcuts still get through.
        fireEvent.keyDown(checkbox('id'), {key: 'w', metaKey: true});
        expect(onKeyDown).toHaveBeenCalledOnce();
    });

    it('shows an empty column name as quotes', () => {
        render(<Host cols={['', 'b']} />);
        expect(screen.getAllByRole('checkbox')[0].closest('label')).toHaveTextContent("''");
    });
});
