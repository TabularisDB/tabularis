import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ExportConnectionsModal } from "../../../src/components/modals/ExportConnectionsModal";

function renderModal(props: Partial<Parameters<typeof ExportConnectionsModal>[0]> = {}) {
  const onExport = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <ExportConnectionsModal
      isOpen={true}
      onClose={onClose}
      onExport={onExport}
      {...props}
    />,
  );
  return { onExport, onClose };
}

describe("ExportConnectionsModal", () => {
  it("shows the generic subtitle when no selection is active", () => {
    renderModal();
    expect(
      screen.getByText("connections.exportModal.subtitle"),
    ).toBeInTheDocument();
  });

  it("shows the selection subtitle when connections are selected", () => {
    renderModal({ selectedCount: 3 });
    expect(
      screen.getByText("connections.exportModal.subtitleSelected"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("connections.exportModal.subtitle"),
    ).not.toBeInTheDocument();
  });

  it("requires a password before an encrypted export", async () => {
    const { onExport } = renderModal();
    fireEvent.click(
      screen.getByText("connections.exportModal.export"),
    );
    await waitFor(() => {
      expect(
        screen.getByText("connections.exportModal.passwordRequired"),
      ).toBeInTheDocument();
    });
    expect(onExport).not.toHaveBeenCalled();
  });

  it("exports without a password in noSecrets mode", async () => {
    const { onExport } = renderModal();
    fireEvent.click(screen.getAllByRole("radio")[1]);
    fireEvent.click(screen.getByText("connections.exportModal.export"));
    await waitFor(() => {
      expect(onExport).toHaveBeenCalledWith("noSecrets", undefined);
    });
  });
});
