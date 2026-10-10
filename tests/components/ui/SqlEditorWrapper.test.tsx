import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SqlEditorWrapper } from '../../../src/components/ui/SqlEditorWrapper';
import { SettingsContext, DEFAULT_SETTINGS } from '../../../src/contexts/SettingsContext';
import { CommandPaletteDispatchContext } from '../../../src/contexts/CommandPaletteContext';
import type { ReactNode } from 'react';

interface MonacoEditorMockProps {
  onChange?: (value: string) => void;
  beforeMount?: (monaco: unknown) => void;
  onMount?: (editor: unknown, monaco: unknown) => void;
  defaultValue?: string;
  options?: {
    acceptSuggestionOnEnter?: string;
    folding?: boolean;
    showFoldingControls?: string;
  };
}

interface MonacoKeyDownEventMock {
  browserEvent: KeyboardEvent;
  preventDefault: () => void;
  stopPropagation: () => void;
}

const monacoRenderState = vi.hoisted(() => ({
  beforeMount: undefined as MonacoEditorMockProps['beforeMount'],
  onMount: undefined as MonacoEditorMockProps['onMount'],
}));
const registerSqlFoldingProviderMock = vi.hoisted(() => vi.fn());
const setSqlFoldingDialectMock = vi.hoisted(() => vi.fn());
const installSqlFoldPreviewMock = vi.hoisted(() =>
  vi.fn(() => ({ dispose: vi.fn() })),
);
const matchesShortcutMock = vi.hoisted(() =>
  vi.fn<(event: KeyboardEvent, id: string) => boolean>(),
);
const togglePaletteMock = vi.hoisted(() => vi.fn());
const closePaletteMock = vi.hoisted(() => vi.fn());
const initVimModeMock = vi.hoisted(() => vi.fn());

