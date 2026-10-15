import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BackupTab } from "../../../src/components/settings/BackupTab";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  consumeDownload: vi.fn(),
  downloadFile: vi.fn(),
  showAlert: vi.fn(),
  updateSetting: vi.fn(),
}));

vi.mock("../../../src/hooks/useTabularisClient", () => ({
  useTabularisClient: () => mocks,
}));

vi.mock("../../../src/hooks/usePlatformCapabilities", () => ({
  usePlatformCapabilities: () => ({
    negotiation: { environment: "browser" },
    downloadFile: mocks.downloadFile,
  }),
}));

vi.mock("../../../src/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {
      backupMode: "manual",
      backupTarget: "local",
      backupDirectory: "/srv/tabularis/backups",
      backupIntervalMinutes: 1440,
      backupRetention: 10,
    },
    updateSetting: mocks.updateSetting,
  }),
}));

vi.mock("../../../src/hooks/useAlert", () => ({
  useAlert: () => ({ showAlert: mocks.showAlert }),
}));

vi.mock("../../../src/components/settings/SettingControls", () => ({
  SettingSection: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  SettingRow: ({
    label,
    description,
    children,
  }: {
    label: string;
    description: string;
    children: React.ReactNode;
  }) => (
    <div>
      <span>{label}</span>
      <span>{description}</span>
      {children}
    </div>
  ),
  SettingButtonGroup: () => null,
  SettingNumberInput: () => null,
}));

vi.mock("../../../src/components/ui/PasswordInput", () => ({
  PasswordInput: () => <input type="password" />,
}));

describe("BackupTab browser adaptation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.call.mockImplementation((command: string) => {
      if (command === "get_connections_backup_status") {
        return Promise.resolve({
          passwordSet: true,
          targetPasswordSet: true,
          lastBackupAt: null,
          targetKind: "serverDirectory",
          targetDisplay: "/srv/tabularis/backups",
        });
      }
      if (command === "run_connections_backup") {
        return Promise.resolve({
          serverLocation: "/srv/tabularis/backups/tabularis-backup.json",
          targetKind: "serverDirectory",
          download: {
            kind: "download",
            fileName: "tabularis-backup.json",
            mimeType: "application/json",
            token: "backup-download",
            size: 9,
          },
        });
      }
      return Promise.resolve(null);
    });
    mocks.consumeDownload.mockResolvedValue(
      new Blob(["encrypted"], { type: "application/json" }),
    );
    mocks.downloadFile.mockResolvedValue(true);
  });

  it("labels local targets as server paths and downloads manual backup copies", async () => {
    render(<BackupTab />);

    expect(screen.getByText("settings.backup.serverDirectoryDesc")).toBeInTheDocument();
    expect(screen.getByDisplayValue("/srv/tabularis/backups")).toBeInTheDocument();

    const buttons = screen.getAllByRole("button", {
      name: "settings.backup.backupNow",
    });
    const backupButton = buttons.at(-1)!;
    await waitFor(() => expect(backupButton).toBeEnabled());
    fireEvent.click(backupButton);

    await waitFor(() => {
      expect(mocks.consumeDownload).toHaveBeenCalledWith("backup-download");
      expect(mocks.downloadFile).toHaveBeenCalledWith({
        fileName: "tabularis-backup.json",
        mimeType: "application/json",
        contents: expect.any(Uint8Array),
      });
    });
    expect(mocks.showAlert).toHaveBeenCalledWith("settings.backup.backupDone");
  });
});
