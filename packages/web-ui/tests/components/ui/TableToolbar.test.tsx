import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TableToolbar } from '../../../src/components/ui/TableToolbar';
import { useDatabase } from '../../../src/hooks/useDatabase';

vi.mock('../../../src/hooks/useDatabase', () => ({
  useDatabase: vi.fn(),
}));

describe('TableToolbar', () => {
  const mockOnUpdate = vi.fn();
  const defaultProps = {
    placeholderColumn: 'id',
    placeholderSort: 'created_at',
    defaultLimit: 100,
    onUpdate: mockOnUpdate,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDatabase).mockReturnValue({
      activeDriver: null,
    } as ReturnType<typeof useDatabase>);
  });

  it('renders with default state', () => {
    render(<TableToolbar {...defaultProps} />);

    expect(screen.getByText('WHERE')).toBeInTheDocument();
    expect(screen.getByText('ORDER BY')).toBeInTheDocument();
    expect(screen.getByText('LIMIT')).toBeInTheDocument();
  });

  it('renders with initial values', () => {
    render(
      <TableToolbar
        {...defaultProps}
        initialFilter="id > 5"
        initialSort="name ASC"
        initialLimit={50}
      />
    );

    expect(screen.getByDisplayValue('id > 5')).toBeInTheDocument();
    expect(screen.getByDisplayValue('name ASC')).toBeInTheDocument();
    expect(screen.getByDisplayValue('50')).toBeInTheDocument();
  });

  it('shows placeholders correctly', () => {
    render(<TableToolbar {...defaultProps} />);

    const whereInput = screen.getByPlaceholderText('id > 5 AND status = \'active\'');
    const orderInput = screen.getByPlaceholderText('created_at DESC');

    expect(whereInput).toBeInTheDocument();
    expect(orderInput).toBeInTheDocument();
  });

  it('updates filter input on change', () => {
    render(<TableToolbar {...defaultProps} />);

    const filterInput = screen.getByPlaceholderText('id > 5 AND status = \'active\'');
    fireEvent.change(filterInput, { target: { value: 'status = \'active\'' } });

    expect(filterInput).toHaveValue('status = \'active\'');
  });

  it('updates sort input on change', () => {
    render(<TableToolbar {...defaultProps} />);

    const sortInput = screen.getByPlaceholderText('created_at DESC');
    fireEvent.change(sortInput, { target: { value: 'name ASC' } });

    expect(sortInput).toHaveValue('name ASC');
  });

  it('updates limit input on change', () => {
    render(<TableToolbar {...defaultProps} />);

    const limitInput = screen.getByPlaceholderText('100');
    fireEvent.change(limitInput, { target: { value: '50' } });

    expect(limitInput).toHaveValue(50);
  });

  it('calls onUpdate when pressing Enter in filter input', () => {
    render(<TableToolbar {...defaultProps} />);

    const filterInput = screen.getByPlaceholderText('id > 5 AND status = \'active\'');
    fireEvent.change(filterInput, { target: { value: 'id > 10' } });
    fireEvent.keyDown(filterInput, { key: 'Enter' });

    expect(mockOnUpdate).toHaveBeenCalledWith('id > 10', '', undefined);
  });

  it('calls onUpdate when pressing Enter in sort input', () => {
    render(<TableToolbar {...defaultProps} />);

    const sortInput = screen.getByPlaceholderText('created_at DESC');
    fireEvent.change(sortInput, { target: { value: 'name DESC' } });
    fireEvent.keyDown(sortInput, { key: 'Enter' });

    expect(mockOnUpdate).toHaveBeenCalledWith('', 'name DESC', undefined);
  });

  it('quotes sort column on commit for postgres driver', () => {
    vi.mocked(useDatabase).mockReturnValue({
      activeDriver: 'postgres',
    } as ReturnType<typeof useDatabase>);

    render(<TableToolbar {...defaultProps} />);

    const sortInput = screen.getByPlaceholderText('created_at DESC');
    fireEvent.change(sortInput, { target: { value: 'Status DESC' } });
    fireEvent.keyDown(sortInput, { key: 'Enter' });

    expect(mockOnUpdate).toHaveBeenCalledWith('', '"Status" DESC', undefined);
  });

  it('calls onUpdate when pressing Enter in limit input', () => {
    render(<TableToolbar {...defaultProps} />);

    const limitInput = screen.getByPlaceholderText('100');
    fireEvent.change(limitInput, { target: { value: '25' } });
    fireEvent.keyDown(limitInput, { key: 'Enter' });

    expect(mockOnUpdate).toHaveBeenCalledWith('', '', 25);
  });

  it('calls onUpdate on blur', () => {
    render(<TableToolbar {...defaultProps} />);

    const filterInput = screen.getByPlaceholderText('id > 5 AND status = \'active\'');
    fireEvent.change(filterInput, { target: { value: 'status = 1' } });
    fireEvent.blur(filterInput);

    expect(mockOnUpdate).toHaveBeenCalledWith('status = 1', '', undefined);
  });

  it('does not call onUpdate when values have not changed', () => {
    render(
      <TableToolbar
        {...defaultProps}
        initialFilter="existing filter"
      />
    );

    const filterInput = screen.getByDisplayValue('existing filter');
    fireEvent.blur(filterInput);

    expect(mockOnUpdate).not.toHaveBeenCalled();
  });

  it('does not call onUpdate on sort blur when clause only differs by postgres quoting', () => {
    vi.mocked(useDatabase).mockReturnValue({
      activeDriver: 'postgres',
    } as ReturnType<typeof useDatabase>);

    render(
      <TableToolbar
        {...defaultProps}
        initialSort="Status DESC"
      />
    );

    const sortInput = screen.getByDisplayValue('Status DESC');
    fireEvent.blur(sortInput);

    expect(mockOnUpdate).not.toHaveBeenCalled();
  });

  it('resets component when key changes', () => {
    const { rerender } = render(
      <TableToolbar
        {...defaultProps}
        initialFilter="filter1"
        initialSort="sort1"
        initialLimit={50}
      />
    );

    expect(screen.getByDisplayValue('filter1')).toBeInTheDocument();

    // Rerender with different key (simulated by changing initial values)
    rerender(
      <TableToolbar
        {...defaultProps}
        initialFilter="filter2"
        initialSort="sort2"
        initialLimit={100}
      />
    );

    expect(screen.getByDisplayValue('filter2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('sort2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('100')).toBeInTheDocument();
  });

  it('handles limit input clearing', () => {
    render(
      <TableToolbar 
        {...defaultProps} 
        initialLimit={50}
      />
    );

    // Clear the limit input
    const limitInput = screen.getByDisplayValue('50');
    fireEvent.change(limitInput, { target: { value: '' } });
    fireEvent.keyDown(limitInput, { key: 'Enter' });

    // When cleared, onUpdate should be called with undefined
    expect(mockOnUpdate).toHaveBeenCalledWith('', '', undefined);
  });

  it('has correct CSS classes on container', () => {
    const { container } = render(<TableToolbar {...defaultProps} />);

    // The outer wrapper is relative-positioned; the actual toolbar bar is the first child of it
    const wrapper = container.firstChild as HTMLElement;
    const toolbar = wrapper.firstChild as HTMLElement;
    expect(toolbar).toHaveClass('h-10');
    expect(toolbar).toHaveClass('bg-elevated');
    expect(toolbar).toHaveClass('border-y');
    expect(toolbar).toHaveClass('border-default');
  });

  it('renders three input sections', () => {
    render(<TableToolbar {...defaultProps} />);

    const sections = screen.getAllByText(/WHERE|ORDER BY|LIMIT/);
    expect(sections).toHaveLength(3);
  });

  it('limit input accepts only numbers', () => {
    render(<TableToolbar {...defaultProps} />);

    const limitInput = screen.getByPlaceholderText('100');
    expect(limitInput).toHaveAttribute('type', 'number');
  });

  it('handles initialLimit of 0 correctly', () => {
    render(
      <TableToolbar
        {...defaultProps}
        initialLimit={0}
      />
    );

    const limitInput = screen.getByPlaceholderText('100');
    // When initialLimit is 0 or undefined, the input shows empty string
    expect(limitInput).toHaveValue(null); // Empty number input has null value
  });

  it('updates all fields and commits on Enter in any field', () => {
    render(<TableToolbar {...defaultProps} />);

    const filterInput = screen.getByPlaceholderText('id > 5 AND status = \'active\'');
    const sortInput = screen.getByPlaceholderText('created_at DESC');
    const limitInput = screen.getByPlaceholderText('100');

    fireEvent.change(filterInput, { target: { value: 'id = 1' } });
    fireEvent.change(sortInput, { target: { value: 'id ASC' } });
    fireEvent.change(limitInput, { target: { value: '10' } });
    
    fireEvent.keyDown(filterInput, { key: 'Enter' });

    expect(mockOnUpdate).toHaveBeenCalledWith('id = 1', 'id ASC', 10);
  });
});
