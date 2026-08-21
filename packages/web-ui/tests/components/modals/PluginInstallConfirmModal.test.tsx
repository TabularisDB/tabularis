import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { PluginInstallConfirmModal } from "../../../src/components/modals/PluginInstallConfirmModal";
import type { DeepLinkInstallRequest } from "../../../src/hooks/useDeepLinkInstall";

const request: DeepLinkInstallRequest = { slug: "firestore", version: null, registry: null };

const preview = (over: Record<string, unknown> = {}) => ({
  id: "firestore",
  name: "Firestore",
  description: "",
  author: "",
  homepage: "",
  latest_version: "1.2.3",
  releases: [],
  installed_version: null,
  update_available: false,
  platform_supported: true,
  install_action: "install",
  ...over,
});

describe("PluginInstallConfirmModal", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("shows the install button when not installed", async () => {
    vi.mocked(invoke).mockResolvedValue(preview({ install_action: "install" }));
    render(
      <PluginInstallConfirmModal
        request={request}
        busy={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /deepLink\.installConfirm/i })).toBeInTheDocument(),
    );
  });

  it("shows the update button when an update is available", async () => {
    vi.mocked(invoke).mockResolvedValue(
      preview({ install_action: "update", installed_version: "1.0.0" }),
    );
    render(
      <PluginInstallConfirmModal
        request={request}
        busy={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /deepLink\.updateConfirm/i })).toBeInTheDocument(),
    );
  });

  it("hides the primary action and shows an info banner when up to date", async () => {
    vi.mocked(invoke).mockResolvedValue(
      preview({ install_action: "up_to_date", installed_version: "1.2.3" }),
    );
    render(
      <PluginInstallConfirmModal
        request={request}
        busy={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText(/deepLink\.alreadyInstalled/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /deepLink\.installConfirm/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /deepLink\.updateConfirm/i })).not.toBeInTheDocument();
  });
});
