import { fireEvent, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGlobalShortcuts } from "../../src/hooks/useGlobalShortcuts";

const navigateMock = vi.fn();
const togglePaletteMock = vi.fn();
let activeShortcutId = "command_palette_actions";
let locationMock = { pathname: "/editor", key: "abc123" };
const matchesShortcutMock = vi.fn(
  (_event: KeyboardEvent, id: string) => id === activeShortcutId,
);

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
  useLocation: () => locationMock,
}));

vi.mock("../../src/hooks/useKeybindings", () => ({
  useKeybindings: () => ({
    matchesShortcut: matchesShortcutMock,
    isMac: true,
  }),
}));

vi.mock("../../src/hooks/useConnectionManager", () => ({
  useConnectionManager: () => ({
    openConnections: [],
    handleSwitch: vi.fn(),
  }),
}));

vi.mock("../../src/hooks/useCommandPalette", () => ({
  useCommandPaletteDispatch: () => ({
    togglePalette: togglePaletteMock,
  }),
}));

describe("useGlobalShortcuts", () => {
  beforeEach(() => {
    navigateMock.mockClear();
    togglePaletteMock.mockClear();
    matchesShortcutMock.mockClear();
    activeShortcutId = "command_palette_actions";
    locationMock = { pathname: "/editor", key: "abc123" };
  });

  it("should open action search while focus is inside an input", () => {
    renderHook(() => useGlobalShortcuts());
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, {
      key: "a",
      metaKey: true,
      shiftKey: true,
    });

    expect(togglePaletteMock).toHaveBeenCalledWith("actions");
    input.remove();
  });

  it("ignores composing key events while focus is inside an input", () => {
    renderHook(() => useGlobalShortcuts());
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, {
      key: "a",
      metaKey: true,
      shiftKey: true,
      isComposing: true,
    });

    expect(togglePaletteMock).not.toHaveBeenCalled();
    input.remove();
  });

  it("ignores dead-key events while focus is inside an input", () => {
    renderHook(() => useGlobalShortcuts());
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, {
      key: "Dead",
      metaKey: true,
      shiftKey: true,
    });

    expect(togglePaletteMock).not.toHaveBeenCalled();
    input.remove();
  });

  it("should open object search through the shared palette controller", () => {
    activeShortcutId = "quick_navigator";
    renderHook(() => useGlobalShortcuts());

    fireEvent.keyDown(window, {
      key: "p",
      metaKey: true,
    });

    expect(togglePaletteMock).toHaveBeenCalledWith("objects");
  });

  it("should treat open settings as typing-safe and navigate", () => {
    activeShortcutId = "open_settings";
    renderHook(() => useGlobalShortcuts());
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, {
      key: ",",
      code: "Comma",
      metaKey: true,
    });

    expect(navigateMock).toHaveBeenCalledWith("/settings");
    input.remove();
  });

  it("should not add another history entry when settings are already open", () => {
    activeShortcutId = "open_settings";
    locationMock = { pathname: "/settings", key: "abc123" };
    renderHook(() => useGlobalShortcuts());

    const event = new KeyboardEvent("keydown", {
      key: ",",
      code: "Comma",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(navigateMock).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("should step back from settings instead of closing the window", () => {
    activeShortcutId = "close_tab";
    locationMock = { pathname: "/settings", key: "abc123" };
    renderHook(() => useGlobalShortcuts());

    const event = new KeyboardEvent("keydown", {
      key: "w",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(navigateMock).toHaveBeenCalledWith(-1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("should step back from settings while focus is inside an input", () => {
    activeShortcutId = "close_tab";
    locationMock = { pathname: "/settings", key: "abc123" };
    renderHook(() => useGlobalShortcuts());
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: "w", metaKey: true });

    expect(navigateMock).toHaveBeenCalledWith(-1);
    input.remove();
  });

  it("should send the user to connections when there is no history to step back to", () => {
    activeShortcutId = "close_tab";
    locationMock = { pathname: "/mcp", key: "default" };
    renderHook(() => useGlobalShortcuts());

    fireEvent.keyDown(window, { key: "w", metaKey: true });

    expect(navigateMock).toHaveBeenCalledWith("/connections");
  });

  it("should leave the close shortcut alone in the editor", () => {
    activeShortcutId = "close_tab";
    locationMock = { pathname: "/editor", key: "abc123" };
    renderHook(() => useGlobalShortcuts());

    const event = new KeyboardEvent("keydown", {
      key: "w",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(navigateMock).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("should leave the close shortcut alone on the connections screen", () => {
    activeShortcutId = "close_tab";
    locationMock = { pathname: "/connections", key: "abc123" };
    renderHook(() => useGlobalShortcuts());

    const event = new KeyboardEvent("keydown", {
      key: "w",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(navigateMock).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
