import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Chip } from "../../../src/components/ui/Chip";
import { CountBadge } from "../../../src/components/ui/CountBadge";

describe("Chip", () => {
  it("renders a neutral rounded attribute chip by default", () => {
    render(<Chip>postgresql</Chip>);
    const chip = screen.getByText("postgresql");
    expect(chip).toHaveClass("rounded-md", "text-[10px]", "font-semibold", "bg-surface-secondary");
    expect(chip.style.backgroundColor).toBe("");
  });

  it("tints toned chips inline and supports pill shape, dot and uppercase", () => {
    render(<Chip tone="success" shape="pill" dot="pulse" uppercase>Active</Chip>);
    const chip = screen.getByText("Active");
    expect(chip).toHaveClass("rounded-full", "uppercase");
    expect(chip.style.backgroundColor).toContain("var(--accent-success)");
    expect(chip.querySelector(".animate-pulse")).toHaveClass("bg-accent-success");
  });

  it("supports the small size used for inline counters and merges custom styles", () => {
    render(<Chip tone="warning" size="sm" style={{ opacity: 0.5 }}>Deprecated</Chip>);
    const chip = screen.getByText("Deprecated");
    expect(chip).toHaveClass("text-[9px]", "py-px");
    expect(chip.style.opacity).toBe("0.5");
    expect(chip.style.color).toContain("var(--accent-warning)");
  });
});

describe("CountBadge", () => {
  it("hides itself for zero and renders a compact pill otherwise", () => {
    const { container, rerender } = render(<CountBadge count={0} tone="update" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CountBadge count={3} tone="update" aria-label="3 updates" />);
    const badge = screen.getByLabelText("3 updates");
    expect(badge).toHaveTextContent("3");
    expect(badge).toHaveClass("rounded-full", "h-4", "min-w-4");
    expect(badge.style.backgroundColor).toContain("var(--accent-primary)");
  });

  it("falls back to neutral surface classes", () => {
    render(<CountBadge count={12} />);
    expect(screen.getByText("12")).toHaveClass("bg-surface-secondary");
  });
});
