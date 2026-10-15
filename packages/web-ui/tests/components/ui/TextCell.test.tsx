import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TextCell } from "../../../src/components/ui/TextCell";

describe("TextCell image preview for SVG", () => {
  it("renders plain text without hover tooltip for non-SVG strings", () => {
    render(
      <TextCell
        value="hello world"
        displayText="hello world"
        isExpanded={false}
        isPendingDelete={false}
        onToggleExpand={() => {}}
      />,
    );

    expect(screen.getByText("hello world")).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows image preview hover on mouse enter for SVG strings", () => {
    const svg = '<svg width="50" height="50"><rect width="50" height="50" /></svg>';
    render(
      <TextCell
        value={svg}
        displayText={svg}
        isExpanded={false}
        isPendingDelete={false}
        onToggleExpand={() => {}}
      />,
    );

    const trigger = screen.getByText(/<svg/);
    fireEvent.mouseEnter(trigger);

    const img = screen.getByRole("img", { name: /blobInput\.imagePreview|Image preview/ });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute(
      "src",
      `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    );

    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole("img", { name: /blobInput\.imagePreview|Image preview/ })).not.toBeInTheDocument();
  });
});
