import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextMenu } from '../../../src/components/ui/ContextMenu';
import * as ContextMenuUtils from '../../../src/utils/contextMenu';

// Mock the contextMenu utilities
vi.mock('../../../src/utils/contextMenu', () => ({
  calculateContextMenuPosition: vi.fn((constraints) => ({
    top: constraints.clickY,
    left: constraints.clickX,
  })),
  calculateSubmenuOffsetY: vi.fn(() => 0),
}));

describe('ContextMenu', () => {
  const mockOnClose = vi.fn();
  const mockAction1 = vi.fn();
  const mockAction2 = vi.fn();

  const defaultItems = [
    { label: 'Item 1', action: mockAction1 },
    { label: 'Item 2', action: mockAction2 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window dimensions
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 768, writable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders with menu items', () => {
    render(
      <ContextMenu
        x={100}
        y={100}
        items={defaultItems}
        onClose={mockOnClose}
      />
    );

    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
  });

  it('calls action and closes when item clicked', () => {
    render(
      <ContextMenu
        x={100}
        y={100}
        items={defaultItems}
        onClose={mockOnClose}
      />
    );

    fireEvent.click(screen.getByText('Item 1'));
    expect(mockAction1).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('closes when clicking outside', () => {
    render(
      <ContextMenu
        x={100}
        y={100}
        items={defaultItems}
        onClose={mockOnClose}
      />
    );

    fireEvent.mouseDown(document.body);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('closes when pressing Escape', () => {
    render(
      <ContextMenu
        x={100}
        y={100}
        items={defaultItems}
        onClose={mockOnClose}
      />
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('renders with icons', () => {
    const itemsWithIcons = [
      {
        label: 'Delete',
        action: mockAction1,
        icon: () => <svg data-testid="delete-icon" />,
      },
    ];

    render(
      <ContextMenu
        x={100}
        y={100}
        items={itemsWithIcons}
        onClose={mockOnClose}
      />
    );

    expect(screen.getByTestId('delete-icon')).toBeInTheDocument();
  });

  it('applies danger styling to danger items', () => {
    const dangerItems = [
      { label: 'Delete', action: mockAction1, danger: true },
      { label: 'Normal', action: mockAction2, danger: false },
    ];

    render(
      <ContextMenu
        x={100}
        y={100}
        items={dangerItems}
        onClose={mockOnClose}
      />
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveClass('text-red-400');
    expect(buttons[1]).not.toHaveClass('text-red-400');
  });

  it('positions menu at provided coordinates', () => {
    const calculateContextMenuPosition = vi.spyOn(ContextMenuUtils, 'calculateContextMenuPosition');
    
    render(
      <ContextMenu
        x={200}
        y={300}
        items={defaultItems}
        onClose={mockOnClose}
      />
    );

    expect(calculateContextMenuPosition).toHaveBeenCalledWith(
      expect.objectContaining({
        viewportWidth: 1024,
        viewportHeight: 768,
        clickX: 200,
        clickY: 300,
        margin: 10,
      })
    );
  });

  it('has correct CSS classes', () => {
    const { container } = render(
      <ContextMenu
        x={100}
        y={100}
        items={defaultItems}
        onClose={mockOnClose}
      />
    );

    const menu = container.firstChild as HTMLElement;
    expect(menu).toHaveClass('fixed');
    expect(menu).toHaveClass('z-50');
    expect(menu).toHaveClass('bg-surface-secondary');
    expect(menu).toHaveClass('rounded-lg');
  });

  it('renders empty menu when no items', () => {
    const { container } = render(
      <ContextMenu
        x={100}
        y={100}
        items={[]}
        onClose={mockOnClose}
      />
    );

    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(0);
  });

  it('renders a header item as a non-interactive label', () => {
    render(
      <ContextMenu
        x={100}
        y={100}
        items={[
          { label: 'Move to Group', header: true },
          { label: 'Item 1', action: mockAction1 },
        ]}
        onClose={mockOnClose}
      />
    );

    const header = screen.getByText('Move to Group');
    // Headers are not clickable buttons
    expect(header.closest('button')).toBeNull();
    fireEvent.click(header);
    expect(mockAction1).not.toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();
    // The actual item is still a button
    expect(screen.getByText('Item 1').closest('button')).not.toBeNull();
  });

  it('renders tree guides for indented items', () => {
    const { container } = render(
      <ContextMenu
        x={100}
        y={100}
        items={[
          { label: 'Root', action: mockAction1, indent: 0 },
          { label: 'Child', action: mockAction2, indent: 1 },
          { label: 'Grandchild', action: vi.fn(), indent: 2 },
        ]}
        onClose={mockOnClose}
      />
    );

    const rootBtn = screen.getByText('Root').closest('button')!;
    const childBtn = screen.getByText('Child').closest('button')!;
    const grandBtn = screen.getByText('Grandchild').closest('button')!;

    // depth 0 → no rails; depth 1 → 1 rail; depth 2 → 2 rails
    const rails = (btn: HTMLElement) =>
      btn.querySelectorAll('span.relative.self-stretch').length;
    expect(rails(rootBtn)).toBe(0);
    expect(rails(childBtn)).toBe(1);
    expect(rails(grandBtn)).toBe(2);
    // Indented items still trigger their action
    fireEvent.click(childBtn);
    expect(mockAction2).toHaveBeenCalled();
    // sanity: container rendered
    expect(container).toBeTruthy();
  });

  it('opens a submenu on hover and fires the child action', () => {
    const childAction = vi.fn();
    render(
      <ContextMenu
        x={100}
        y={100}
        items={[
          {
            label: 'Move to Group',
            submenu: [{ label: 'tests', action: childAction, indent: 0 }],
          },
        ]}
        onClose={mockOnClose}
      />
    );

    // Submenu items are hidden until hover
    expect(screen.queryByText('tests')).toBeNull();

    const parent = screen.getByText('Move to Group').closest('div')!;
    fireEvent.mouseEnter(parent);

    const child = screen.getByText('tests');
    expect(child).toBeInTheDocument();
    fireEvent.click(child);
    expect(childAction).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('handles many menu items', () => {
    const manyItems = Array.from({ length: 10 }, (_, i) => ({
      label: `Item ${i + 1}`,
      action: vi.fn(),
    }));

    render(
      <ContextMenu
        x={100}
        y={100}
        items={manyItems}
        onClose={mockOnClose}
      />
    );

    manyItems.forEach((item) => {
      expect(screen.getByText(item.label)).toBeInTheDocument();
    });
  });
});
