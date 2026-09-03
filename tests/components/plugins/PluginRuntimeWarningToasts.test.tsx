import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { PluginRuntimeWarningToasts } from "../../../src/components/plugins/PluginRuntimeWarningToasts";
import { ToastContext } from "../../../src/contexts/ToastContext";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const settingsMock = vi.hoisted(() => ({ activeExternalDrivers: [] as string[] }));
vi.mock("../../../src/hooks/useSettings", () => ({
  useSettings: () => ({ settings: settingsMock }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options?.plugin ? `${key}:${options.plugin}` : key,
  }),
}));

function renderWithToast() {
  const showToast = vi.fn();
  const view = render(
    <ToastContext.Provider value={{ showToast }}>
      <PluginRuntimeWarningToasts />
    </ToastContext.Provider>,
  );
  return { showToast, ...view };
}

describe("PluginRuntimeWarningToasts", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    settingsMock.activeExternalDrivers = ["sqlserver"];
  });

  it("shows one warning toast per queued backend warning", async () => {
    invokeMock.mockResolvedValue([
      { plugin_id: "sqlserver", message: "requires Tabularis 0.23.0" },
      { plugin_id: "oracle", message: "requires Tabularis 0.24.0" },
    ]);

    const { showToast } = renderWithToast();

    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(2));
    expect(invokeMock).toHaveBeenCalledWith("get_plugin_runtime_warnings");
    expect(showToast).toHaveBeenNthCalledWith(1, "requires Tabularis 0.23.0", {
      kind: "warning",
      title: "settings.plugins.devRuntimeWarning.title:sqlserver",
      duration: 12000,
    });
    expect(showToast).toHaveBeenNthCalledWith(2, "requires Tabularis 0.24.0", {
      kind: "warning",
      title: "settings.plugins.devRuntimeWarning.title:oracle",
      duration: 12000,
    });
  });

  it("shows nothing when the queue is empty or the command is unavailable", async () => {
    invokeMock.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("not in tauri"));

    const first = renderWithToast();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    first.unmount();

    const second = renderWithToast();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));

    expect(first.showToast).not.toHaveBeenCalled();
    expect(second.showToast).not.toHaveBeenCalled();
  });

  it("drains the queue again when the enabled plugin set changes", async () => {
    invokeMock.mockResolvedValue([]);
    const { rerender } = renderWithToast();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));

    settingsMock.activeExternalDrivers = ["sqlserver", "oracle"];
    rerender(
      <ToastContext.Provider value={{ showToast: vi.fn() }}>
        <PluginRuntimeWarningToasts />
      </ToastContext.Provider>,
    );

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
  });
});
