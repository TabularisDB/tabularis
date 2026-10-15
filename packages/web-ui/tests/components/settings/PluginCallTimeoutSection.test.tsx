import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginCallTimeoutSection } from "../../../src/components/settings/PluginCallTimeoutSection";
import { useSettings } from "../../../src/hooks/useSettings";

vi.mock("lucide-react", async () => await vi.importActual("lucide-react"));
vi.mock("../../../src/hooks/useSettings", () => ({ useSettings: vi.fn() }));

describe("PluginCallTimeoutSection shutdown grace", () => {
  const updateSetting = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    updateSetting.mockResolvedValue(undefined);
    vi.mocked(useSettings).mockReturnValue({
      settings: {},
      updateSetting,
      isLoading: false,
      isLanguageReady: true,
      isLanguageSettled: true,
    } as ReturnType<typeof useSettings>);
  });

  it("shows the two second default and saves a global override", () => {
    render(<PluginCallTimeoutSection />);
    const grace = screen.getByRole("spinbutton", {
      name: "settings.plugins.shutdownGrace",
    });
    expect(grace).toHaveValue(2);

    fireEvent.change(grace, { target: { value: "0" } });
    fireEvent.blur(grace);

    expect(updateSetting).toHaveBeenCalledWith("pluginShutdownGraceSeconds", 1);
  });

  it("shows a saved global grace and resets invalid input to the default", () => {
    vi.mocked(useSettings).mockReturnValue({
      settings: { pluginShutdownGraceSeconds: 12 },
      updateSetting,
      isLoading: false,
      isLanguageReady: true,
      isLanguageSettled: true,
    } as ReturnType<typeof useSettings>);
    render(<PluginCallTimeoutSection />);
    const grace = screen.getByRole("spinbutton", {
      name: "settings.plugins.shutdownGrace",
    });
    expect(grace).toHaveValue(12);

    fireEvent.change(grace, { target: { value: "nope" } });
    fireEvent.blur(grace);
    expect(grace).toHaveValue(2);
    expect(updateSetting).toHaveBeenCalledWith("pluginShutdownGraceSeconds", 2);
  });

  it("keeps an uncommitted grace edit when the call timeout setting changes", () => {
    const mockSettings = (settings: Record<string, number>) =>
      vi.mocked(useSettings).mockReturnValue({
        settings,
        updateSetting,
        isLoading: false,
        isLanguageReady: true,
        isLanguageSettled: true,
      } as ReturnType<typeof useSettings>);
    mockSettings({});
    const { rerender } = render(<PluginCallTimeoutSection />);
    const grace = screen.getByRole("spinbutton", {
      name: "settings.plugins.shutdownGrace",
    });
    fireEvent.change(grace, { target: { value: "45" } });

    mockSettings({ pluginCallTimeoutSeconds: 90 });
    rerender(<PluginCallTimeoutSection />);

    expect(
      screen.getByRole("spinbutton", { name: "settings.plugins.callTimeout" }),
    ).toHaveValue(90);
    expect(grace).toHaveValue(45);
  });
});
