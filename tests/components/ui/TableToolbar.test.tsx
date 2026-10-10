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

  it('exposes a controlled, labeled refresh interval beside manual refresh', () => {
    const onChange = vi.fn();
    const onRefresh = vi.fn();
    const { rerender } = render(<TableToolbar {...defaultProps} autoRefreshIntervalMs={10000}
      onAutoRefreshChange={onChange} onRefresh={onRefresh} />);
    const select = screen.getByRole('combobox', { name: 'toolbar.autoRefresh.label' });
    expect(select).toHaveValue('10000');
    expect(select.querySelectorAll('option')).toHaveLength(5);
    fireEvent.change(select, { target: { value: '5000' } });
    expect(onChange).toHaveBeenCalledWith(5000);
    expect(select).toHaveValue('10000');
    fireEvent.click(screen.getByRole('button', { name: 'toolbar.autoRefresh.refresh' }));
    expect(onRefresh).toHaveBeenCalledOnce();
    rerender(<TableToolbar {...defaultProps} autoRefreshIntervalMs={5000}
      onAutoRefreshChange={onChange} onRefresh={onRefresh} autoRefreshPaused refreshDisabled />);
    expect(select).toHaveValue('5000');
    expect(screen.getByRole('status')).toHaveTextContent('toolbar.autoRefresh.paused');
    expect(screen.getByRole('button', { name: 'toolbar.autoRefresh.refresh' })).toBeDisabled();
  });

  it('keeps the auto-refresh live region mounted and names the pause reason', () => {
    const props = { ...defaultProps, onAutoRefreshChange: vi.fn(), onRefresh: vi.fn(), autoRefreshIntervalMs: 5000 as const };
    const { rerender } = render(<TableToolbar {...props} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('');
    rerender(<TableToolbar {...props} autoRefreshPaused autoRefreshPausedReason="selection" />);
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('toolbar.autoRefresh.pausedSelection');
    rerender(<TableToolbar {...props} autoRefreshPaused autoRefreshPausedReason="editing" />);
    expect(status).toHaveTextContent('toolbar.autoRefresh.paused');
  });

  it('renders a single refresh button and marks a non-Off interval as active', () => {
    const props = { ...defaultProps, onAutoRefreshChange: vi.fn(), onRefresh: vi.fn() };
    const { rerender } = render(<TableToolbar {...props} autoRefreshIntervalMs={0} />);
    expect(screen.getAllByRole('button', { name: 'toolbar.autoRefresh.refresh' })).toHaveLength(1);
    const select = screen.getByRole('combobox', { name: 'toolbar.autoRefresh.label' });
    expect(select).not.toHaveAttribute('data-active');
    expect(select).toHaveClass('border-default', 'text-secondary');

    rerender(<TableToolbar {...props} autoRefreshIntervalMs={30000} />);
    expect(select).toHaveAttribute('data-active', 'true');
    expect(select).toHaveClass('border-accent-primary/50', 'text-accent');
    expect(select).not.toHaveClass('border-default');
    expect(screen.getByRole('button', { name: 'toolbar.autoRefresh.refresh' })).toHaveClass('text-accent');

    rerender(<TableToolbar {...props} autoRefreshIntervalMs={0} />);
    expect(select).not.toHaveAttribute('data-active');
    expect(screen.getByRole('button', { name: 'toolbar.autoRefresh.refresh' })).toHaveClass('text-muted');
  });

  it('omits the refresh controls when auto-refresh is not wired', () => {
    render(<TableToolbar {...defaultProps} />);
    expect(screen.queryByRole('button', { name: 'toolbar.autoRefresh.refresh' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'toolbar.autoRefresh.label' })).toBeNull();
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

  describe('filter panel', () => {
    const panelProps = {
      ...defaultProps,
      columnMetadata: [
        { name: 'id', data_type: 'int', is_pk: true, is_nullable: false, is_auto_increment: true },
      ],
    };
    const openPanel = () => {
      fireEvent.click(screen.getByTitle('toolbar.toggleFilterPanel'));
      // the WHERE input is hidden while the panel is open
      expect(screen.queryByText('WHERE')).not.toBeInTheDocument();
    };

    it('stays open when clicking outside of it', () => {
      render(
        <div>
          <TableToolbar {...panelProps} />
          <div data-testid="grid">grid</div>
        </div>
      );
      openPanel();

      fireEvent.mouseDown(screen.getByTestId('grid'));
      fireEvent.click(screen.getByTestId('grid'));

      expect(screen.queryByText('WHERE')).not.toBeInTheDocument();
    });

    describe('value picker', () => {
      const pickerProps = {
        ...defaultProps,
        columnMetadata: [
          { name: 'status', data_type: 'varchar(20)', is_pk: false, is_nullable: true, is_auto_increment: false },
          { name: 'qty', data_type: 'integer', is_pk: false, is_nullable: true, is_auto_increment: false },
        ],
        tableName: 'orders',
        tableSchema: 'public',
      };

      beforeEach(() => {
        vi.mocked(useDatabase).mockReturnValue({
          activeDriver: 'postgres',
          activeCapabilities: null,
        } as unknown as ReturnType<typeof useDatabase>);
      });

      it('is not offered without a query runner', () => {
        render(<TableToolbar {...pickerProps} />);
        openPanel();
        expect(screen.queryByRole('button', { name: 'toolbar.valuePicker.open' })).not.toBeInTheDocument();
      });

      it('counts values for the row column, narrowed by the other rows when matching all', async () => {
        const onRunQuery = vi.fn().mockResolvedValue({ columns: ['status', 'count'], rows: [['open', 3]] });
        render(<TableToolbar {...pickerProps} onRunQuery={onRunQuery} />);
        openPanel();
        // second row: qty > 5
        fireEvent.click(screen.getByText('toolbar.addFilter'));
        const selects = screen.getAllByRole('combobox');
        fireEvent.change(selects[selects.length - 2], { target: { value: 'qty' } });
        fireEvent.change(selects[selects.length - 1], { target: { value: '>' } });
        const valueInputs = screen.getAllByPlaceholderText('toolbar.valuePlaceholder');
        fireEvent.change(valueInputs[1], { target: { value: '5' } });

        fireEvent.click(screen.getAllByRole('button', { name: 'toolbar.valuePicker.open' })[0]);
        expect(await screen.findByRole('checkbox', { name: /open/ })).toBeInTheDocument();
        expect(onRunQuery).toHaveBeenCalledWith(
          'SELECT "status", COUNT(*) FROM "public"."orders" WHERE "status" IS NOT NULL AND (qty > 5) ' +
            'GROUP BY "status" ORDER BY 2 DESC, 1 LIMIT 100'
        );

        fireEvent.click(screen.getByRole('checkbox', { name: /open/ }));
        fireEvent.click(screen.getByRole('button', { name: /toolbar.valuePicker.use/ }));
        expect(valueInputs[0]).toHaveValue('open');
        // Picking fills the row but does not run the table query by itself.
        expect(mockOnUpdate).not.toHaveBeenCalled();
      });
    });

    it('is closed when remounted with another key (table tab switch)', () => {
      const { rerender } = render(<TableToolbar key="customers" {...panelProps} />);
      openPanel();

      rerender(<TableToolbar key="orders" {...panelProps} />);

      expect(screen.getByText('WHERE')).toBeInTheDocument();
    });
  });
});
