import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {Accordion} from "../../../../src/components/layout/sidebar/Accordion";

describe("Accordion", () => {
  it("renders title correctly", () => {
    render(
      <Accordion title="Test Title" isOpen={false} onToggle={() => {}}>
        <div>Content</div>
      </Accordion>
    );
    expect(screen.getByText("Test Title")).toBeInTheDocument();
  });

  it("renders children when open", () => {
    render(
      <Accordion title="Test Title" isOpen={true} onToggle={() => {}}>
        <div data-testid="content">Content</div>
      </Accordion>
    );
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });

  it("does not render children when closed", () => {
    render(
      <Accordion title="Test Title" isOpen={false} onToggle={() => {}}>
        <div data-testid="content">Content</div>
      </Accordion>
    );
    expect(screen.queryByTestId("content")).not.toBeInTheDocument();
  });

  it("calls onToggle when clicked", () => {
    const onToggle = vi.fn();
    render(
      <Accordion title="Test Title" isOpen={false} onToggle={onToggle}>
        <div>Content</div>
      </Accordion>
    );

    fireEvent.click(screen.getByText("Test Title"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders actions if provided", () => {
    render(
      <Accordion
        title="Test Title"
        isOpen={false}
        onToggle={() => {}}
        actions={<button>Action</button>}
      >
        <div>Content</div>
      </Accordion>
    );
    expect(screen.getByText("Action")).toBeInTheDocument();
  });

  it("keeps actions in a padded lane away from the scrollbar edge", () => {
    render(
      <Accordion
        title="Test Title"
        isOpen={false}
        onToggle={() => {}}
        actions={<button>Action</button>}
      >
        <div>Content</div>
      </Accordion>
    );

    const actionLane = screen.getByText("Action").parentElement;
    expect(actionLane).toHaveClass("shrink-0");
    expect(actionLane).toHaveClass("pr-3");
  });
});
