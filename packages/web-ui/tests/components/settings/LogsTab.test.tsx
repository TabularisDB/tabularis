import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogsTab } from "../../../src/components/settings/LogsTab";

const mocks = vi.hoisted(() => {
  const call = vi.fn();
  return {
    call,
    client: { call },
    downloadGeneratedFile: vi.fn(),
    showAlert: vi.fn(),
    updateSetting: vi.fn(),
  };
});

vi.mock("../../../src/hooks/useTabularisClient", () => ({
  useTabularisClient: () => mocks.client,
}));

vi.mock("lucide-react", () => ({
  Trash2: () => null,
  FileDown: () => null,
  RotateCcw: () => null,
  ChevronDown: () => null,
  ChevronRight: () => null,
}));

vi.mock("../../../src/hooks/usePlatformCapabilities", () => ({
  usePlatformCapabilities: () => ({
    supports: () => false,
  }),
}));

vi.mock("../../../src/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: { loggingEnabled: true, maxLogEntries: 1000 },
    updateSetting: mocks.updateSetting,
  }),
}));

vi.mock("../../../src/hooks/useAlert", () => ({
  useAlert: () => ({ showAlert: mocks.showAlert }),
}));

vi.mock("../../../src/utils/fileDownloads", () => ({
  downloadGeneratedFile: mocks.downloadGeneratedFile,
}));

vi.mock("../../../src/components/settings/SettingControls", () => ({
  SettingSection: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  SettingRow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SettingToggle: ({
    checked,
    onChange,
  }: {
    checked: boolean;
    onChange: (enabled: boolean) => void;
  }) => (
    <button type="button" aria-label="toggle-logging" onClick={() => onChange(!checked)} />
  ),
  SettingNumberInput: ({ onChange }: { onChange: (size: number) => void }) => (
    <button type="button" aria-label="resize-logs" onClick={() => onChange(500)} />
  ),
}));

vi.mock("../../../src/components/modals/ConfirmModal", () => ({
  ConfirmModal: ({
    isOpen,
    onConfirm,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
  }) =>
    isOpen ? (
      <button type="button" aria-label="confirm-clear-logs" onClick={onConfirm} />
    ) : null,
}));

describe("LogsTab transport parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.call.mockImplementation((command: string) => {
      if (command === "get_logs") {
        return Promise.resolve([
          {
            timestamp: "2026-08-22 09:00:00.000",
            level: "ERROR",
            message: "Operational test log",
            target: "test",
          },
        ]);
      }
      if (command === "get_log_settings") {
        return Promise.resolve({ enabled: true, max_size: 1000, current_count: 1 });
      }
      if (command === "export_logs") {
        return Promise.resolve({
          kind: "download",
          fileName: "tabularis-logs.log",
          mimeType: "text/plain",
          token: "logs-token",
          size: 32,
        });
      }
      return Promise.resolve(null);
    });
    mocks.downloadGeneratedFile.mockResolvedValue(undefined);
  });

  it("loads, configures, clears, and exports logs through the shared client", async () => {
    render(<LogsTab />);

    await screen.findByText("Operational test log");
    expect(mocks.call).toHaveBeenCalledWith("get_logs", {
      request: { limit: 1000, level_filter: null },
    });
    expect(mocks.call).toHaveBeenCalledWith("get_log_settings", undefined);

    fireEvent.click(screen.getByLabelText("toggle-logging"));
    fireEvent.click(screen.getByLabelText("resize-logs"));
    await waitFor(() => {
      expect(mocks.call).toHaveBeenCalledWith("set_log_enabled", { enabled: false });
      expect(mocks.call).toHaveBeenCalledWith("set_log_max_size", { maxSize: 500 });
    });

    fireEvent.click(screen.getByRole("button", { name: "settings.clearLogs" }));
    fireEvent.click(screen.getByLabelText("confirm-clear-logs"));
    await waitFor(() => {
      expect(mocks.call).toHaveBeenCalledWith("clear_logs", undefined);
    });

    fireEvent.click(screen.getByRole("button", { name: "settings.exportLogs" }));
    await waitFor(() => {
      expect(mocks.call).toHaveBeenCalledWith("export_logs", {});
      expect(mocks.downloadGeneratedFile).toHaveBeenCalled();
    });
  });
});
