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
      // Command palette must work everywhere, including inside inputs.
      // Why: SQL editors and search fields are exactly where users want it.
      if (matchesShortcut(e, "command_palette")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("tabularis:open-command-palette"));
        return;
      }

      // Other shortcuts skip when typing in inputs / textareas / contenteditable
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if (matchesShortcut(e, "toggle_sidebar")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("tabularis:toggle-sidebar"));
        return;
      }

      if (matchesShortcut(e, "toggle_right_panel")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("tabularis:toggle-right-panel"));
        return;
      }

      if (matchesShortcut(e, "paste_import_clipboard")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("tabularis:paste-import"));
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

      if (matchesShortcut(e, "open_settings")) {
        e.preventDefault();
        navigate("/settings");
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
