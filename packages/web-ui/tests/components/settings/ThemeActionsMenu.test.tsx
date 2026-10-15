import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Copy, Eye, Trash2 } from "lucide-react";
import { ThemeActionsMenu } from "../../../src/components/settings/ThemeActionsMenu";

vi.mock("lucide-react", async () => await vi.importActual("lucide-react"));

function renderMenu() {
  const select = vi.fn();
  render(<ThemeActionsMenu label="Theme actions" items={[
    { label: "Preview", icon: Eye, onSelect: select },
    { label: "Unavailable", icon: Copy, onSelect: select, disabled: true },
    { label: "Delete", icon: Trash2, onSelect: select, danger: true, separatorBefore: true },
  ]} />);
  return { select, trigger: screen.getByRole("button", { name: "Theme actions" }) };
}

describe("ThemeActionsMenu", () => {
  it("supports keyboard navigation, skips disabled items and restores focus on Escape", () => {
    const { trigger, select } = renderMenu();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const preview = screen.getByRole("menuitem", { name: "Preview" });
    const remove = screen.getByRole("menuitem", { name: "Delete" });
    expect(preview).toHaveFocus();
    fireEvent.keyDown(preview, { key: "ArrowDown" });
    expect(remove).toHaveFocus();
    fireEvent.keyDown(remove, { key: "Home" });
    expect(preview).toHaveFocus();
    fireEvent.keyDown(preview, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(select).not.toHaveBeenCalled();
  });

  it("uses one active item when switching between pointer and keyboard navigation", () => {
    const { trigger } = renderMenu();
    fireEvent.click(trigger);
    const preview = screen.getByRole("menuitem", { name: "Preview" });
    const remove = screen.getByRole("menuitem", { name: "Delete" });
    expect(preview).toHaveFocus();
    fireEvent.pointerMove(remove, { pointerType: "mouse" });
    expect(remove).toHaveFocus();
    expect(preview).not.toHaveClass("hover:bg-surface-secondary");
    fireEvent.keyDown(remove, { key: "ArrowUp" });
    expect(preview).toHaveFocus();
    fireEvent.pointerMove(screen.getByRole("menuitem", { name: "Unavailable" }), { pointerType: "mouse" });
    expect(preview).toHaveFocus();
  });

  it("runs an action once and closes the menu", () => {
    const { trigger, select } = renderMenu();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Preview" }));
    expect(select).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("dismisses on outside interaction without performing an action", () => {
    const { trigger, select } = renderMenu();
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(select).not.toHaveBeenCalled();
  });
});
