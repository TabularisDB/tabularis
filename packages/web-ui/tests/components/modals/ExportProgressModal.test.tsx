import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExportProgressModal } from "../../../src/components/modals/ExportProgressModal";

vi.mock("../../../src/components/ui/Modal", () => ({
  Modal: ({
    isOpen,
    children,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
  }) => (isOpen ? <div data-testid="modal">{children}</div> : null),
}));

describe("ExportProgressModal", () => {
  const defaultProps = {
    isOpen: true,
    status: "completed" as const,
    rowsProcessed: 100,
    fileName: "result.csv",
    onCancel: vi.fn(),
    onClose: vi.fn(),
  };

  it("shows a warning message when the export used only loaded rows", () => {
    render(
      <ExportProgressModal
        {...defaultProps}
        warningMessage="Only 100 loaded rows were exported out of 250 total rows."
      />,
    );

    expect(
      screen.getByText(
        "Only 100 loaded rows were exported out of 250 total rows.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the error message instead of a loaded rows warning on failure", () => {
    render(
      <ExportProgressModal
        {...defaultProps}
        status="error"
        errorMessage="Export failed"
        warningMessage="Only 100 loaded rows were exported out of 250 total rows."
      />,
    );

    expect(screen.getByText("Export failed")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Only 100 loaded rows were exported out of 250 total rows.",
      ),
    ).not.toBeInTheDocument();
  });
});
