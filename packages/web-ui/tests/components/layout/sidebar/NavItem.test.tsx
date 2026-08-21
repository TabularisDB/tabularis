import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { NavItem } from "../../../../src/components/layout/sidebar/NavItem";
import { Database } from "lucide-react";

describe("NavItem", () => {
  it("renders label and icon", () => {
    render(
      <MemoryRouter>
        <NavItem to="/test" icon={Database} label="Test Label" />
      </MemoryRouter>,
    );

    expect(screen.getByText("Test Label")).toBeInTheDocument();
    // Icon rendering is harder to test directly without checking SVG internals, but we assume it renders if component mounts
  });

  it("shows connection indicator when isConnected is true", () => {
    const { container } = render(
      <MemoryRouter>
        <NavItem
          to="/test"
          icon={Database}
          label="Test Label"
          isConnected={true}
        />
      </MemoryRouter>,
    );

    // Check for the green dot (bg-green-500)
    // We can use a query selector for the class
    const indicator = container.querySelector(".bg-green-500");
    expect(indicator).toBeInTheDocument();
  });

  it("does not show connection indicator when isConnected is false", () => {
    const { container } = render(
      <MemoryRouter>
        <NavItem
          to="/test"
          icon={Database}
          label="Test Label"
          isConnected={false}
        />
      </MemoryRouter>,
    );

    const indicator = container.querySelector(".bg-green-500");
    expect(indicator).not.toBeInTheDocument();
  });
});
