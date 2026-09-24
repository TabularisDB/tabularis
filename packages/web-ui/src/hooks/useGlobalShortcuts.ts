import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { connectionIndexFromShortcut } from "../utils/keybindings";
import { useCommandPaletteDispatch } from "./useCommandPalette";
import { useConnectionManager } from "./useConnectionManager";
import { useKeybindings } from "./useKeybindings";
import { isTextCompositionKeyEvent } from "../utils/keyboardEvents";

/** Shortcuts that must still fire while the user is typing in a field. */
const TYPING_SAFE_SHORTCUTS = [
  "quick_navigator",
  "command_palette_actions",
  "focus_table_filter",
  "open_settings",
  "close_tab",
];

/**
 * Routes where the close shortcut steps back instead of closing the window.
 * The editor binds it to its own tabs, and /connections is the start screen,
 * so there it stays the window close the platform expects.
 */
const BACKABLE_ROUTES = new Set(["/settings", "/mcp"]);

/**
 * Registers global keyboard shortcuts for navigation.
 * Must be called inside a component that is a child of KeybindingsProvider,
 * BrowserRouter and CommandPaletteProvider.
 */
export function useGlobalShortcuts() {
  const navigate = useNavigate();
  const { pathname, key: historyKey } = useLocation();
  const { matchesShortcut, isMac } = useKeybindings();
  const { openConnections, handleSwitch } = useConnectionManager();
  const { togglePalette } = useCommandPaletteDispatch();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTextCompositionKeyEvent(e)) return;

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

      if (matchesShortcut(e, "open_settings")) {
        e.preventDefault();
        if (pathname !== "/settings") navigate("/settings");
        return;
      }

      if (
        BACKABLE_ROUTES.has(pathname) &&
        matchesShortcut(e, "close_tab")
      ) {
        e.preventDefault();
        // A "default" key means the app started on this route, so there is
        // nothing to step back to.
        if (historyKey === "default") {
          navigate("/connections");
        } else {
          navigate(-1);
        }
        return;
      }

      if (matchesShortcut(e, "new_connection")) {
        e.preventDefault();
        navigate("/connections", { state: { openNew: true } });
        return;
      }

      const connectionIndex = connectionIndexFromShortcut(e, isMac);
      if (connectionIndex !== null) {
        const conn = openConnections[connectionIndex];
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
    pathname,
    historyKey,
    openConnections,
    handleSwitch,
    togglePalette,
  ]);
}
