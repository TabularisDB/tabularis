import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RailIndicator } from "../../../../src/components/layout/sidebar/RailIndicator";

describe("RailIndicator", () => {
  it("renders the full pill when active", () => {
    render(<RailIndicator isActive={true} />);

    const indicator = screen.getByTestId("rail-indicator");
    expect(indicator).toHaveClass("h-8", "opacity-100");
    expect(indicator).not.toHaveClass("group-hover:opacity-100");
  });

  it("renders the short hover-only pill when inactive", () => {
    render(<RailIndicator isActive={false} />);

    const indicator = screen.getByTestId("rail-indicator");
    expect(indicator).toHaveClass("h-4", "opacity-0", "group-hover:opacity-100");
    expect(indicator).not.toHaveClass("h-8");
  });

  it("defaults to left-0 positioning", () => {
    render(<RailIndicator isActive={false} />);

    expect(screen.getByTestId("rail-indicator")).toHaveClass("left-0");
  });

  it("applies custom positioning classes", () => {
    render(<RailIndicator isActive={false} className="-left-2" />);

    const indicator = screen.getByTestId("rail-indicator");
    expect(indicator).toHaveClass("-left-2");
    expect(indicator).not.toHaveClass("left-0");
  });
});
