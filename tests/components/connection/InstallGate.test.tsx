import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InstallGate } from "../../../src/components/modals/connection/InstallGate";
import type { CatalogueDriver } from "../../../src/utils/connectionCatalogue";

const driver = (over: Partial<CatalogueDriver> = {}): CatalogueDriver => ({
  slug: "firestore",
  name: "Firestore",
  engine: "firestore",
  paradigms: ["document"],
  verified: true,
  installed: false,
  installedVersion: null,
  latestVersion: "0.3.6",
  isBuiltin: false,
  platformSupported: true,
  downloads: 10,
  updateAvailable: false,
  icon: null,
  color: null,
  ...over,
});

describe("InstallGate", () => {
  it("shows a solid install button with the latest version when supported", () => {
    render(
      <InstallGate driver={driver()} status="idle" onInstall={vi.fn()} onBack={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /connectionCatalogue\.installVersion/i })).toBeInTheDocument();
  });

  it("calls onInstall with slug + latest version", () => {
    const onInstall = vi.fn();
    render(
      <InstallGate driver={driver()} status="idle" onInstall={onInstall} onBack={vi.fn()} />,
    );
    screen.getByRole("button", { name: /connectionCatalogue\.installVersion/i }).click();
    expect(onInstall).toHaveBeenCalledWith("firestore", "0.3.6");
  });

  it("shows an unavailable message and no install button when the platform is unsupported", () => {
    render(
      <InstallGate
        driver={driver({ platformSupported: false })}
        status="idle"
        onInstall={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText(/connectionCatalogue\.noReleaseTitle/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /installVersion/i })).not.toBeInTheDocument();
  });

  it("shows a retry label on error", () => {
    render(
      <InstallGate
        driver={driver()}
        status="error"
        error="No 0.3.6 release exists"
        onInstall={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText(/no 0\.3\.6 release exists/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connectionCatalogue\.retryInstall/i })).toBeInTheDocument();
  });
});
