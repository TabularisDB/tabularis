import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpSafetySection } from "../../../../src/components/modals/mcp/McpSafetySection";
import { useSettings } from "../../../../src/hooks/useSettings";

vi.mock("../../../../src/hooks/useTabularisClient", () => import("../../../support/tauriBackedHooks"));
vi.mock("../../../../src/hooks/usePlatformCapabilities", () => import("../../../support/tauriBackedHooks"));
vi.mock("../../../../src/hooks/useSettings", () => ({
  useSettings: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("McpSafetySection output format", () => {
  const updateSetting = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses JSON when no persisted preference exists", () => {
    vi.mocked(useSettings).mockReturnValue({
      settings: {},
      updateSetting,
    } as never);

    render(<McpSafetySection />);

    expect(screen.getByRole("button", { name: "JSON" }).className).toContain(
      "bg-accent-primary",
    );
  });

  it("persists TOON as the default output format", () => {
    vi.mocked(useSettings).mockReturnValue({
      settings: { mcpOutputFormat: "json" },
      updateSetting,
    } as never);

    render(<McpSafetySection />);
    fireEvent.click(screen.getByRole("button", { name: "TOON" }));

    expect(updateSetting).toHaveBeenCalledWith("mcpOutputFormat", "toon");
  });
});
