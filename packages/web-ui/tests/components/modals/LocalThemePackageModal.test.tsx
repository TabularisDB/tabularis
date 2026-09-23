import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocalThemePackageModal } from "../../../src/components/modals/LocalThemePackageModal";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), previewTheme: vi.fn(), cancelPreview: vi.fn(), refreshCatalog: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("../../../src/hooks/useTheme", () => ({ useTheme: () => mocks }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../../src/components/ui/ThemeSqlSample", () => ({ ThemeSqlSample: () => <div>SQL sample</div> }));
const preview = { digest: "verified-digest", manifest: { name: "local-theme", version: "1.0.0" }, variants: [{ id: "native-id", name: "Local dark", mode: "dark", origin: { kind: "installed", identity: { registryKey: "a".repeat(64), packageName: "local-theme", variantId: "dark" } } }] };

beforeEach(() => {
  vi.clearAllMocks(); mocks.open.mockResolvedValue("/chosen/theme.zip"); mocks.refreshCatalog.mockResolvedValue(undefined);
  mocks.invoke.mockImplementation(async (command) => {
    if (command === "preview_local_theme_package") return preview;
    if (command === "install_local_theme_package") return { warnings: [] };
    throw new Error(`Unexpected ${command}`);
  });
});

describe("local theme package UI", () => {
  it("binds installation to native preview digest and never selects on install", async () => {
    render(<LocalThemePackageModal isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "themePackages.chooseArchive" }));
    await screen.findByText("local-theme · 1.0.0");
    expect(mocks.previewTheme).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Local dark/ })); expect(mocks.previewTheme).toHaveBeenCalledWith(preview.variants[0]);
    fireEvent.click(screen.getByRole("button", { name: "themePackages.install" }));
    await screen.findByText("themePackages.installedHint");
    expect(mocks.invoke).toHaveBeenCalledWith("install_local_theme_package", { path: "/chosen/theme.zip", packageName: "local-theme", expectedDigest: "verified-digest" });
    expect(mocks.invoke.mock.calls.some(([command]) => command === "save_config")).toBe(false);
    expect(mocks.cancelPreview).toHaveBeenCalled();
  });
  it("cancelling the file chooser invokes no native lifecycle operation", async () => {
    mocks.open.mockResolvedValueOnce(null);
    render(<LocalThemePackageModal isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "themePackages.chooseArchive" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "themePackages.chooseArchive" })).toBeEnabled());
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("surfaces archive validation failure before install becomes available", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("Archive changed"));
    render(<LocalThemePackageModal isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "themePackages.chooseArchive" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "themePackages.install" })).toBeDisabled();
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });
});
