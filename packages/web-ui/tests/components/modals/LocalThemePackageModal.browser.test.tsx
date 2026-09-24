import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LocalThemePackageModal } from "../../../src/components/modals/LocalThemePackageModal";
import { THEME_PACKAGE_UPLOAD_PURPOSE } from "../../../src/api/contract";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  uploadFile: vi.fn(),
  chooseInputFile: vi.fn(),
  readInputBlob: vi.fn(),
  previewTheme: vi.fn(),
  cancelPreview: vi.fn(),
  refreshCatalog: vi.fn(),
}));
vi.mock("../../../src/hooks/useTabularisClient", () => ({
  useTabularisClient: () => ({ call: mocks.call, uploadFile: mocks.uploadFile }),
}));
vi.mock("../../../src/hooks/usePlatformCapabilities", () => ({
  usePlatformCapabilities: () => ({
    negotiation: { environment: "browser" },
    chooseInputFile: mocks.chooseInputFile,
    readInputBlob: mocks.readInputBlob,
  }),
}));
vi.mock("../../../src/hooks/useTheme", () => ({ useTheme: () => mocks }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../../src/components/ui/ThemeSqlSample", () => ({ ThemeSqlSample: () => <div>SQL sample</div> }));

const preview = { digest: "verified-digest", manifest: { name: "local-theme", version: "1.0.0" }, variants: [{ id: "native-id", name: "Local dark", mode: "dark", origin: { kind: "installed", identity: { registryKey: "a".repeat(64), packageName: "local-theme", variantId: "dark" } } }] };
const archive = new Blob(["zip bytes"], { type: "application/zip" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.chooseInputFile.mockResolvedValue({ name: "theme.zip", reference: "browser-file-1" });
  mocks.readInputBlob.mockResolvedValue(archive);
  mocks.uploadFile.mockResolvedValue({ token: "upload-token", fileName: "theme.zip", mimeType: "application/zip", size: 9, expiresAt: "" });
  mocks.refreshCatalog.mockResolvedValue(undefined);
  mocks.call.mockImplementation(async (command: string) => {
    if (command === "preview_local_theme_package") return preview;
    if (command === "install_local_theme_package") return { warnings: [] };
    throw new Error(`Unexpected ${command}`);
  });
});

describe("local theme package UI in the browser", () => {
  it("uploads the archive once and binds preview and install to the upload token", async () => {
    render(<LocalThemePackageModal isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "themePackages.chooseArchive" }));
    await screen.findByText("local-theme · 1.0.0");
    // Browsers never see a server path, so the chosen file's name is shown.
    expect(screen.getByText("theme.zip")).toBeInTheDocument();
    expect(mocks.readInputBlob).toHaveBeenCalledWith("browser-file-1");
    expect(mocks.uploadFile).toHaveBeenCalledExactlyOnceWith({ contents: archive, fileName: "theme.zip", purpose: THEME_PACKAGE_UPLOAD_PURPOSE });
    expect(mocks.call).toHaveBeenCalledWith("preview_local_theme_package", { uploadToken: "upload-token" });

    fireEvent.click(screen.getByRole("button", { name: "themePackages.install" }));
    await screen.findByText("themePackages.installedHint");
    expect(mocks.call).toHaveBeenCalledWith("install_local_theme_package", { uploadToken: "upload-token", packageName: "local-theme", expectedDigest: "verified-digest" });
    expect(mocks.uploadFile).toHaveBeenCalledOnce();
    expect(mocks.call.mock.calls.flat()).not.toContainEqual(expect.objectContaining({ path: expect.anything() }));
  });

  it("does not upload or preview when the file chooser is cancelled", async () => {
    mocks.chooseInputFile.mockResolvedValueOnce(null);
    render(<LocalThemePackageModal isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "themePackages.chooseArchive" }));
    await screen.findByRole("button", { name: "themePackages.chooseArchive" });
    await vi.waitFor(() => expect(mocks.chooseInputFile).toHaveBeenCalled());
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("surfaces an upload failure without exposing an install action", async () => {
    mocks.uploadFile.mockRejectedValueOnce(new Error("Upload rejected"));
    render(<LocalThemePackageModal isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "themePackages.chooseArchive" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Upload rejected");
    expect(screen.getByRole("button", { name: "themePackages.install" })).toBeDisabled();
    expect(mocks.call).not.toHaveBeenCalled();
  });
});