// Mock MonacoEditor
vi.mock('../../../src/components/ui/LazyMonaco', async () => {
  return {
    MonacoEditor: ({ onChange, beforeMount, onMount, defaultValue, options }: MonacoEditorMockProps) => {
      monacoRenderState.beforeMount = beforeMount;
      monacoRenderState.onMount = onMount;
      return (
        <textarea
          data-testid="monaco-editor"
          data-accept-suggestion-on-enter={options?.acceptSuggestionOnEnter}
          data-folding={String(options?.folding)}
          data-folding-controls={options?.showFoldingControls}
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

// Mock useKeybindings hook
vi.mock('../../../src/hooks/useKeybindings', () => ({
  useKeybindings: vi.fn(() => ({
    matchesShortcut: matchesShortcutMock,
  })),
}));

// Mock themeUtils
vi.mock('../../../src/themes/themeUtils', () => ({
  loadMonacoTheme: vi.fn(),
}));

vi.mock('../../../src/utils/sqlFolding', () => ({
  registerSqlFoldingProvider: registerSqlFoldingProviderMock,
  setSqlFoldingDialect: setSqlFoldingDialectMock,
}));

vi.mock('../../../src/utils/sqlFoldPreview', () => ({
  installSqlFoldPreview: installSqlFoldPreviewMock,
}));

// Mock monaco KeyMod and KeyCode
vi.mock('monaco-editor', () => ({
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { Enter: 3 },
}));

// Mock monaco-vim (dynamically imported by useMonacoVimMode)
vi.mock('monaco-vim', () => ({
  initVimMode: initVimModeMock,
}));

const settingsValue = {
  settings: DEFAULT_SETTINGS,
  updateSetting: vi.fn(),
  isLoading: false,
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <SettingsContext.Provider value={settingsValue}>
    <CommandPaletteDispatchContext.Provider
      value={{
        openPalette: vi.fn(),
        closePalette: closePaletteMock,
        togglePalette: togglePaletteMock,
      }}
    >
      {children}
    </CommandPaletteDispatchContext.Provider>
  </SettingsContext.Provider>
);

const standaloneWrapper = ({ children }: { children: ReactNode }) => (
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
    monacoRenderState.beforeMount = undefined;
    monacoRenderState.onMount = undefined;
    matchesShortcutMock.mockReturnValue(false);
    initVimModeMock.mockImplementation(() => ({ dispose: vi.fn() }));
  });

  const mountCapturedEditor = () => {
    const keyDownHandlers: Array<(event: MonacoKeyDownEventMock) => void> = [];
    const addAction = vi.fn();
    const addCommand = vi.fn();
    const trigger = vi.fn();
    const editor = {
      addAction,
      addCommand,
      dispose: vi.fn(),
      getContribution: vi.fn(() => null),
      getModel: vi.fn(() => null),
      onKeyDown: vi.fn((handler: (event: MonacoKeyDownEventMock) => void) => {
        keyDownHandlers.push(handler);
      }),
      trigger,
    };
    const monaco = {
      KeyMod: { CtrlCmd: 1, Shift: 2, Alt: 4 },
      KeyCode: { KeyX: 8, KeyC: 16, KeyV: 32, Enter: 64, KeyF: 128, KeyA: 256 },
    };

    // onMount now records the editor in component state (for vim mode), so
    // the resulting re-render must be wrapped in act.
    act(() => {
      monacoRenderState.onMount?.(editor, monaco);
    });

    return { addAction, addCommand, keyDownHandlers, trigger };
  };

  it('converts the selection to an SQL list in one undoable edit, only when text is selected', () => {
    render(
      <SqlEditorWrapper initialValue="" onChange={mockOnChange} onRun={mockOnRun} />,
      { wrapper },
    );
    const { addAction } = mountCapturedEditor();
    const action = addAction.mock.calls
      .map(([descriptor]) => descriptor as { id: string; run: (ed: unknown) => void })
      .find((descriptor) => descriptor.id === 'tabularis.convertSelectionToSqlList');
    if (!action) throw new Error('convert-to-SQL-list action was not registered');
    expect(action).toMatchObject({
      label: 'editor.convertSelectionToSqlList',
      contextMenuGroupId: '1_modification',
      precondition: 'editorHasSelection',
    });

    const steps: string[] = [];
    const selected = { isEmpty: () => false, text: "O'Brien\n42" };
    const blank = { isEmpty: () => false, text: ' \n ' };
    const collapsed = { isEmpty: () => true, text: '' };
    const ed = {
      getModel: () => ({ getValueInRange: (range: { text: string }) => range.text }),
      getSelections: () => [selected, blank, collapsed],
      pushUndoStop: vi.fn(() => steps.push('undo-stop')),
      executeEdits: vi.fn(() => steps.push('edit')),
    };
    action.run(ed);

    expect(ed.executeEdits).toHaveBeenCalledWith('convertSelectionToSqlList', [
      { range: selected, text: "'O''Brien', '42'", forceMoveMarkers: true },
    ]);
    expect(steps).toEqual(['undo-stop', 'edit', 'undo-stop']);

    ed.getSelections = () => [blank, collapsed];
    ed.executeEdits.mockClear();
    action.run(ed);
    expect(ed.executeEdits).not.toHaveBeenCalled();
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

  it('enables and registers SQL code folding', () => {
    render(
      <SqlEditorWrapper
        initialValue="SELECT 1"
        onChange={mockOnChange}
        onRun={mockOnRun}
        dialect="postgres"
      />,
      { wrapper },
    );

    expect(screen.getByTestId('monaco-editor')).toHaveAttribute('data-folding', 'true');
    expect(screen.getByTestId('monaco-editor')).toHaveAttribute(
      'data-folding-controls',
      'always',
    );

    const monaco = {};
    monacoRenderState.beforeMount?.(monaco);
    expect(registerSqlFoldingProviderMock).toHaveBeenCalledWith(monaco);
  });

  it('installs fold previews only when requested', () => {
    render(
      <SqlEditorWrapper
        initialValue="SELECT 1"
        onChange={mockOnChange}
        onRun={mockOnRun}
        foldPreview
      />,
      { wrapper },
    );

    mountCapturedEditor();
    expect(installSqlFoldPreviewMock).toHaveBeenCalledOnce();
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

  it('opens the action palette before Monaco consumes its shortcut', () => {
    matchesShortcutMock.mockImplementation(
      (_event, id) => id === 'command_palette_actions',
    );
    render(
      <SqlEditorWrapper
        initialValue=""
        onChange={mockOnChange}
        onRun={mockOnRun}
        editorKey="palette-shortcut"
      />,
      { wrapper }
    );
    const { keyDownHandlers, trigger } = mountCapturedEditor();
    const event = {
      browserEvent: new KeyboardEvent('keydown', {
        key: 'a',
        ctrlKey: true,
        shiftKey: true,
      }),
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    keyDownHandlers[0](event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(togglePaletteMock).toHaveBeenCalledWith('actions');
    expect(trigger).not.toHaveBeenCalled();
  });

  it('leaves the unified palette shortcut available to Monaco chords', () => {
    matchesShortcutMock.mockImplementation(
      (_event, id) => id === 'command_palette',
    );
    render(
      <SqlEditorWrapper
        initialValue=""
        onChange={mockOnChange}
        onRun={mockOnRun}
        editorKey="unified-palette-shortcut"
      />,
      { wrapper }
    );
    const { keyDownHandlers, trigger } = mountCapturedEditor();
    const event = {
      browserEvent: new KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
      }),
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    keyDownHandlers[0](event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(togglePaletteMock).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });

  it('does not intercept composing editor key events as palette shortcuts', () => {
    matchesShortcutMock.mockImplementation(
      (_event, id) => id === 'command_palette_actions',
    );
    render(
      <SqlEditorWrapper
        initialValue=""
        onChange={mockOnChange}
        onRun={mockOnRun}
        editorKey="palette-composition"
      />,
      { wrapper }
    );
    const { keyDownHandlers } = mountCapturedEditor();
    const event = {
      browserEvent: new KeyboardEvent('keydown', {
        key: 'a',
        ctrlKey: true,
        shiftKey: true,
        isComposing: true,
      }),
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    keyDownHandlers[0](event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(togglePaletteMock).not.toHaveBeenCalled();
  });

  it('renders without a command palette provider and leaves its shortcut to Monaco', () => {
    matchesShortcutMock.mockImplementation(
      (_event, id) => id === 'command_palette_actions',
    );
    render(
      <SqlEditorWrapper
        initialValue=""
        onChange={mockOnChange}
        onRun={mockOnRun}
        editorKey="standalone-editor"
      />,
      { wrapper: standaloneWrapper }
    );
    const { keyDownHandlers } = mountCapturedEditor();
    const event = {
      browserEvent: new KeyboardEvent('keydown', {
        key: 'a',
        ctrlKey: true,
        shiftKey: true,
      }),
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    keyDownHandlers[0](event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(togglePaletteMock).not.toHaveBeenCalled();
  });

  it('keeps toggle block comment available on Shift+Alt+A on Linux', () => {
    const platformSpy = vi.spyOn(window.navigator, 'platform', 'get')
      .mockReturnValue('Linux x86_64');
    render(
      <SqlEditorWrapper
        initialValue=""
        onChange={mockOnChange}
        onRun={mockOnRun}
        editorKey="linux-block-comment"
      />,
      { wrapper }
    );
    const { addCommand, trigger } = mountCapturedEditor();
    platformSpy.mockRestore();
    const linuxBlockCommentBinding = 2 | 4 | 256;
    const bindingCall = addCommand.mock.calls.find(
      ([keybinding]) => keybinding === linuxBlockCommentBinding,
    );

    expect(bindingCall).toBeDefined();
    const runBlockComment = bindingCall?.[1] as (() => void) | undefined;
    runBlockComment?.();
    expect(trigger).toHaveBeenCalledWith(
      'keyboard',
      'editor.action.blockComment',
      {},
    );
  });

  describe('vim mode', () => {
    const flushAsyncWork = async () => {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    };

    const renderWithVim = (editorVimMode: boolean | undefined, key: string) => {
      const ctx = {
        settings: { ...DEFAULT_SETTINGS, editorVimMode },
        updateSetting: vi.fn(),
        isLoading: false,
      };
      const localWrapper = ({ children }: { children: ReactNode }) => (
        <SettingsContext.Provider value={ctx}>
          <CommandPaletteDispatchContext.Provider
            value={{
              openPalette: vi.fn(),
              closePalette: closePaletteMock,
              togglePalette: togglePaletteMock,
            }}
          >
            {children}
          </CommandPaletteDispatchContext.Provider>
        </SettingsContext.Provider>
      );
      return render(
        <SqlEditorWrapper
          initialValue=""
          onChange={mockOnChange}
          onRun={mockOnRun}
          editorKey={key}
        />,
        { wrapper: localWrapper },
      );
    };

    it('renders the status line and initializes monaco-vim only when the setting is on', async () => {
      const { rerender } = renderWithVim(true, 'vim-on');
      expect(screen.getByTestId('vim-status-line')).toBeInTheDocument();

      const { keyDownHandlers } = mountCapturedEditor();
      await flushAsyncWork();
      expect(initVimModeMock).toHaveBeenCalledOnce();
      expect(initVimModeMock).toHaveBeenCalledWith(
        expect.anything(),
        screen.getByTestId('vim-status-line'),
      );
      // Bypass listener (palette/suggestions handler registered first).
      expect(keyDownHandlers).toHaveLength(2);

      rerender(
        <SettingsContext.Provider
          value={{
            settings: { ...DEFAULT_SETTINGS, editorVimMode: false },
            updateSetting: vi.fn(),
            isLoading: false,
          }}
        >
          <SqlEditorWrapper
            initialValue=""
            onChange={mockOnChange}
            onRun={mockOnRun}
            editorKey="vim-on"
          />
        </SettingsContext.Provider>,
      );
      expect(screen.queryByTestId('vim-status-line')).not.toBeInTheDocument();
    });

    it('stays off and does not initialize monaco-vim by default', async () => {
      renderWithVim(undefined, 'vim-default-off');
      expect(screen.queryByTestId('vim-status-line')).not.toBeInTheDocument();

      const { keyDownHandlers } = mountCapturedEditor();
      await flushAsyncWork();
      expect(initVimModeMock).not.toHaveBeenCalled();
      // Only the pre-existing palette/suggestions keydown handler.
      expect(keyDownHandlers).toHaveLength(1);
    });

    it('lets run shortcuts through: default-prevents them for vim without stopping propagation', async () => {
      matchesShortcutMock.mockImplementation(
        (event, id) =>
          (id === 'run_query_editor' || id === 'run_all_editor') &&
          event.ctrlKey &&
          event.key === 'Enter',
      );
      renderWithVim(true, 'vim-run-shortcut');
      const { keyDownHandlers } = mountCapturedEditor();
      await flushAsyncWork();
      const bypassHandler = keyDownHandlers[1];

      const runEvent = {
        browserEvent: new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }),
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };
      bypassHandler(runEvent);

      // preventDefault makes monaco-vim skip the event; propagation must
      // continue so Monaco's container-level dispatch still runs the
      // addCommand handler that executes the query.
      expect(runEvent.preventDefault).toHaveBeenCalledOnce();
      expect(runEvent.stopPropagation).not.toHaveBeenCalled();

      // Regular vim keys are not reserved for Tabularis.
      const jEvent = {
        browserEvent: new KeyboardEvent('keydown', { key: 'j' }),
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };
      bypassHandler(jEvent);
      expect(jEvent.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('acceptSuggestionOnEnter mapping', () => {
    const renderWith = (editorAcceptSuggestionOnEnter: boolean | undefined, key: string) => {
      const ctx = {
        settings: { ...DEFAULT_SETTINGS, editorAcceptSuggestionOnEnter },
        updateSetting: vi.fn(),
        isLoading: false,
      };
      const localWrapper = ({ children }: { children: ReactNode }) => (
        <SettingsContext.Provider value={ctx}>
          <CommandPaletteDispatchContext.Provider
            value={{
        openPalette: vi.fn(),
        closePalette: closePaletteMock,
        togglePalette: togglePaletteMock,
      }}
          >
            {children}
          </CommandPaletteDispatchContext.Provider>
        </SettingsContext.Provider>
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

describe('SqlEditorWrapper debounced value sync', () => {
  const mockOnChange = vi.fn();
  const mockOnRun = vi.fn();

  const mountValueEditor = (initial: string) => {
    let value = initial;
    const editor = {
      addAction: vi.fn(),
      addCommand: vi.fn(),
      dispose: vi.fn(),
      getContribution: vi.fn(() => null),
      getModel: vi.fn(() => null),
      onKeyDown: vi.fn(),
      trigger: vi.fn(),
      getValue: vi.fn(() => value),
      setValue: vi.fn((next: string) => {
        value = next;
      }),
      getPosition: vi.fn(() => ({ lineNumber: 1, column: 2 })),
      setPosition: vi.fn(),
      getSelections: vi.fn(() => []),
      setSelections: vi.fn(),
    };
    act(() => {
      monacoRenderState.onMount?.(editor, {
        KeyMod: { CtrlCmd: 1, Shift: 2, Alt: 4 },
        KeyCode: { KeyX: 8, KeyC: 16, KeyV: 32, Enter: 64, KeyF: 128, KeyA: 256 },
      });
    });
    // Simulates the user typing: Monaco already holds the new text when it
    // notifies onChange.
    const type = (next: string) => {
      value = next;
      fireEvent.change(screen.getByTestId('monaco-editor'), { target: { value: next } });
    };
    return { editor, type };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    monacoRenderState.onMount = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderEditor = (initialValue: string) =>
    render(
      <SqlEditorWrapper initialValue={initialValue} onChange={mockOnChange} onRun={mockOnRun} />,
      { wrapper: standaloneWrapper },
    );

  it('does not overwrite keystrokes typed while a debounced change is echoed back', () => {
    const { rerender } = renderEditor('');
    const { editor, type } = mountValueEditor('');

    type('x');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(mockOnChange).toHaveBeenCalledWith('x');

    // The consumer re-renders with "x" only after the user already typed "y".
    type('xy');
    rerender(
      <SqlEditorWrapper initialValue="x" onChange={mockOnChange} onRun={mockOnRun} />,
    );

    expect(editor.setValue).not.toHaveBeenCalled();
    expect(editor.getValue()).toBe('xy');

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(mockOnChange).toHaveBeenLastCalledWith('xy');
    rerender(
      <SqlEditorWrapper initialValue="xy" onChange={mockOnChange} onRun={mockOnRun} />,
    );
    expect(editor.setValue).not.toHaveBeenCalled();
  });

  it('applies an external initialValue change and restores the cursor', () => {
    const { rerender } = renderEditor('');
    const { editor, type } = mountValueEditor('');

    type('x');
    act(() => {
      vi.advanceTimersByTime(300);
    });

    rerender(
      <SqlEditorWrapper initialValue="SELECT 1" onChange={mockOnChange} onRun={mockOnRun} />,
    );

    expect(editor.setValue).toHaveBeenCalledWith('SELECT 1');
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 1, column: 2 });
  });

  it('lets an external change win over a pending debounced flush', () => {
    const { rerender } = renderEditor('');
    const { editor, type } = mountValueEditor('');

    type('ab');
    rerender(
      <SqlEditorWrapper initialValue="SELECT 1" onChange={mockOnChange} onRun={mockOnRun} />,
    );
    expect(editor.setValue).toHaveBeenCalledWith('SELECT 1');

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(mockOnChange).not.toHaveBeenCalledWith('ab');
  });
});
