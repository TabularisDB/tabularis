import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InfoTab } from "../../../src/components/settings/InfoTab";
import type { Settings } from "../../../src/contexts/SettingsContext";

const translations: Record<string, string> = {
  "settings.releaseChannel": "Release channel",
  "settings.releaseChannelDesc":
    "Stable ships tested releases. Nightly builds from the latest main branch — newer, but may be unstable.",
  "settings.channelStable": "Stable",
  "settings.channelNightly": "Nightly",
  "update.nightlyWarning":
    "Nightly builds are unstable pre-releases. Only assets built for the nightly channel are installed.",
  "update.managedByPackageManager": "Updates managed by {{source}}",
  "update.managedByPackageManagerDesc":
    "Use your package manager to update Tabularis.",
};

vi.mock("lucide-react", () => ({
  Github: () => null,
  CheckCircle2: () => null,
  Circle: () => null,
  Heart: () => null,
  Info: () => null,
  Code2: () => null,
  Library: () => null,
  Download: () => null,
  Loader2: () => null,
  ExternalLink: () => null,
  Activity: () => null,
  Sparkles: () => null,
  Share2: () => null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      (translations[key] ?? key).replace(
        "{{source}}",
        String(values?.source ?? ""),
      ),
  }),
}));

vi.mock("../../../src/hooks/useTheme", () => ({
  useTheme: vi.fn(() => ({
    currentTheme: { id: "tabularis-dark", colors: {} },
  })),
}));

vi.mock("../../../src/hooks/useChangelog", () => ({
  useChangelog: vi.fn(() => ({
    entries: [],
    isLoading: false,
    error: null,
  })),
}));

// Not under test here; avoid pulling in their own icon/markdown dependencies.
vi.mock("../../../src/components/modals/WhatsNewModal", () => ({
  WhatsNewModal: () => null,
}));
vi.mock("../../../src/components/modals/OpenSourceLibrariesModal", () => ({
  OpenSourceLibrariesModal: () => null,
}));

const mockUseSettings = vi.fn();
vi.mock("../../../src/hooks/useSettings", () => ({
  useSettings: (...args: unknown[]) => mockUseSettings(...args),
}));

const mockUseUpdate = vi.fn();
vi.mock("../../../src/hooks/useUpdate", () => ({
  useUpdate: (...args: unknown[]) => mockUseUpdate(...args),
}));

interface RenderInfoTabOptions {
  installationSource?: string | null;
  releaseChannel?: Settings["releaseChannel"];
  updateSetting?: (...args: unknown[]) => void;
}

function renderInfoTab({
  installationSource = null,
  releaseChannel,
  updateSetting = vi.fn(),
}: RenderInfoTabOptions) {
  mockUseSettings.mockReturnValue({
    settings: { releaseChannel } as Settings,
    updateSetting,
  });
  mockUseUpdate.mockReturnValue({
    checkForUpdates: vi.fn(),
    isChecking: false,
    updateInfo: null,
    error: null,
    isUpToDate: false,
    installationSource,
  });
  return render(<InfoTab />);
}

describe("InfoTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the release channel selector on a direct install", () => {
    renderInfoTab({ installationSource: null });
    expect(screen.getByText("Release channel")).toBeInTheDocument();
  });

  it("persists a channel change", () => {
    const updateSetting = vi.fn();
    renderInfoTab({ installationSource: null, updateSetting });
    fireEvent.click(screen.getByRole("button", { name: "Nightly" }));
    expect(updateSetting).toHaveBeenCalledWith("releaseChannel", "nightly");
  });

  it("hides the selector for managed installs", () => {
    renderInfoTab({ installationSource: "aur" });
    expect(screen.queryByText("Release channel")).not.toBeInTheDocument();
  });

  it("shows the custom package manager name", () => {
    renderInfoTab({ installationSource: "Solus" });
    expect(screen.getByText("Updates managed by Solus")).toBeInTheDocument();
    expect(screen.queryByText("Release channel")).not.toBeInTheDocument();
  });

  it("shows the nightly warning when the nightly channel is selected", () => {
    renderInfoTab({ installationSource: null, releaseChannel: "nightly" });
    expect(
      screen.getByText(
        "Nightly builds are unstable pre-releases. Only assets built for the nightly channel are installed.",
      ),
    ).toBeInTheDocument();
  });
});
