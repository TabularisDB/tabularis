import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginUpdateToast } from "../../../src/components/plugins/PluginUpdateToast";
import { usePluginRegistry } from "../../../src/hooks/usePluginRegistry";
import { useSettings } from "../../../src/hooks/useSettings";
import { useToast } from "../../../src/hooks/useToast";
import { DEFAULT_SETTINGS, type SettingsContextType } from "../../../src/contexts/SettingsContext";
import type { RegistryPluginWithStatus } from "../../../src/types/plugins";

vi.mock("../../../src/hooks/usePluginRegistry", () => ({ usePluginRegistry: vi.fn() }));
vi.mock("../../../src/hooks/useSettings", () => ({ useSettings: vi.fn() }));
vi.mock("../../../src/hooks/useToast", () => ({ useToast: vi.fn() }));

const plugin: RegistryPluginWithStatus = {
  id: "postgresql", name: "PostgreSQL", description: "", author: "", homepage: "",
  installed_version: "1.0.0", latest_version: "2.0.0", update_available: true,
  platform_supported: true, releases: [],
};
const showToast = vi.fn();
let settingsState: SettingsContextType;

function App() {
  return <StrictMode><MemoryRouter><PluginUpdateToast /></MemoryRouter></StrictMode>;
}

describe("PluginUpdateToast persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsState = {
      settings: { ...DEFAULT_SETTINGS },
      isLoading: false, isLanguageReady: true, isLanguageSettled: true,
      updateSetting: vi.fn(async (key, value) => {
        const next = typeof value === "function" ? value(settingsState.settings[key]) : value;
        settingsState.settings = { ...settingsState.settings, [key]: next };
      }),
    };
    vi.mocked(useSettings).mockImplementation(() => settingsState);
    vi.mocked(useToast).mockReturnValue({ showToast });
    vi.mocked(usePluginRegistry).mockReturnValue({
      plugins: [plugin], updates: [plugin], loading: false, error: null, refresh: vi.fn(),
    });
  });

  it("remembers the shown release across remounts, including StrictMode, without hiding updates", () => {
    const app = render(<App />);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(settingsState.settings.notifiedPluginVersions).toEqual({ postgresql: "2.0.0" });
    app.unmount();
    render(<App />);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(usePluginRegistry().updates).toEqual([plugin]);
  });

  it("does not re-notify when another plugin is updated/removed or registry order changes", () => {
    const other = { ...plugin, id: "redis" };
    vi.mocked(usePluginRegistry).mockReturnValue({ ...usePluginRegistry(), updates: [plugin, other] });
    const app = render(<App />);
    app.unmount();
    vi.mocked(usePluginRegistry).mockReturnValue({ ...usePluginRegistry(), updates: [other, plugin] });
    const reordered = render(<App />);
    expect(showToast).toHaveBeenCalledTimes(1);
    reordered.unmount();
    vi.mocked(usePluginRegistry).mockReturnValue({ ...usePluginRegistry(), updates: [other] });
    render(<App />);
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("notifies for a newer release and preserves unrelated seen versions", () => {
    settingsState.settings.notifiedPluginVersions = { postgresql: "1.5.0", redis: "3.0.0" };
    render(<App />);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(settingsState.settings.notifiedPluginVersions).toEqual({ postgresql: "2.0.0", redis: "3.0.0" });
  });

  it("notifies for a newly added plugin even when the total count is unchanged", () => {
    settingsState.settings.notifiedPluginVersions = { redis: "2.0.0" };
    render(<App />);
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("waits for persisted settings before deciding whether to notify", () => {
    settingsState.isLoading = true;
    const app = render(<App />);
    expect(showToast).not.toHaveBeenCalled();
    settingsState.isLoading = false;
    settingsState.settings.notifiedPluginVersions = { postgresql: "2.0.0" };
    app.rerender(<App />);
    expect(showToast).not.toHaveBeenCalled();
    expect(settingsState.updateSetting).not.toHaveBeenCalled();
  });

  it.each([
    { loading: true, error: null, updates: [plugin] },
    { loading: false, error: "offline", updates: [plugin] },
    { loading: false, error: null, updates: [] },
  ])("does not persist or notify incomplete/failed/empty checks: %j", (state) => {
    vi.mocked(usePluginRegistry).mockReturnValue({ ...usePluginRegistry(), ...state });
    render(<App />);
    expect(showToast).not.toHaveBeenCalled();
    expect(settingsState.updateSetting).not.toHaveBeenCalled();
  });
});
