import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useKeybindings } from "./useKeybindings";
import { useConnectionManager } from "./useConnectionManager";

/**
 * Registers global keyboard shortcuts for navigation.
 * Must be called inside a component that is a child of KeybindingsProvider and BrowserRouter.
 */
export function useGlobalShortcuts() {
  const navigate = useNavigate();
  const { matchesShortcut, isMac } = useKeybindings();
  const { openConnections, handleSwitch } = useConnectionManager();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't fire when typing in inputs / textareas / contenteditable (except for the quick navigator)
      const target = e.target as HTMLElement;
      const isQuickNavigator = matchesShortcut(e, "quick_navigator");
      const isFocusTableFilter = matchesShortcut(e, "focus_table_filter");
      if (
        (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable) &&
        !isQuickNavigator &&
        !isFocusTableFilter
      ) {
        return;
      }

      if (matchesShortcut(e, "toggle_sidebar")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("tabularis:toggle-sidebar"));
        return;
      }

      if (matchesShortcut(e, "focus_table_filter")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("tabularis:focus-table-filter"));
        return;
      }

      if (matchesShortcut(e, "paste_import_clipboard")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("tabularis:paste-import"));
        return;
      }

      if (matchesShortcut(e, "quick_navigator")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("tabularis:open-quick-navigator"));
        return;
      }

      if (matchesShortcut(e, "open_connections")) {
        e.preventDefault();
        navigate("/connections");
        return;
      }

      if (matchesShortcut(e, "new_connection")) {
        e.preventDefault();
        navigate("/connections", { state: { openNew: true } });
        return;
      }

      // Cmd/Ctrl+Shift+1–9: switch to Nth open connection (on Mac accept both ⌘ and Ctrl)
      // Use e.code (layout-independent) instead of e.key, because Shift+1 gives "!" not "1"
      const modifierHeld = isMac ? (e.metaKey || e.ctrlKey) : e.ctrlKey;
      if (modifierHeld && e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
        const idx = parseInt(e.code.slice(-1), 10) - 1;
        const conn = openConnections[idx];
        if (conn) {
          e.preventDefault();
          handleSwitch(conn.id);
          navigate("/editor");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [matchesShortcut, isMac, navigate, openConnections, handleSwitch]);
}
