import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JsonCell } from "../../../src/components/ui/JsonCell";

const setScrollDims = (scrollWidth: number, clientWidth: number) => {
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get() {
      return scrollWidth;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return clientWidth;
    },
  });
};

describe("JsonCell", () => {
  beforeEach(() => {
    setScrollDims(100, 200);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseProps = {
    value: { a: 1 },
    displayText: '{"a":1}',
    isExpanded: false,
    isPendingDelete: false,
    onToggleExpand: vi.fn(),
    onOpenViewer: vi.fn(),
  };

  it("renders no icon buttons for null value", () => {
    render(<JsonCell {...baseProps} value={null} displayText="null" />);
    expect(
      screen.queryByRole("button", { name: /expand|viewer/i }),
    ).toBeNull();
  });

  it("renders both icon buttons when value is non-null", () => {
    render(<JsonCell {...baseProps} />);
    expect(screen.getByRole("button", { name: /expand/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /viewer/i })).toBeInTheDocument();
  });

  it("calls onOpenViewer when Braces button clicked", () => {
    const onOpenViewer = vi.fn();
    render(<JsonCell {...baseProps} onOpenViewer={onOpenViewer} />);
    fireEvent.click(screen.getByRole("button", { name: /viewer/i }));
    expect(onOpenViewer).toHaveBeenCalledTimes(1);
  });

  it("calls onToggleExpand when chevron clicked", () => {
    const onToggleExpand = vi.fn();
    render(<JsonCell {...baseProps} onToggleExpand={onToggleExpand} />);
    fireEvent.click(screen.getByRole("button", { name: /expand/i }));
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
  });

  it("applies rotated chevron class when expanded", () => {
    render(<JsonCell {...baseProps} isExpanded={true} />);
    const chevron = screen.getByRole("button", { name: /expand/i });
    expect(chevron.className).toMatch(/rotate-90/);
  });

  it("renders syntax-highlighted spans for the display text", () => {
    const { container } = render(<JsonCell {...baseProps} />);
    const keys = container.querySelectorAll('[data-token="key"]');
    expect(keys.length).toBeGreaterThan(0);
  });

  it("forces icons visible when content is truncated", () => {
    setScrollDims(500, 100);
    const { container } = render(<JsonCell {...baseProps} />);
    const cell = container.firstChild as HTMLElement;
    expect(cell.className).toMatch(/json-cell-truncated/);
  });

  it("renders only a bounded preview for very large JSON values", () => {
    // A multi-megabyte stringified value must not explode into the DOM.
    const huge = `{"items":[${Array.from({ length: 5000 }, (_, i) => `{"id":${i},"name":"item-${i}"}`).join(",")}]}`;
    const { container } = render(
      <JsonCell {...baseProps} value={{ big: true }} displayText={huge} />,
    );
    const previewSpan = container.querySelector(".truncate") as HTMLElement;
    // Rendered text stays bounded regardless of the source size.
    expect(previewSpan.textContent!.length).toBeLessThan(huge.length);
    expect(previewSpan.textContent!.length).toBeLessThan(400);
    // The trailing ellipsis signals there is more behind the viewer.
    expect(previewSpan.textContent).toContain("…");
  });

  it("keeps expand/viewer affordances visible when the preview is truncated", () => {
    setScrollDims(100, 200); // not visually overflowing…
    const huge = `"${"x".repeat(10000)}"`; // …but truncated by the length cap
    const { container } = render(
      <JsonCell {...baseProps} value={"x".repeat(10000)} displayText={huge} />,
    );
    const cell = container.firstChild as HTMLElement;
    expect(cell.className).toMatch(/json-cell-truncated/);
  });

  it("hides icons when isPendingDelete is true", () => {
    render(<JsonCell {...baseProps} isPendingDelete={true} />);
    expect(screen.queryByRole("button", { name: /expand/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /viewer/i })).toBeNull();
  });
});
