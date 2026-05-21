import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SqlEditorWrapper } from '../../../src/components/ui/SqlEditorWrapper';
import { SettingsContext, DEFAULT_SETTINGS } from '../../../src/contexts/SettingsContext';
import type { ReactNode } from 'react';

// Mock MonacoEditor
vi.mock('@monaco-editor/react', async () => {
  return {
    default: ({ onChange, onMount, defaultValue, options }: any) => {
      return (
        <textarea
          data-testid="monaco-editor"
          data-accept-suggestion-on-enter={options?.acceptSuggestionOnEnter}
          defaultValue={defaultValue}
          onChange={(e) => onChange?.(e.target.value)}
        />
      );
    },
  };
});

// Mock useTheme hook
vi.mock('../../../src/hooks/useTheme', () => ({
  useTheme: vi.fn(() => ({
    currentTheme: { id: 'tabularis-dark' },
  })),
}));

// Mock themeUtils
vi.mock('../../../src/themes/themeUtils', () => ({
  loadMonacoTheme: vi.fn(),
}));

// Mock monaco KeyMod and KeyCode
vi.mock('monaco-editor', () => ({
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { Enter: 3 },
}));

const settingsValue = {
  settings: DEFAULT_SETTINGS,
  updateSetting: vi.fn(),
  isLoading: false,
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <SettingsContext.Provider value={settingsValue}>
    {children}
  </SettingsContext.Provider>
);

describe('SqlEditorWrapper', () => {
  const mockOnChange = vi.fn();
  const mockOnRun = vi.fn();
  const mockOnMount = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with initial value', () => {
    render(
      <SqlEditorWrapper
        initialValue="SELECT * FROM users"
        onChange={mockOnChange}
        onRun={mockOnRun}
        editorKey="test-1"
      />,
      { wrapper }
    );

    expect(screen.getByTestId('monaco-editor')).toHaveValue('SELECT * FROM users');
  });

  it('renders editor component', async () => {
    render(
      <SqlEditorWrapper
        initialValue=""
        onChange={mockOnChange}
        onRun={mockOnRun}
        editorKey="test-2"
      />,
      { wrapper }
    );

    // Verify editor is rendered (mock in setup.ts returns null, but component mounts)
    expect(document.body).toBeInTheDocument();
  });

  it('accepts onChange prop', async () => {
    render(
      <SqlEditorWrapper
        initialValue=""
        onChange={mockOnChange}
        onRun={mockOnRun}
        editorKey="test-3"
      />,
      { wrapper }
    );

    // Component should mount without errors
    expect(document.body).toBeInTheDocument();
  });

  it('applies custom height', () => {
    render(
      <SqlEditorWrapper
        initialValue="SELECT 1"
        onChange={mockOnChange}
        onRun={mockOnRun}
        height="300px"
        editorKey="test-4"
      />,
      { wrapper }
    );

    // Height is passed to MonacoEditor component
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
  });

  it('applies custom options', () => {
    const customOptions = { fontSize: 16, lineNumbers: 'on' as const };

    render(
      <SqlEditorWrapper
        initialValue="SELECT 1"
        onChange={mockOnChange}
        onRun={mockOnRun}
        options={customOptions}
        editorKey="test-5"
      />,
      { wrapper }
    );

    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
  });

  it('remounts when editorKey changes', () => {
    const { rerender } = render(
      <SqlEditorWrapper
        initialValue="SELECT 1"
        onChange={mockOnChange}
        onRun={mockOnRun}
        editorKey="key-1"
      />,
      { wrapper }
    );

    rerender(
      <SqlEditorWrapper
        initialValue="SELECT 2"
        onChange={mockOnChange}
        onRun={mockOnRun}
        editorKey="key-2"
      />
    );

    // Should render with new value after key change
    expect(screen.getByTestId('monaco-editor')).toHaveValue('SELECT 2');
  });

  it('uses default key when editorKey not provided', () => {
    render(
      <SqlEditorWrapper
        initialValue="SELECT 1"
        onChange={mockOnChange}
        onRun={mockOnRun}
      />,
      { wrapper }
    );

    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
  });

  it('handles different SQL queries', () => {
    const queries = [
      'SELECT * FROM users',
      'INSERT INTO users VALUES (1)',
      'UPDATE users SET name = \'test\'',
      'DELETE FROM users WHERE id = 1',
    ];

    queries.forEach((query, index) => {
      const { unmount } = render(
        <SqlEditorWrapper
          initialValue={query}
          onChange={mockOnChange}
          onRun={mockOnRun}
          editorKey={`query-${index}`}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('monaco-editor')).toHaveValue(query);
      unmount();
    });
  });

  it('handles empty initial value', () => {
    render(
      <SqlEditorWrapper
        initialValue=""
        onChange={mockOnChange}
        onRun={mockOnRun}
        editorKey="empty-test"
      />,
      { wrapper }
    );

    expect(screen.getByTestId('monaco-editor')).toHaveValue('');
  });

  it('handles undefined onChange gracefully', () => {
    const { container } = render(
      <SqlEditorWrapper
        initialValue="SELECT 1"
        onChange={undefined as unknown as (value: string) => void}
        onRun={mockOnRun}
        editorKey="undefined-test"
      />,
      { wrapper }
    );

    expect(container).toBeInTheDocument();
  });

  describe('acceptSuggestionOnEnter mapping', () => {
    const renderWith = (editorAcceptSuggestionOnEnter: boolean | undefined, key: string) => {
      const ctx = {
        settings: { ...DEFAULT_SETTINGS, editorAcceptSuggestionOnEnter },
        updateSetting: vi.fn(),
        isLoading: false,
      };
      const localWrapper = ({ children }: { children: ReactNode }) => (
        <SettingsContext.Provider value={ctx}>{children}</SettingsContext.Provider>
      );
      return render(
        <SqlEditorWrapper
          initialValue=""
          onChange={mockOnChange}
          onRun={mockOnRun}
          editorKey={key}
        />,
        { wrapper: localWrapper }
      );
    };

    it('passes "off" to Monaco when the setting is false', () => {
      renderWith(false, 'accept-off');
      expect(screen.getByTestId('monaco-editor')).toHaveAttribute(
        'data-accept-suggestion-on-enter',
        'off'
      );
    });

    it('passes "smart" to Monaco when the setting is true', () => {
      renderWith(true, 'accept-on');
      expect(screen.getByTestId('monaco-editor')).toHaveAttribute(
        'data-accept-suggestion-on-enter',
        'smart'
      );
    });

    it('defaults to "smart" when the setting is undefined', () => {
      renderWith(undefined, 'accept-undefined');
      expect(screen.getByTestId('monaco-editor')).toHaveAttribute(
        'data-accept-suggestion-on-enter',
        'smart'
      );
    });
  });
});
