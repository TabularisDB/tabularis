import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeDialog } from "../../../src/components/ui/ThemeDialog";
import { ThemeDialogButton } from "../../../src/components/ui/ThemeDialogButton";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("lucide-react", async () => await vi.importActual("lucide-react"));

describe("ThemeDialog", () => {
  it("keeps the header and wrapping footer outside the scrollable body", () => {
    render(<ThemeDialog isOpen onClose={vi.fn()} title="Import theme" subtitle="Personal theme"
      footer={<ThemeDialogButton>Save</ThemeDialogButton>}><p>Long content</p></ThemeDialog>);
    const dialog = screen.getByRole("dialog", { name: "Import theme" });
    expect(dialog).toHaveAccessibleDescription("Personal theme");
    expect(dialog).toHaveClass("max-h-[90dvh]", "max-w-[calc(100vw-32px)]");
    expect(screen.getByText("Long content").parentElement).toHaveClass("overflow-y-auto", "min-h-0");
    expect(screen.getByRole("heading").closest(".overflow-y-auto")).toBeNull();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.closest(".overflow-y-auto")).toBeNull();
    expect(save.parentElement).toHaveClass("shrink-0", "flex-wrap");
  });

  it("contains focus while skipping hidden, disabled and negative-tabindex controls", () => {
    render(<ThemeDialog isOpen onClose={vi.fn()} title="Theme"
      footer={<ThemeDialogButton>Cancel</ThemeDialogButton>}>
      <input aria-label="Name" data-autofocus />
      <div hidden><button>Hidden</button></div>
      <fieldset disabled><button>Disabled by fieldset</button></fieldset>
      <button tabIndex={-1}>Programmatic focus only</button>
    </ThemeDialog>);
    expect(screen.getByLabelText("Name")).toHaveFocus();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(screen.getByRole("button", { name: "common.close" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(cancel).toHaveFocus();
  });

  it("blocks closing during an operation, but leaves explicit cancellation available", () => {
    const close = vi.fn(); const cancel = vi.fn();
    render(<ThemeDialog isOpen busy onClose={close} title="Installing"
      footer={<ThemeDialogButton onClick={cancel}>Cancel installation</ThemeDialogButton>}>Package</ThemeDialog>);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status", { name: "themePackages.loading" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.close" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel installation" }));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("restores the invoking control after initial field focus and Escape", () => {
    const trigger = document.createElement("button"); document.body.append(trigger); trigger.focus();
    const close = vi.fn();
    const view = render(<ThemeDialog isOpen onClose={close} title="Duplicate"><input aria-label="Name" data-autofocus /></ThemeDialog>);
    expect(screen.getByLabelText("Name")).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    view.unmount(); expect(trigger).toHaveFocus(); trigger.remove();
  });
});

describe("ThemeDialogButton", () => {
  it("disables repeat activation while busy and exposes its pending state", () => {
    const click = vi.fn();
    render(<ThemeDialogButton variant="primary" busy onClick={click}>Install</ThemeDialogButton>);
    const button = screen.getByRole("button", { name: "Install" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    fireEvent.click(button); expect(click).not.toHaveBeenCalled();
  });
});
