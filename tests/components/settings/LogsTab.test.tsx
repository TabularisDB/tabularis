import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { save } from "@tauri-apps/plugin-dialog";
import { LogsTab } from "../../../src/components/settings/LogsTab";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), updateSetting: vi.fn(), showAlert: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("lucide-react", async () => await vi.importActual("lucide-react"));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../../src/hooks/useSettings", () => ({ useSettings: () => ({ settings: { loggingEnabled: true, maxLogEntries: 1000 }, updateSetting: mocks.updateSetting }) }));
vi.mock("../../../src/hooks/useAlert", () => ({ useAlert: () => ({ showAlert: mocks.showAlert }) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_logs") return ["INFO", "ERROR", "WARN", "DEBUG"].map((level) => ({ timestamp: "12:00", level, message: `${level} message` }));
    if (command === "get_log_settings") return { enabled: true, max_size: 1000, current_count: 4 };
    throw new Error(`Unexpected command: ${command}`);
  });
});

describe("LogsTab theme controls", () => {
  it("uses theme tokens for refresh, filters, toggle and semantic log levels", async () => {
    render(<LogsTab />);
    await waitFor(() => expect(screen.getByRole("button", { name: "settings.refreshLogs" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "settings.refreshLogs" })).toHaveClass("bg-accent-primary", "hover:bg-accent-primary/90", "text-inverse");
    expect(screen.getByRole("combobox")).toHaveClass("focus:border-focus");
    expect(screen.getByRole("checkbox").nextElementSibling).toHaveClass("peer-checked:bg-accent-primary");
    for (const [level, tone] of Object.entries({ INFO: "info", ERROR: "error", WARN: "warning", DEBUG: "success" })) {
      expect(await screen.findByText(level, { selector: "span" })).toHaveClass(`text-accent-${tone}`);
    }
    expect(mocks.invoke.mock.calls.every(([command]) => command === "get_logs" || command === "get_log_settings")).toBe(true);
  });
});

describe("LogsTab export", () => {
  it("writes the logs to the chosen file and confirms the export", async () => {
    vi.mocked(save).mockResolvedValue("/tmp/tabularis.log");
    const loadLogs = mocks.invoke.getMockImplementation();
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) =>
      command === "export_logs" ? undefined : loadLogs?.(command, args),
    );
    render(<LogsTab />);

    fireEvent.click(await screen.findByRole("button", { name: "settings.exportLogs" }));

    await waitFor(() =>
      expect(mocks.showAlert).toHaveBeenCalledWith("settings.exportLogsSuccess", expect.objectContaining({ kind: "info" })),
    );
    expect(mocks.invoke).toHaveBeenCalledWith("export_logs", { filePath: "/tmp/tabularis.log" });
  });

  it("does nothing when the save dialog is cancelled", async () => {
    vi.mocked(save).mockResolvedValue(null);
    render(<LogsTab />);

    fireEvent.click(await screen.findByRole("button", { name: "settings.exportLogs" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(mocks.invoke).not.toHaveBeenCalledWith("export_logs", expect.anything());
    expect(mocks.showAlert).not.toHaveBeenCalled();
  });
});
