import { fireEvent, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGlobalShortcuts } from "../../src/hooks/useGlobalShortcuts";

const navigateMock = vi.fn();
const togglePaletteMock = vi.fn();
let activeShortcutId = "command_palette_actions";
const matchesShortcutMock = vi.fn(
  (_event: KeyboardEvent, id: string) => id === activeShortcutId,
);

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
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
});
