import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryModal } from "../../../src/components/modals/QueryModal";

// Mock MonacoEditor
vi.mock("@monaco-editor/react", () => ({
  default: vi.fn(({ value, onChange }) => (
    <textarea
      data-testid="monaco-editor"
      value={value || ""}
      onChange={(e) => onChange?.(e.target.value)}
    />
  )),
}));

// Mock useTheme
vi.mock("../../../src/hooks/useTheme", () => ({
  useTheme: vi.fn(() => ({
    currentTheme: { id: "tabularis-dark" },
    allThemes: [{ id: "tabularis-dark" }],
  })),
}));

vi.mock("../../../src/hooks/useSettings", () => ({
  useSettings: vi.fn(() => ({
    settings: {},
  })),
}));

vi.mock("../../../src/themes/themeUtils", () => ({
  loadMonacoTheme: vi.fn(),
}));

describe("QueryModal", () => {
  const mockOnClose = vi.fn();
  const mockOnSave = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when isOpen is false", () => {
    render(
      <QueryModal isOpen={false} onClose={mockOnClose} onSave={mockOnSave} />,
    );

    expect(screen.queryByText("Save Query")).not.toBeInTheDocument();
  });

  it("renders with default title when isOpen is true", () => {
    render(
      <QueryModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} />,
    );

    expect(screen.getByText("Save Query")).toBeInTheDocument();
  });

  it("renders with custom title", () => {
    render(
      <QueryModal
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
        title="Edit Query"
      />,
    );

    expect(screen.getByText("Edit Query")).toBeInTheDocument();
  });

  it("initializes with provided initial values", () => {
    render(
      <QueryModal
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
        initialName="Test Query"
        initialSql="SELECT * FROM test"
      />,
    );

    expect(screen.getByDisplayValue("Test Query")).toBeInTheDocument();
    expect(screen.getByTestId("monaco-editor")).toHaveValue(
      "SELECT * FROM test",
    );
  });

  it("updates name input when typing", () => {
    render(
      <QueryModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} />,
    );

    const nameInput = screen.getByPlaceholderText("My Query");
    fireEvent.change(nameInput, { target: { value: "New Query Name" } });

    expect(nameInput).toHaveValue("New Query Name");
  });

  it("shows error when submitting with empty name", async () => {
    render(
      <QueryModal
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
        initialSql="SELECT 1"
      />,
    );

    const form = document.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeInTheDocument();
    });

    expect(mockOnSave).not.toHaveBeenCalled();
  });

  it("shows error when submitting with empty SQL", async () => {
    render(
      <QueryModal
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
        initialName="Test Query"
      />,
    );

    const form = document.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("SQL content is required")).toBeInTheDocument();
    });

    expect(mockOnSave).not.toHaveBeenCalled();
  });

  it("calls onSave with correct values on valid submit", async () => {
    mockOnSave.mockResolvedValueOnce(undefined);

    render(
      <QueryModal
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
        initialName="Test Query"
        initialSql="SELECT * FROM users"
      />,
    );

    const form = document.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(
        "Test Query",
        "SELECT * FROM users",
        null,
      );
    });

    expect(mockOnClose).toHaveBeenCalled();
  });

  it("calls onClose when clicking close button", () => {
    render(
      <QueryModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} />,
    );

    // Close button is the first button without text (X icon)
    const buttons = screen.getAllByRole("button");
    const closeButton = buttons[0]; // First button is the close button
    fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it("shows error when onSave throws", async () => {
    mockOnSave.mockRejectedValueOnce(new Error("Save failed"));

    render(
      <QueryModal
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
        initialName="Test"
        initialSql="SELECT 1"
      />,
    );

    const form = document.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("Error: Save failed")).toBeInTheDocument();
    });

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("disables save button while saving", async () => {
    mockOnSave.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100)),
    );

    render(
      <QueryModal
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
        initialName="Test"
        initialSql="SELECT 1"
      />,
    );

    const saveButton = screen.getByRole("button", { name: /save/i });
    const form = document.querySelector("form")!;

    fireEvent.submit(form);

    await waitFor(() => {
      expect(saveButton).toBeDisabled();
    });
  });

  it("resets state when reopening with different initial values", () => {
    const { rerender } = render(
      <QueryModal
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
        initialName="Query 1"
        initialSql="SELECT 1"
      />,
    );

    expect(screen.getByDisplayValue("Query 1")).toBeInTheDocument();

    // Close and reopen with different values
    rerender(
      <QueryModal
        isOpen={false}
        onClose={mockOnClose}
        onSave={mockOnSave}
        initialName="Query 1"
        initialSql="SELECT 1"
      />,
    );

    rerender(
      <QueryModal
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
        initialName="Query 2"
        initialSql="SELECT 2"
      />,
    );

    expect(screen.getByDisplayValue("Query 2")).toBeInTheDocument();
  });

  it("has correct form structure", () => {
    render(
      <QueryModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} />,
    );

    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("SQL")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("My Query")).toBeInTheDocument();
  });

  it("handles SQL editor change", () => {
    render(
      <QueryModal
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
        initialSql="SELECT 1"
      />,
    );

    const sqlEditor = screen.getByTestId("monaco-editor");
    fireEvent.change(sqlEditor, { target: { value: "SELECT 2" } });

    expect(sqlEditor).toHaveValue("SELECT 2");
  });
});
