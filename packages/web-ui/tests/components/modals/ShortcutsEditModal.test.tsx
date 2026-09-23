import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ShortcutsEditModal } from "../../../src/components/modals/ShortcutsEditModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("lucide-react", () => ({
  Keyboard: () => null,
  Loader2: () => null,
  X: () => null,
}));

describe("ShortcutsEditModal", () => {
  const renderOpenModal = (onClose = vi.fn()) => {
    render(
      <ShortcutsEditModal
        isOpen
        label="Open settings"
        current="⌘+,"
        isMac
        onClose={onClose}
        onSave={vi.fn()}
      />,
    );
    return { onClose };
  };

  it("should not render while closed", () => {
    render(
      <ShortcutsEditModal
        isOpen={false}
        label="Open settings"
        current="⌘+,"
        isMac
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("should leave an unmodified Tab key available for focus navigation", () => {
    renderOpenModal();
    const recorder = screen.getByRole("button", {
      name: "settings.shortcuts.pressKeys",
    });

    expect(fireEvent.keyDown(recorder, { key: "Tab", code: "Tab" })).toBe(
      true,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("should wrap focus backward from the first control", () => {
    renderOpenModal();
    const close = screen.getByRole("button", { name: "common.close" });
    close.focus();

    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });

    expect(screen.getByRole("button", { name: "common.cancel" })).toHaveFocus();
  });

  it("should wrap focus forward from the last enabled control", () => {
    renderOpenModal();
    const recorder = screen.getByRole("button", {
      name: "settings.shortcuts.pressKeys",
    });
    fireEvent.keyDown(recorder, {
      key: "k",
      code: "KeyK",
      metaKey: true,
    });
    const save = screen.getByRole("button", { name: "common.save" });
    save.focus();

    fireEvent.keyDown(save, { key: "Tab" });

    expect(screen.getByRole("button", { name: "common.close" })).toHaveFocus();
  });

  it("should close on Escape after focus leaves the recorder", () => {
    const onClose = vi.fn();
    renderOpenModal(onClose);
    const cancel = screen.getByRole("button", { name: "common.cancel" });
    cancel.focus();

    fireEvent.keyDown(cancel, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("should close when the backdrop is clicked", () => {
    const onClose = vi.fn();
    renderOpenModal(onClose);

    fireEvent.click(screen.getByRole("presentation"));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("should ignore shortcuts while an IME composition is active", () => {
    renderOpenModal();
    const recorder = screen.getByRole("button", {
      name: "settings.shortcuts.pressKeys",
    });

    fireEvent.keyDown(recorder, {
      key: "a",
      code: "KeyA",
      ctrlKey: true,
      isComposing: true,
    });

    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
  });
});
