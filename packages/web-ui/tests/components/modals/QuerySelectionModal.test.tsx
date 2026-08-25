import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuerySelectionModal } from "../../../src/components/modals/QuerySelectionModal";

// Mock the Modal component to just render children
vi.mock("../../../src/components/ui/Modal", () => ({
  Modal: ({
    isOpen,
    children,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
  }) => (isOpen ? <div data-testid="modal">{children}</div> : null),
}));

describe("QuerySelectionModal", () => {
  const queries = ["SELECT * FROM users", "SELECT * FROM posts", "SELECT 1"];
  const mockOnSelect = vi.fn();
  const mockOnRunAll = vi.fn();
  const mockOnRunSelected = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderModal = (isOpen = true) =>
    render(
      <QuerySelectionModal
        isOpen={isOpen}
        queries={queries}
        onSelect={mockOnSelect}
        onRunAll={mockOnRunAll}
        onRunSelected={mockOnRunSelected}
        onClose={mockOnClose}
      />,
    );

  it("does not render when isOpen is false", () => {
    renderModal(false);
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  it("renders all queries when open", () => {
    renderModal();
    expect(screen.getByText("SELECT * FROM users")).toBeInTheDocument();
    expect(screen.getByText("SELECT * FROM posts")).toBeInTheDocument();
    expect(screen.getByText("SELECT 1")).toBeInTheDocument();
  });

  it("renders the title", () => {
    renderModal();
    expect(
      screen.getByText("editor.querySelection.title"),
    ).toBeInTheDocument();
  });

  it("renders query count in header", () => {
    renderModal();
    expect(
      screen.getByText(/editor\.querySelection\.queriesFound/),
    ).toBeInTheDocument();
  });

  it("renders Run All button", () => {
    renderModal();
    expect(
      screen.getByText("editor.querySelection.runAll"),
    ).toBeInTheDocument();
  });

  it("renders Run Selected button", () => {
    renderModal();
    expect(
      screen.getByText(/editor\.querySelection\.runSelected/),
    ).toBeInTheDocument();
  });

  it("calls onRunAll with all queries when Run All is clicked", () => {
    renderModal();
    fireEvent.click(screen.getByText("editor.querySelection.runAll"));
    expect(mockOnRunAll).toHaveBeenCalledWith(queries);
  });

  it("calls onClose when close button is clicked", () => {
    renderModal();
    // Close button is the first button in the header (next to title)
    const title = screen.getByText("editor.querySelection.title");
    const header = title.closest("div")!.parentElement!;
    const closeBtn = header.querySelector("button");
    expect(closeBtn).not.toBeNull();
    fireEvent.click(closeBtn!);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("calls onSelect when clicking on a query text", () => {
    renderModal();
    fireEvent.click(screen.getByText("SELECT * FROM users"));
    expect(mockOnSelect).toHaveBeenCalledWith("SELECT * FROM users");
  });

  it("Run Selected is disabled when no queries are selected", () => {
    renderModal();
    const runSelectedBtn = screen
      .getByText(/editor\.querySelection\.runSelected/)
      .closest("button");
    expect(runSelectedBtn).toBeDisabled();
  });

  it("calls onRunAll on Ctrl+Enter keydown", () => {
    renderModal();
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    expect(mockOnRunAll).toHaveBeenCalledWith(queries);
  });

  it("calls onSelect on Enter keydown (single query)", () => {
    renderModal();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(mockOnSelect).toHaveBeenCalledWith("SELECT * FROM users");
  });

  it("navigates focus with arrow keys", () => {
    renderModal();
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(mockOnSelect).toHaveBeenCalledWith("SELECT * FROM posts");
  });

  it("selects query by number key", () => {
    renderModal();
    fireEvent.keyDown(window, { key: "2" });
    expect(mockOnSelect).toHaveBeenCalledWith("SELECT * FROM posts");
  });

  it("toggles checkbox selection with Space key", () => {
    renderModal();
    fireEvent.keyDown(window, { key: " " });
    const runSelectedBtn = screen
      .getByText(/editor\.querySelection\.runSelected/)
      .closest("button");
    expect(runSelectedBtn).not.toBeDisabled();
    fireEvent.click(runSelectedBtn!);
    expect(mockOnRunSelected).toHaveBeenCalledWith(["SELECT * FROM users"]);
  });

  it("shows Select All toggle", () => {
    renderModal();
    expect(
      screen.getByText("editor.querySelection.selectAll"),
    ).toBeInTheDocument();
  });

  it("toggles all selections when Select All is clicked", () => {
    renderModal();
    fireEvent.click(screen.getByText("editor.querySelection.selectAll"));
    expect(
      screen.getByText("editor.querySelection.deselectAll"),
    ).toBeInTheDocument();
    const runSelectedBtn = screen
      .getByText(/editor\.querySelection\.runSelected/)
      .closest("button");
    fireEvent.click(runSelectedBtn!);
    expect(mockOnRunSelected).toHaveBeenCalledWith(queries);
  });

  it("shows inline run button on hover for each query row", () => {
    renderModal();
    const runButtons = screen.getAllByTitle("editor.querySelection.runSingle");
    expect(runButtons.length).toBe(queries.length);
  });
});
