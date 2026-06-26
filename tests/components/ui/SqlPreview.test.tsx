import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SqlPreview } from '../../../src/components/ui/SqlPreview';

// Mock MonacoEditor
vi.mock('@monaco-editor/react', () => ({
  default: vi.fn(({ value, options }) => (
    <div data-testid="monaco-editor" data-value={value}>
      <pre>{value}</pre>
    </div>
  )),
}));

// Mock useEditorTheme hook
vi.mock('../../../src/hooks/useEditorTheme', () => ({
  useEditorTheme: vi.fn(() => ({ id: 'tabularis-dark' })),
}));

// Mock themeUtils
vi.mock('../../../src/themes/themeUtils', () => ({
  loadMonacoTheme: vi.fn(),
}));

describe('SqlPreview', () => {
  it('renders with SQL content', () => {
    render(<SqlPreview sql="SELECT * FROM users" />);
    expect(screen.getByText('SELECT * FROM users')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <SqlPreview sql="SELECT 1" className="custom-class" />
    );
    const wrapper = container.querySelector('.sql-preview-wrapper');
    expect(wrapper).toHaveClass('custom-class');
  });

  it('renders with multiline SQL', () => {
    const sql = `SELECT id, name
FROM users
WHERE status = 'active'`;
    render(<SqlPreview sql={sql} />);
    expect(screen.getByText(/SELECT id, name/)).toBeInTheDocument();
    expect(screen.getByText(/FROM users/)).toBeInTheDocument();
  });

  it('renders with empty SQL', () => {
    render(<SqlPreview sql="" />);
    expect(screen.getByTestId('monaco-editor')).toHaveAttribute('data-value', '');
  });

  it('renders with special SQL characters', () => {
    const sql = "SELECT * FROM table WHERE name LIKE '%test%' AND id > 5";
    render(<SqlPreview sql={sql} />);
    expect(screen.getByText(sql)).toBeInTheDocument();
  });

  it('renders with SQL containing quotes', () => {
    const sql = `SELECT * FROM users WHERE name = 'John O''Brien'`;
    render(<SqlPreview sql={sql} />);
    expect(screen.getByText(/John O''Brien/)).toBeInTheDocument();
  });

  it('wrapper has correct CSS classes', () => {
    const { container } = render(<SqlPreview sql="SELECT 1" />);
    const wrapper = container.querySelector('.sql-preview-wrapper');
    expect(wrapper).toHaveClass('rounded-lg');
    expect(wrapper).toHaveClass('overflow-hidden');
    expect(wrapper).toHaveClass('border');
    expect(wrapper).toHaveClass('border-default');
  });

  it('renders with different SQL types', () => {
    const queries = [
      'SELECT * FROM users',
      'INSERT INTO users (name) VALUES (\'test\')',
      'UPDATE users SET name = \'new\' WHERE id = 1',
      'DELETE FROM users WHERE id = 1',
      'CREATE TABLE test (id INT)',
    ];

    queries.forEach((sql) => {
      const { unmount } = render(<SqlPreview sql={sql} />);
      expect(screen.getByText(sql)).toBeInTheDocument();
      unmount();
    });
  });
});
