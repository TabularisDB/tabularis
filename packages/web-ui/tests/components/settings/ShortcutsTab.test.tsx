import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShortcutsTab } from "../../../src/components/settings/ShortcutsTab";
import type { UserOverrides } from "../../../src/utils/keybindings";

const saveOverrideMock = vi.fn().mockResolvedValue(undefined);
const resetOverrideMock = vi.fn().mockResolvedValue(undefined);
const showAlertMock = vi.fn();
let isMacMock = true;
let overridesMock: UserOverrides = {};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { shortcut?: string }) =>
      options?.shortcut ? `${key}: ${options.shortcut}` : key,
  }),
}));

vi.mock("../../../src/hooks/useAlert", () => ({
  useAlert: () => ({ showAlert: showAlertMock }),
}));

vi.mock("lucide-react", () => {
  const Icon = () => null;
  return {
    Keyboard: Icon,
    Loader2: Icon,
    Lock: Icon,
    RotateCcw: Icon,
    X: Icon,
  };
});

vi.mock("../../../src/hooks/useKeybindings", () => ({
  useKeybindings: () => ({
    shortcuts: [
      {
        id: "open_settings",
        category: "navigation",
        defaultMac: "⌘+,",
        defaultWin: "Ctrl+,",
        macMatch: { metaKey: true, key: ",", code: "Comma" },
        winMatch: { ctrlKey: true, key: ",", code: "Comma" },
        match: isMacMock
          ? { metaKey: true, key: ",", code: "Comma" }
          : { ctrlKey: true, key: ",", code: "Comma" },
        i18nKey: "settings.shortcuts.openSettings",
        overridable: true,
      },
      {
        id: "quick_navigator",
        category: "navigation",
        defaultMac: "⌘+P",
        defaultWin: "Ctrl+P",
        macMatch: { metaKey: true, key: "p", code: "KeyP" },
        winMatch: { ctrlKey: true, key: "p", code: "KeyP" },
        match: isMacMock
          ? (overridesMock.quick_navigator?.mac ?? {
              metaKey: true,
              key: "p",
              code: "KeyP",
            })
          : (overridesMock.quick_navigator?.win ?? {
              ctrlKey: true,
              key: "p",
              code: "KeyP",
            }),
        i18nKey: "settings.shortcuts.quickNavigator",
        overridable: true,
      },
      {
        id: "toggle_sidebar",
        category: "navigation",
        defaultMac: "⌘+B",
        defaultWin: "Ctrl+B",
        macMatch: { metaKey: true, key: "b", code: "KeyB" },
        winMatch: { ctrlKey: true, key: "b", code: "KeyB" },
        match: isMacMock
          ? (overridesMock.toggle_sidebar?.mac ?? {
              metaKey: true,
              key: "b",
              code: "KeyB",
            })
          : (overridesMock.toggle_sidebar?.win ?? {
              ctrlKey: true,
              key: "b",
              code: "KeyB",
            }),
        i18nKey: "settings.shortcuts.toggleSidebar",
        overridable: true,
      },
      {
        id: "run_all_editor",
        category: "editor",
        defaultMac: "⌘+Shift+Enter",
        defaultWin: "Ctrl+Shift+Enter",
        macMatch: { metaKey: true, shiftKey: true, key: "Enter" },
        winMatch: { ctrlKey: true, shiftKey: true, key: "Enter" },
        match: isMacMock
          ? { metaKey: true, shiftKey: true, key: "Enter" }
          : { ctrlKey: true, shiftKey: true, key: "Enter" },
        i18nKey: "settings.shortcuts.runAllEditor",
        overridable: true,
      },
      {
        id: "refresh_table",
        category: "data_grid",
        defaultMac: "⌘+R",
        defaultWin: "Ctrl+R",
        macMatch: { metaKey: true, key: "r" },
        winMatch: { ctrlKey: true, key: "r" },
        match: isMacMock
          ? { metaKey: true, key: "r" }
          : { ctrlKey: true, key: "r" },
        i18nKey: "settings.shortcuts.refreshTable",
        overridable: true,
      },
      {
        id: "notebook_run_all",
        category: "notebook",
        defaultMac: "⌘+Shift+Enter",
        defaultWin: "Ctrl+Shift+Enter",
        macMatch: { metaKey: true, shiftKey: true, key: "Enter" },
        winMatch: { ctrlKey: true, shiftKey: true, key: "Enter" },
        match: isMacMock
          ? { metaKey: true, shiftKey: true, key: "Enter" }
          : { ctrlKey: true, shiftKey: true, key: "Enter" },
        i18nKey: "settings.shortcuts.notebookRunAll",
        overridable: true,
      },
      {
        id: "switch_connection",
        category: "navigation",
        defaultMac: "⌘+Shift+1–9",
        defaultWin: "Ctrl+Shift+1–9",
        macMatch: { metaKey: true, shiftKey: true, key: "1" },
        winMatch: { ctrlKey: true, shiftKey: true, key: "1" },
        match: isMacMock
          ? { metaKey: true, shiftKey: true, key: "1" }
          : { ctrlKey: true, shiftKey: true, key: "1" },
        i18nKey: "settings.shortcuts.switchConnection",
        overridable: false,
      },
    ],
    saveOverride: saveOverrideMock,
    resetOverride: resetOverrideMock,
    overrides: overridesMock,
    isMac: isMacMock,
  }),
}));

