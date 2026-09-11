import { fireEvent, render, screen } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { describe, expect, it, vi } from "vitest";
import { UpdateNotificationModal } from "../../../src/components/modals/UpdateNotificationModal";

const updateInfo = {
  currentVersion: "1.0.0",
  latestVersion: "1.1.0",
  releaseNotes:
    "## Improvements\n\n- Added **Markdown rendering**\n- Read the [release notes](https://example.com/release)",
  releaseUrl: "https://example.com/release",
  publishedAt: "2025-01-15T00:00:00Z",
  downloadUrls: [],
};

const renderModal = () =>
  render(
    <UpdateNotificationModal
      isOpen
      onClose={vi.fn()}
      updateInfo={updateInfo}
      isDownloading={false}
      downloadProgress={0}
      onDownloadAndInstall={vi.fn()}
      error={null}
    />,
  );

describe("UpdateNotificationModal", () => {
  it("renders release notes as Markdown", () => {
    renderModal();

    expect(
      screen.getByRole("heading", { name: "Improvements" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Markdown rendering").tagName).toBe("STRONG");
    expect(screen.getByText("Added").closest("li")).toBeInTheDocument();
  });

  it("opens Markdown links through the OS opener", () => {
    renderModal();

    fireEvent.click(screen.getByRole("link", { name: "release notes" }));
    expect(openUrl).toHaveBeenCalledWith("https://example.com/release");
  });
});
