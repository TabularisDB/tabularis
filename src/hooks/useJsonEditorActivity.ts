import { useCallback, useEffect, useRef, useState } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

/** Tracks editable native windows, including the asynchronous opening phase. */
export function useJsonEditorActivity() {
  const [count, setCount] = useState(0);
  const active = useRef(new Set<symbol>());
  const sessions = useRef(new Map<string, () => void>());
  const listeners = useRef(new Map<string, () => void>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const windowListeners = listeners.current;
    const windowSessions = sessions.current;
    const activeEditors = active.current;
    return () => {
      mounted.current = false;
      windowListeners.forEach((unlisten) => unlisten());
      windowListeners.clear();
      windowSessions.clear();
      activeEditors.clear();
    };
  }, []);

  const begin = useCallback(() => {
    const token = Symbol();
    active.current.add(token);
    setCount(active.current.size);
    return () => {
      active.current.delete(token);
      if (mounted.current) setCount(active.current.size);
    };
  }, []);

  const release = useCallback((sessionId: string) => {
    sessions.current.get(sessionId)?.();
    sessions.current.delete(sessionId);
    listeners.current.get(sessionId)?.();
    listeners.current.delete(sessionId);
  }, []);

  const watch = useCallback(async (sessionId: string, end: () => void) => {
    if (!mounted.current) { end(); return; }
    // Reopening the same cell focuses its existing native window.
    release(sessionId);
    sessions.current.set(sessionId, end);
    const ownsSession = () => sessions.current.get(sessionId) === end;
    try {
      const window = await WebviewWindow.getByLabel(`json-viewer-${sessionId}`);
      if (!ownsSession()) return;
      if (!window) { release(sessionId); return; }
      const unlisten = await window.once("tauri://destroyed", () => {
        if (ownsSession()) release(sessionId);
      });
      if (!mounted.current || !ownsSession()) unlisten();
      else {
        listeners.current.set(sessionId, unlisten);
        // The window may have closed between lookup and listener registration.
        const stillOpen = await WebviewWindow.getByLabel(`json-viewer-${sessionId}`);
        if (!stillOpen && ownsSession()) release(sessionId);
      }
    } catch (error) {
      console.error("Failed to track JSON editor window:", error);
      if (ownsSession()) release(sessionId);
    }
  }, [release]);

  const isEditing = useCallback(() => active.current.size > 0, []);
  return { count, begin, watch, release, isEditing };
}
