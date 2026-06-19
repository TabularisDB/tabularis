import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuerySelectionModal } from "../../../src/components/modals/QuerySelectionModal";

// QuerySelectionModal uses the standalone `plural` macro, which the Lingui babel
// plugin compiles into a call on the global `i18n` singleton from @lingui/core
// (not the mocked useLingui `t`). Mock that singleton to render the source ICU
// message: pick the plural form by count and substitute `#` with the count.
vi.mock("@lingui/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lingui/core")>();
  const renderIcu = (message: string, values?: Record<string, unknown>) => {
    if (!values) return message;
    // {count, plural, one {# query found} other {# queries found}}
    const pluralMatch = message.match(
      /^\{(\w+),\s*plural,\s*(.+)\}$/s,
    );
    if (pluralMatch) {
      const [, varName, body] = pluralMatch;
      const count = Number(values[varName]);
      const forms: Record<string, string> = {};
      const formRe = /(\w+|=\d+)\s*\{([^{}]*)\}/g;
      let m: RegExpExecArray | null;
      while ((m = formRe.exec(body)) !== null) forms[m[1]] = m[2];
      const chosen =
        forms[`=${count}`] ?? (count === 1 ? forms.one : forms.other) ?? forms.other ?? "";
      return chosen.replace(/#/g, String(count));
    }
    let out = message;
    for (const [k, v] of Object.entries(values)) out = out.replaceAll(`{${k}}`, String(v));
    return out;
  };
  const i18n = {
    _: (id: string | { id?: string; message?: string }, values?: Record<string, unknown>) => {
      const message = typeof id === "string" ? id : (id?.message ?? id?.id ?? "");
      return renderIcu(message, values);
    },
    locale: "en",
    load: vi.fn(),
    activate: vi.fn(),
  };
  return { ...actual, i18n };
});

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
      screen.getByText("Select Query to Execute"),
    ).toBeInTheDocument();
  });

  it("renders query count in header", () => {
    renderModal();
    expect(
      screen.getByText(/queries found/),
    ).toBeInTheDocument();
  });

  it("renders Run All button", () => {
    renderModal();
    expect(
      screen.getByText("Run All"),
    ).toBeInTheDocument();
  });

  it("renders Run Selected button", () => {
    renderModal();
    expect(
      screen.getByText(/Run Selected/),
    ).toBeInTheDocument();
  });

  it("calls onRunAll with all queries when Run All is clicked", () => {
    renderModal();
    fireEvent.click(screen.getByText("Run All"));
    expect(mockOnRunAll).toHaveBeenCalledWith(queries);
  });

  it("calls onClose when close button is clicked", () => {
    renderModal();
    // Close button is the first button in the header (next to title)
    const title = screen.getByText("Select Query to Execute");
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
      .getByText(/Run Selected/)
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
      .getByText(/Run Selected/)
      .closest("button");
    expect(runSelectedBtn).not.toBeDisabled();
    fireEvent.click(runSelectedBtn!);
    expect(mockOnRunSelected).toHaveBeenCalledWith(["SELECT * FROM users"]);
  });

  it("shows Select All toggle", () => {
    renderModal();
    expect(
      screen.getByText("Select All"),
    ).toBeInTheDocument();
  });

  it("toggles all selections when Select All is clicked", () => {
    renderModal();
    fireEvent.click(screen.getByText("Select All"));
    expect(
      screen.getByText("Deselect All"),
    ).toBeInTheDocument();
    const runSelectedBtn = screen
      .getByText(/Run Selected/)
      .closest("button");
    fireEvent.click(runSelectedBtn!);
    expect(mockOnRunSelected).toHaveBeenCalledWith(queries);
  });

  it("shows inline run button on hover for each query row", () => {
    renderModal();
    const runButtons = screen.getAllByTitle("Run this query");
    expect(runButtons.length).toBe(queries.length);
  });
});
