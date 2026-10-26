import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {TableFilterInput} from '@/components/layout/sidebar/TableFilterInput';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({t: (key: string) => key}),
}));

describe('TableFilterInput', () => {
    const defaultProps = {
        value: '',
        onChange: vi.fn(),
        onOpenFirstMatch: vi.fn(),
        hasMatch: false,
    };

    it('renders with placeholder text', () => {
        render(<TableFilterInput {...defaultProps} />);
        expect(screen.getByPlaceholderText('sidebar.filterTables')).toBeInTheDocument();
    });

    it('calls onChange when typing', () => {
        const onChange = vi.fn();
        render(<TableFilterInput {...defaultProps} onChange={onChange} />);
        const input = screen.getByPlaceholderText('sidebar.filterTables');
        fireEvent.change(input, {target: {value: 'users'}});
        expect(onChange).toHaveBeenCalledWith('users');
    });

    it('opens first match on Enter when there is a match', () => {
        const onOpenFirstMatch = vi.fn();
        render(
            <TableFilterInput
                {...defaultProps}
                value="user"
                hasMatch={true}
                onOpenFirstMatch={onOpenFirstMatch}
            />,
        );
        const input = screen.getByPlaceholderText('sidebar.filterTables');
        fireEvent.keyDown(input, {key: 'Enter'});
        expect(onOpenFirstMatch).toHaveBeenCalledOnce();
    });

    it('does nothing on Enter when there are no matches', () => {
        const onOpenFirstMatch = vi.fn();
        render(
            <TableFilterInput
                {...defaultProps}
                value="nonexistent"
                hasMatch={false}
                onOpenFirstMatch={onOpenFirstMatch}
            />,
        );
        const input = screen.getByPlaceholderText('sidebar.filterTables');
        fireEvent.keyDown(input, {key: 'Enter'});
        expect(onOpenFirstMatch).not.toHaveBeenCalled();
    });

    it('clears filter on Escape and keeps focus', () => {
        const onChange = vi.fn();
        render(<TableFilterInput {...defaultProps} value="test" onChange={onChange} />);
        const input = screen.getByPlaceholderText('sidebar.filterTables');
        input.focus();
        fireEvent.keyDown(input, {key: 'Escape'});
        expect(onChange).toHaveBeenCalledWith('');
        expect(input).toHaveFocus();
    });

    it('does not clear filter on Escape when filter is already empty', () => {
        const onChange = vi.fn();
        render(<TableFilterInput {...defaultProps} value="" onChange={onChange} />);
        const input = screen.getByPlaceholderText('sidebar.filterTables');
        fireEvent.keyDown(input, {key: 'Escape'});
        expect(onChange).not.toHaveBeenCalled();
    });

    it('does not open first match on Enter during IME composition', () => {
        const onOpenFirstMatch = vi.fn();
        render(
            <TableFilterInput
                {...defaultProps}
                value="う"
                hasMatch={true}
                onOpenFirstMatch={onOpenFirstMatch}
            />,
        );
        const input = screen.getByPlaceholderText('sidebar.filterTables');
        fireEvent.keyDown(input, {key: 'Enter', isComposing: true});
        expect(onOpenFirstMatch).not.toHaveBeenCalled();
    });

    it('shows clear button only when there is a value', () => {
        const {rerender} = render(<TableFilterInput {...defaultProps} value="" />);
        expect(
            screen.queryByRole('button', {name: 'sidebar.clearTableFilter'}),
        ).not.toBeInTheDocument();

        rerender(<TableFilterInput {...defaultProps} value="test" />);
        expect(screen.getByRole('button', {name: 'sidebar.clearTableFilter'})).toBeInTheDocument();
    });

    it("clear button has type='button' and aria-label", () => {
        render(<TableFilterInput {...defaultProps} value="test" />);
        const clearButton = screen.getByRole('button', {
            name: 'sidebar.clearTableFilter',
        });
        expect(clearButton).toHaveAttribute('type', 'button');
        expect(clearButton).toHaveAttribute('aria-label', 'sidebar.clearTableFilter');
    });

    it('clear button clears the filter', () => {
        const onChange = vi.fn();
        render(<TableFilterInput {...defaultProps} value="test" onChange={onChange} />);
        const clearButton = screen.getByRole('button', {
            name: 'sidebar.clearTableFilter',
        });
        fireEvent.click(clearButton);
        expect(onChange).toHaveBeenCalledWith('');
    });

    it('preserves data-table-filter attribute for focus shortcut', () => {
        render(<TableFilterInput {...defaultProps} />);
        const input = screen.getByPlaceholderText('sidebar.filterTables');
        expect(input).toHaveAttribute('data-table-filter');
    });

    it('stops propagation when stopPropagation is true', () => {
        const parentClick = vi.fn();
        render(
            <div onClick={parentClick}>
                <TableFilterInput {...defaultProps} value="test" stopPropagation={true} />
            </div>,
        );
        const input = screen.getByPlaceholderText('sidebar.filterTables');
        fireEvent.click(input);
        expect(parentClick).not.toHaveBeenCalled();

        const clearButton = screen.getByRole('button', {
            name: 'sidebar.clearTableFilter',
        });
        fireEvent.click(clearButton);
        expect(parentClick).not.toHaveBeenCalled();
    });

    it('does not stop propagation when stopPropagation is false', () => {
        const parentClick = vi.fn();
        render(
            <div onClick={parentClick}>
                <TableFilterInput {...defaultProps} stopPropagation={false} />
            </div>,
        );
        const input = screen.getByPlaceholderText('sidebar.filterTables');
        fireEvent.click(input);
        expect(parentClick).toHaveBeenCalled();
    });
});
