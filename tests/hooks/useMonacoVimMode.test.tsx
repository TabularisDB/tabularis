import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMonacoVimMode } from '../../src/hooks/useMonacoVimMode';

interface FakeMonacoKeyDownEvent {
  browserEvent: KeyboardEvent;
  preventDefault: vi.Mock;
}

const initVimModeMock = vi.hoisted(() => vi.fn());

vi.mock('monaco-vim', () => ({
  initVimMode: initVimModeMock,
}));

const createEditor = () => {
  const keyDownHandlers: Array<(event: FakeMonacoKeyDownEvent) => void> = [];
  const editor = {
    onKeyDown: vi.fn((handler: (event: FakeMonacoKeyDownEvent) => void) => {
      keyDownHandlers.push(handler);
      return {
        dispose: () => {
          const index = keyDownHandlers.indexOf(handler);
          if (index !== -1) keyDownHandlers.splice(index, 1);
        },
      };
    }),
  };
  return { editor, keyDownHandlers };
};

const flushAsyncWork = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('useMonacoVimMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initVimModeMock.mockImplementation(() => ({ dispose: vi.fn() }));
  });

  it('initializes monaco-vim with the editor and status node when enabled', async () => {
    const { editor } = createEditor();
    const statusNode = document.createElement('div');

    renderHook(() => useMonacoVimMode(editor, statusNode, true));

    await waitFor(() => expect(initVimModeMock).toHaveBeenCalledOnce());
    expect(initVimModeMock).toHaveBeenCalledWith(editor, statusNode);
  });

  it('does not initialize when disabled or when the editor/status node is missing', async () => {
    const { editor } = createEditor();
    const statusNode = document.createElement('div');

    renderHook(() => useMonacoVimMode(editor, statusNode, false));
    renderHook(() => useMonacoVimMode(editor, null, true));
    renderHook(() => useMonacoVimMode(null, statusNode, true));

    await flushAsyncWork();
    expect(initVimModeMock).not.toHaveBeenCalled();
  });

  it('disposes the adapter when the setting is turned off', async () => {
    const adapter = { dispose: vi.fn() };
    initVimModeMock.mockImplementation(() => adapter);
    const { editor } = createEditor();
    const statusNode = document.createElement('div');

    const { rerender } = renderHook(
      ({ enabled }) => useMonacoVimMode(editor, statusNode, enabled),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(initVimModeMock).toHaveBeenCalledOnce());

    rerender({ enabled: false });

    expect(adapter.dispose).toHaveBeenCalledOnce();
  });

  it('disposes the adapter on unmount', async () => {
    const adapter = { dispose: vi.fn() };
    initVimModeMock.mockImplementation(() => adapter);
    const { editor } = createEditor();
    const statusNode = document.createElement('div');

    const { unmount } = renderHook(() => useMonacoVimMode(editor, statusNode, true));
    await waitFor(() => expect(initVimModeMock).toHaveBeenCalledOnce());

    unmount();

    expect(adapter.dispose).toHaveBeenCalledOnce();
  });

  it('does not initialize when the dynamic import resolves after unmount', async () => {
    const { editor } = createEditor();
    const statusNode = document.createElement('div');

    const { unmount } = renderHook(() => useMonacoVimMode(editor, statusNode, true));
    // Unmount while the dynamic import is still in flight (before any await),
    // then let the pending import resolve.
    unmount();

    await flushAsyncWork();
    await flushAsyncWork();
    expect(initVimModeMock).not.toHaveBeenCalled();
  });

  it('initializes against the new editor after the instance changes', async () => {
    const first = createEditor();
    const second = createEditor();
    const firstAdapter = { dispose: vi.fn() };
    initVimModeMock.mockImplementationOnce(() => firstAdapter);
    const statusNode = document.createElement('div');

    const { rerender } = renderHook(
      ({ editor }) => useMonacoVimMode(editor, statusNode, true),
      { initialProps: { editor: first.editor } },
    );
    await waitFor(() => expect(initVimModeMock).toHaveBeenCalledTimes(1));

    rerender({ editor: second.editor });

    expect(firstAdapter.dispose).toHaveBeenCalledOnce();
    await waitFor(() => expect(initVimModeMock).toHaveBeenCalledTimes(2));
    expect(initVimModeMock).toHaveBeenLastCalledWith(second.editor, statusNode);
  });

  describe('reserved shortcut bypass', () => {
    it('registers the bypass listener synchronously, before monaco-vim loads', async () => {
      const { editor, keyDownHandlers } = createEditor();
      const statusNode = document.createElement('div');

      renderHook(() => useMonacoVimMode(editor, statusNode, true, () => false));

      expect(keyDownHandlers).toHaveLength(1);
      await waitFor(() => expect(initVimModeMock).toHaveBeenCalledOnce());
    });

    it('default-prevents matching events so monaco-vim ignores them', () => {
      const { editor, keyDownHandlers } = createEditor();
      const statusNode = document.createElement('div');
      const shouldBypass = vi.fn(
        (event: KeyboardEvent) => event.ctrlKey && event.key === 'Enter',
      );

      renderHook(() => useMonacoVimMode(editor, statusNode, true, shouldBypass));

      const runEvent = {
        browserEvent: new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }),
        preventDefault: vi.fn(),
      };
      keyDownHandlers[0](runEvent);

      expect(shouldBypass).toHaveBeenCalledWith(runEvent.browserEvent);
      expect(runEvent.preventDefault).toHaveBeenCalledOnce();
    });

    it('leaves non-matching events untouched', () => {
      const { editor, keyDownHandlers } = createEditor();
      const statusNode = document.createElement('div');
      const shouldBypass = vi.fn(
        (event: KeyboardEvent) => event.ctrlKey && event.key === 'Enter',
      );

      renderHook(() => useMonacoVimMode(editor, statusNode, true, shouldBypass));

      const jEvent = {
        browserEvent: new KeyboardEvent('keydown', { key: 'j' }),
        preventDefault: vi.fn(),
      };
      keyDownHandlers[0](jEvent);

      expect(shouldBypass).toHaveBeenCalledWith(jEvent.browserEvent);
      expect(jEvent.preventDefault).not.toHaveBeenCalled();
    });

    it('skips events another listener already default-prevented', () => {
      const { editor, keyDownHandlers } = createEditor();
      const statusNode = document.createElement('div');
      const shouldBypass = vi.fn(() => true);
      const alreadyPrevented = new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        cancelable: true,
      });
      alreadyPrevented.preventDefault();

      renderHook(() => useMonacoVimMode(editor, statusNode, true, shouldBypass));

      const event = { browserEvent: alreadyPrevented, preventDefault: vi.fn() };
      keyDownHandlers[0](event);

      expect(shouldBypass).not.toHaveBeenCalled();
    });

    it('disposes the bypass listener when the setting is turned off', () => {
      const { editor, keyDownHandlers } = createEditor();
      const statusNode = document.createElement('div');

      const { rerender } = renderHook(
        ({ enabled }) => useMonacoVimMode(editor, statusNode, enabled, () => false),
        { initialProps: { enabled: true } },
      );
      expect(keyDownHandlers).toHaveLength(1);

      rerender({ enabled: false });

      expect(keyDownHandlers).toHaveLength(0);
    });
  });
});