function editShortcut(label: string) {
  const row = screen.getByText(label).parentElement?.parentElement;
  if (!row) throw new Error(`Missing shortcut row: ${label}`);
  fireEvent.click(within(row).getByRole("button", { name: "common.edit" }));
}

function openShortcutEditor(
  label = "settings.shortcuts.openSettings",
): HTMLElement {
  render(<ShortcutsTab />);
  editShortcut(label);
  return screen.getByRole("button", {
    name: "settings.shortcuts.pressKeys",
  });
}

function recordShortcut(
  event: KeyboardEventInit,
  label?: string,
): HTMLElement {
  const recorder = openShortcutEditor(label);
  fireEvent.keyDown(recorder, event);
  return recorder;
}

function saveRecordedShortcut() {
  fireEvent.click(screen.getByRole("button", { name: "common.save" }));
}

describe("ShortcutsTab", () => {
  beforeEach(() => {
    saveOverrideMock.mockReset().mockResolvedValue(undefined);
    resetOverrideMock.mockReset().mockResolvedValue(undefined);
    showAlertMock.mockClear();
    isMacMock = true;
    overridesMock = {};
  });

  it("should expose the shortcut editor as a labelled dialog", () => {
    openShortcutEditor();

    const dialog = screen.getByRole("dialog", {
      name: "settings.shortcuts.openSettings",
    });
    expect(
      within(dialog).getByRole("button", { name: "common.close" }),
    ).toBeInTheDocument();
  });

  it("should preserve the physical key code in a recorded override", async () => {
    recordShortcut({ key: ",", code: "Comma", metaKey: true });
    saveRecordedShortcut();

    await waitFor(() =>
      expect(saveOverrideMock).toHaveBeenCalledWith(
        "open_settings",
        { key: ",", code: "Comma", metaKey: true },
        { ctrlKey: true, key: ",", code: "Comma" },
      ),
    );
  });

  it("should report a save failure and keep the editor open", async () => {
    saveOverrideMock.mockRejectedValueOnce(new Error("disk full"));
    recordShortcut({ key: ",", code: "Comma", metaKey: true });

    saveRecordedShortcut();

    await waitFor(() =>
      expect(showAlertMock).toHaveBeenCalledWith("Error: disk full", {
        title: "common.error",
        kind: "error",
      }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.save" })).toBeEnabled();
  });

  it("should report a reset failure", async () => {
    overridesMock = {
      open_settings: {
        mac: { metaKey: true, key: "k", code: "KeyK" },
        win: { ctrlKey: true, key: "k", code: "KeyK" },
      },
    };
    resetOverrideMock.mockRejectedValueOnce(new Error("read only"));
    render(<ShortcutsTab />);

    fireEvent.click(screen.getByTitle("settings.shortcuts.resetToDefault"));

    await waitFor(() =>
      expect(showAlertMock).toHaveBeenCalledWith("Error: read only", {
        title: "common.error",
        kind: "error",
      }),
    );
  });

  it("should preserve an existing override for the other platform", async () => {
    overridesMock = {
      open_settings: {
        mac: { metaKey: true, key: "," },
        win: { ctrlKey: true, key: "k", code: "KeyK" },
      },
    };
    recordShortcut({ key: ",", code: "Comma", metaKey: true });
    saveRecordedShortcut();

    await waitFor(() =>
      expect(saveOverrideMock).toHaveBeenCalledWith(
        "open_settings",
        { key: ",", code: "Comma", metaKey: true },
        { ctrlKey: true, key: "k", code: "KeyK" },
      ),
    );
  });

  it("should preserve the untouched macOS binding when recording on Windows", async () => {
    isMacMock = false;
    recordShortcut({ key: ",", code: "Comma", ctrlKey: true });
    saveRecordedShortcut();

    await waitFor(() =>
      expect(saveOverrideMock).toHaveBeenCalledWith(
        "open_settings",
        { metaKey: true, key: ",", code: "Comma" },
        { key: ",", code: "Comma", ctrlKey: true },
      ),
    );
  });

  it("should reject an override that overlaps another shortcut alias", async () => {
    recordShortcut({ key: "p", code: "KeyP", metaKey: true });
    saveRecordedShortcut();

    await waitFor(() =>
      expect(showAlertMock).toHaveBeenCalledWith(
        "settings.shortcuts.conflict: settings.shortcuts.quickNavigator",
        { title: "common.error", kind: "error" },
      ),
    );
    expect(saveOverrideMock).not.toHaveBeenCalled();
  });

  it("should reject a shortcut in the reserved connection-switch range", async () => {
    recordShortcut({
      key: "@",
      code: "Digit2",
      metaKey: true,
      shiftKey: true,
    });
    saveRecordedShortcut();

    await waitFor(() =>
      expect(showAlertMock).toHaveBeenCalledWith(
        "settings.shortcuts.conflict: settings.shortcuts.switchConnection",
        { title: "common.error", kind: "error" },
      ),
    );
    expect(saveOverrideMock).not.toHaveBeenCalled();
  });

  it("should reject an editor override that shadows a data-grid shortcut", async () => {
    recordShortcut(
      { key: "r", code: "KeyR", metaKey: true },
      "settings.shortcuts.runAllEditor",
    );
    saveRecordedShortcut();

    await waitFor(() =>
      expect(showAlertMock).toHaveBeenCalledWith(
        "settings.shortcuts.conflict: settings.shortcuts.refreshTable",
        { title: "common.error", kind: "error" },
      ),
    );
    expect(saveOverrideMock).not.toHaveBeenCalled();
  });

  it("should allow saving the edited shortcut's own default", async () => {
    recordShortcut(
      { key: "Enter", code: "Enter", metaKey: true, shiftKey: true },
      "settings.shortcuts.runAllEditor",
    );
    saveRecordedShortcut();

    await waitFor(() =>
      expect(saveOverrideMock).toHaveBeenCalledWith(
        "run_all_editor",
        { key: "Enter", code: "Enter", metaKey: true, shiftKey: true },
        { ctrlKey: true, shiftKey: true, key: "Enter" },
      ),
    );
    expect(showAlertMock).not.toHaveBeenCalled();
  });

  it("should reject an own default claimed by another override", async () => {
    overridesMock = {
      quick_navigator: {
        mac: { metaKey: true, key: "b", code: "KeyB" },
        win: { ctrlKey: true, key: "b", code: "KeyB" },
      },
    };
    recordShortcut(
      { key: "b", code: "KeyB", metaKey: true },
      "settings.shortcuts.toggleSidebar",
    );
    saveRecordedShortcut();

    await waitFor(() =>
      expect(showAlertMock).toHaveBeenCalledWith(
        "settings.shortcuts.conflict: settings.shortcuts.quickNavigator",
        { title: "common.error", kind: "error" },
      ),
    );
    expect(saveOverrideMock).not.toHaveBeenCalled();
  });

  it("should reject a non-default notebook shortcut that conflicts with the data grid", async () => {
    recordShortcut(
      { key: "r", code: "KeyR", metaKey: true },
      "settings.shortcuts.notebookRunAll",
    );
    saveRecordedShortcut();

    await waitFor(() =>
      expect(showAlertMock).toHaveBeenCalledWith(
        "settings.shortcuts.conflict: settings.shortcuts.refreshTable",
        { title: "common.error", kind: "error" },
      ),
    );
    expect(saveOverrideMock).not.toHaveBeenCalled();
  });

  it("should render notebook shortcuts in their own category", () => {
    render(<ShortcutsTab />);

    expect(
      screen.getByText("settings.shortcuts.notebookRunAll"),
    ).toBeInTheDocument();
  });

  it("should refuse a combination without a modifier", () => {
    recordShortcut({ key: "s", code: "KeyS" });

    expect(
      screen.getByText("settings.shortcuts.needsModifier"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
  });

  it("should refuse a Windows Meta shortcut instead of saving a bare key", () => {
    isMacMock = false;
    recordShortcut({ key: "k", code: "KeyK", metaKey: true });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "settings.shortcuts.needsModifier",
    );
    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
  });

  it("should discard a recorded combination when a bare key follows", () => {
    const recorder = recordShortcut({
      key: ",",
      code: "Comma",
      metaKey: true,
    });
    expect(screen.getByRole("button", { name: "common.save" })).toBeEnabled();

    fireEvent.keyDown(recorder, { key: "s", code: "KeyS" });

    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
    expect(
      screen.getByText("settings.shortcuts.needsModifier"),
    ).toBeInTheDocument();
  });

  it.each([
    { name: "AltGr on a German layout", key: "@", code: "KeyQ", ctrlKey: true, altKey: true },
    { name: "Option on macOS", key: "ç", code: "KeyC", altKey: true },
    { name: "a dead key used for text composition", key: "Dead", code: "Quote", altKey: true },
    { name: "a bare function key", key: "F5", code: "F5" },
  ])("should refuse $name", ({ key, code, ctrlKey, altKey }) => {
    recordShortcut({ key, code, ctrlKey, altKey });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "settings.shortcuts.needsModifier",
    );
    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
  });

  it.each([
    { name: "Ctrl+Alt with a non-printing key", key: "ArrowUp", code: "ArrowUp", ctrlKey: true, altKey: true },
    { name: "Alt with a non-printing key", key: "Enter", code: "Enter", altKey: true },
  ])("should accept $name", async ({ key, code, ctrlKey, altKey }) => {
    recordShortcut({ key, code, ctrlKey, altKey });

    expect(screen.queryByRole("alert")).toBeNull();
    saveRecordedShortcut();
    await waitFor(() => expect(saveOverrideMock).toHaveBeenCalled());
  });

  it("should accept a modifier combination after a rejection", async () => {
    const recorder = openShortcutEditor();
    fireEvent.keyDown(recorder, { key: "s", code: "KeyS" });
    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();

    fireEvent.keyDown(recorder, { key: ",", code: "Comma", metaKey: true });

    expect(screen.queryByRole("alert")).toBeNull();
    saveRecordedShortcut();
    await waitFor(() => expect(saveOverrideMock).toHaveBeenCalled());
    expect(showAlertMock).not.toHaveBeenCalled();
  });
});
