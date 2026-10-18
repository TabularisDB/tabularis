import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MetadataErrorIndicator } from "../../../../src/components/layout/sidebar/MetadataErrorIndicator";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const renderInClippingRow = (onRowClick = vi.fn()) => {
  const utils = render(
    // Mirrors a sidebar row: overflow hidden and clickable.
    <div data-testid="row" style={{ overflow: "hidden" }} onClick={onRowClick}>
      <MetadataErrorIndicator
        error="Routine metadata unavailable"
        title="Routine metadata error"
      />
    </div>,
  );
  const trigger = screen.getByRole("button", { name: "sidebar.errorDetails" });
  return { ...utils, trigger, onRowClick };
};

describe("MetadataErrorIndicator", () => {
  it("shows error details and copies them", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <MetadataErrorIndicator
        error="Routine metadata unavailable"
        title="Routine metadata error"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "sidebar.errorDetails" }));
    expect(screen.getByText("Routine metadata unavailable")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "common.copy" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("Routine metadata unavailable");
      expect(screen.getByRole("button", { name: "common.copied" })).toBeVisible();
    });
  });

  it("portals the dialog out of the clipping row and labels it", () => {
    const { trigger } = renderInClippingRow();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Routine metadata error" });
    expect(screen.getByTestId("row")).not.toContainElement(dialog);
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog).toHaveClass("fixed");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", dialog.id);
    expect(dialog).toHaveFocus();
  });

  it("keeps clicks inside the portaled dialog away from the row", () => {
    const { trigger, onRowClick } = renderInClippingRow();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "common.copy" }));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    const { trigger } = renderInClippingRow();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on an outside mousedown", () => {
    const { trigger } = renderInClippingRow();
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when focus leaves the dialog", () => {
    const { trigger } = renderInClippingRow();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    fireEvent.click(trigger);
    fireEvent.focusOut(screen.getByRole("dialog"), { relatedTarget: outside });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    outside.remove();
  });

  it("toggles closed from the trigger", () => {
    const { trigger } = renderInClippingRow();
    fireEvent.click(trigger);
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
