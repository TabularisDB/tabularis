import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiApprovalGate } from "../../../src/components/modals/AiApprovalGate";
import { usePendingApprovals } from "../../../src/hooks/useAiActivity";
import { useSettings } from "../../../src/hooks/useSettings";
import {
  focusWindowForApproval,
  notifyApprovalRequest,
  restoreWindowAlwaysOnTop,
} from "../../../src/utils/mcpApprovalAttention";

vi.mock("../../../src/hooks/useSettings", () => ({
  useSettings: vi.fn(),
}));

vi.mock("../../../src/hooks/useAiActivity", () => ({
  usePendingApprovals: vi.fn(),
}));

vi.mock("../../../src/utils/mcpApprovalAttention", () => ({
  focusWindowForApproval: vi.fn().mockResolvedValue(undefined),
  notifyApprovalRequest: vi.fn().mockResolvedValue(undefined),
  restoreWindowAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/components/modals/AiApprovalModal", () => ({
  AiApprovalModal: ({ approval }: { approval: { id: string } }) => (
    <div data-testid="approval-modal">{approval.id}</div>
  ),
}));

describe("AiApprovalGate", () => {
  const decide = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(usePendingApprovals).mockReturnValue({
      pending: [
        {
          id: "approval-1",
          query: "SELECT 1",
        },
      ] as never[],
      loading: false,
      error: null,
      refetch: vi.fn(),
      decide,
    });
  });

  it("renders approval UI and sends notifications even before language settles", async () => {
    vi.mocked(useSettings)
      .mockReturnValue({
        settings: {
          mcpApprovalAlwaysOnTop: true,
          mcpApprovalNotifySound: true,
        },
        isLoading: false,
        isLanguageReady: false,
        isLanguageSettled: false,
        updateSetting: vi.fn(),
      } as never);

    render(<AiApprovalGate />);

    await waitFor(() => {
      expect(screen.getByTestId("approval-modal")).toBeInTheDocument();
    });

    expect(focusWindowForApproval).toHaveBeenCalledWith("approval-1");
    expect(notifyApprovalRequest).toHaveBeenCalledWith({
      title: "aiApproval.notificationTitle",
      body: "aiApproval.notificationBody",
    });
    expect(restoreWindowAlwaysOnTop).not.toHaveBeenCalled();
  });

  it("restores temporary attention state when the active approval disappears before language settles", async () => {
    vi.mocked(useSettings)
      .mockReturnValueOnce({
        settings: {
          mcpApprovalAlwaysOnTop: true,
          mcpApprovalNotifySound: true,
        },
        isLoading: false,
        isLanguageReady: true,
        isLanguageSettled: true,
        updateSetting: vi.fn(),
      } as never)
      .mockReturnValueOnce({
        settings: {
          mcpApprovalAlwaysOnTop: true,
          mcpApprovalNotifySound: true,
        },
        isLoading: false,
        isLanguageReady: false,
        isLanguageSettled: false,
        updateSetting: vi.fn(),
      } as never);

    const { rerender } = render(<AiApprovalGate />);

    await waitFor(() => {
      expect(focusWindowForApproval).toHaveBeenCalledWith("approval-1");
    });

    vi.mocked(usePendingApprovals).mockReturnValue({
      pending: [] as never[],
      loading: false,
      error: null,
      refetch: vi.fn(),
      decide,
    });

    rerender(<AiApprovalGate />);

    await waitFor(() => {
      expect(restoreWindowAlwaysOnTop).toHaveBeenCalledWith("approval-1");
    });
  });

  it("does not steal focus when always-on-top attention is disabled", async () => {
    vi.mocked(useSettings).mockReturnValue({
      settings: {
        mcpApprovalAlwaysOnTop: false,
        mcpApprovalNotifySound: true,
      },
      isLoading: false,
      isLanguageReady: true,
      isLanguageSettled: true,
      updateSetting: vi.fn(),
    } as never);

    render(<AiApprovalGate />);

    await waitFor(() => {
      expect(screen.getByTestId("approval-modal")).toBeInTheDocument();
    });

    expect(focusWindowForApproval).not.toHaveBeenCalled();
    expect(notifyApprovalRequest).toHaveBeenCalledWith({
      title: "aiApproval.notificationTitle",
      body: "aiApproval.notificationBody",
    });
  });

  it("does not send notifications when notification attention is disabled", async () => {
    vi.mocked(useSettings).mockReturnValue({
      settings: {
        mcpApprovalAlwaysOnTop: true,
        mcpApprovalNotifySound: false,
      },
      isLoading: false,
      isLanguageReady: true,
      isLanguageSettled: true,
      updateSetting: vi.fn(),
    } as never);

    render(<AiApprovalGate />);

    await waitFor(() => {
      expect(screen.getByTestId("approval-modal")).toBeInTheDocument();
    });

    expect(focusWindowForApproval).toHaveBeenCalledWith("approval-1");
    expect(notifyApprovalRequest).not.toHaveBeenCalled();
  });
});
