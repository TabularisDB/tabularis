import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";
import type { VimAdapterInstance } from "monaco-vim";

/**
 * Lazily loads monaco-vim and attaches Vim keybindings to `editor` while
 * `enabled` is true, rendering the mode/command line into `statusNode`.
 *
 * monaco-vim's key handler is registered after this hook's listener (Monaco
 * fires `editor.onKeyDown` listeners in registration order) and skips any
 * event whose browser event is already default-prevented, so `shouldBypass`
 * can reserve combos like Ctrl/Cmd+Enter for Tabularis: returning true
 * default-prevents the event before the Vim layer sees it. Only
 * `preventDefault` is called — stopping propagation would keep the event from
 * reaching Monaco's container-level keybinding dispatch, which is what runs
 * the app's own `addCommand` handlers.
 */
export function useMonacoVimMode(
  editor: Monaco.editor.IStandaloneCodeEditor | null,
  statusNode: HTMLElement | null,
  enabled: boolean,
  shouldBypass?: (event: KeyboardEvent) => boolean,
): void {
  // Latest-callback ref: re-attaching Vim mode whenever the `shouldBypass`
  // identity changes would reset the Vim state mid-edit, so the effect below
  // deliberately depends only on editor/statusNode/enabled.
  const shouldBypassRef = useRef(shouldBypass);
  shouldBypassRef.current = shouldBypass;

  useEffect(() => {
    if (!enabled || !editor || !statusNode) return;

    let cancelled = false;
    let adapter: VimAdapterInstance | null = null;

    const bypassListener = shouldBypassRef.current
      ? editor.onKeyDown((e) => {
          if (e.browserEvent.defaultPrevented) return;
          if (shouldBypassRef.current?.(e.browserEvent)) {
            e.preventDefault();
          }
        })
      : null;

    void import("monaco-vim")
      .then(({ initVimMode }) => {
        if (cancelled) return;
        adapter = initVimMode(editor, statusNode);
      })
      .catch((error: unknown) => {
        console.error("Failed to initialize Vim mode:", error);
      });

    return () => {
      cancelled = true;
      bypassListener?.dispose();
      adapter?.dispose();
      adapter = null;
    };
  }, [editor, statusNode, enabled]);
}
