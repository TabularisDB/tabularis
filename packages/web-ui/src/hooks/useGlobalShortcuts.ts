import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useCommandPaletteDispatch } from "./useCommandPalette";
import { useConnectionManager } from "./useConnectionManager";
import { useKeybindings } from "./useKeybindings";

/** Shortcuts that must still fire while the user is typing in a field. */
const TYPING_SAFE_SHORTCUTS = [
  "quick_navigator",
  "command_palette_actions",
  "focus_table_filter",
];

/**
 * Registers global keyboard shortcuts for navigation.
 * Must be called inside a component that is a child of KeybindingsProvider,
 * BrowserRouter and CommandPaletteProvider.
 */
export function useGlobalShortcuts() {
  const navigate = useNavigate();
  const { matchesShortcut, isMac } = useKeybindings();
  const { openConnections, handleSwitch } = useConnectionManager();
  const { togglePalette } = useCommandPaletteDispatch();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTypingTarget =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (
        isTypingTarget &&
        !TYPING_SAFE_SHORTCUTS.some((id) => matchesShortcut(e, id))
      ) {
        return;
      }

      if (matchesShortcut(e, "toggle_sidebar")) {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("tabularis:toggle-sidebar"),
        );
        return;
      }

      if (matchesShortcut(e, "toggle_right_sidebar")) {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("tabularis:toggle-right-sidebar"),
        );
        return;
      }

      if (matchesShortcut(e, "focus_table_filter")) {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("tabularis:focus-table-filter"),
        );
        return;
      }

      if (matchesShortcut(e, "paste_import_clipboard")) {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("tabularis:paste-import"),
        );
        return;
      }

      if (matchesShortcut(e, "quick_navigator")) {
        e.preventDefault();
        togglePalette("objects");
        return;
      }

      if (matchesShortcut(e, "command_palette_actions")) {
        e.preventDefault();
        togglePalette("actions");
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
      const modifierHeld = isMac ? e.metaKey || e.ctrlKey : e.ctrlKey;
      if (
        modifierHeld &&
        e.shiftKey &&
        /^Digit[1-9]$/.test(e.code)
      ) {
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
  }, [
    matchesShortcut,
    isMac,
    navigate,
    openConnections,
    handleSwitch,
    togglePalette,
  ]);
}
