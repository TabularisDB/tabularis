import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StorageTab } from "../../../src/components/settings/StorageTab";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  showAlert: vi.fn(),
  platform: {
    supports: vi.fn(),
    chooseServerPath: vi.fn(),
    showMessage: vi.fn(),
    negotiation: { capabilities: { chooseServerPath: { supported: true } } },
    openStorageLocation: vi.fn(async () => undefined),
    restartApplication: vi.fn(async () => undefined),
  },
}));
vi.mock("../../../src/hooks/useTabularisClient", () => ({ useTabularisClient: () => ({ call: mocks.call }) }));
vi.mock("../../../src/hooks/usePlatformCapabilities", () => ({ usePlatformCapabilities: () => mocks.platform }));
vi.mock("../../../src/hooks/useAlert", () => ({ useAlert: () => ({ showAlert: mocks.showAlert }) }));
vi.mock("lucide-react", async () => await vi.importActual("lucide-react"));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const info = {
  currentPath: "/home/u/.config/tabularis",
  defaultPath: "/home/u/.config/tabularis",
  customPath: "/srv/tabularis",
  source: "default",
  restartRequired: true,
};

function useEnvironment(desktop: boolean) {
  mocks.platform.supports.mockImplementation((capability: string) =>
    capability === "chooseServerPath" ? true : desktop,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.platform.openStorageLocation.mockResolvedValue(undefined);
  mocks.platform.restartApplication.mockResolvedValue(undefined);
  mocks.call.mockImplementation(async (command: string) => {
    if (command === "get_storage_location") return info;
    if (command === "inspect_storage_location") return { exists: true, isEmpty: true, hasTabularisData: false };
    throw new Error(`Unexpected command: ${command}`);
  });
});

describe("StorageTab", () => {
  it("offers the host folder and restart only on desktop", async () => {
    useEnvironment(true);
    render(<StorageTab />);
    fireEvent.click(await screen.findByText("settings.storage.openFolder"));
    fireEvent.click(screen.getByText("settings.storage.restartNow"));
    expect(mocks.platform.openStorageLocation).toHaveBeenCalledOnce();
    expect(mocks.platform.restartApplication).toHaveBeenCalledOnce();
  });

  it("hides host-only actions in the browser and asks for a server restart", async () => {
    useEnvironment(false);
    render(<StorageTab />);
    expect(await screen.findByText("settings.storage.restartServer")).toBeInTheDocument();
    expect(screen.queryByText("settings.storage.openFolder")).not.toBeInTheDocument();
    expect(screen.queryByText("settings.storage.restartNow")).not.toBeInTheDocument();
  });

  it("inspects a folder chosen through the platform server path picker", async () => {
    useEnvironment(false);
    mocks.platform.chooseServerPath.mockResolvedValue({ reference: "/srv/data" });
    render(<StorageTab />);
    const change = await screen.findByText("settings.storage.changeFolder");
    await waitFor(() => expect(change.closest("button")).toBeEnabled());
    fireEvent.click(change);
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith("inspect_storage_location", { path: "/srv/data" }),
    );
    expect(mocks.platform.chooseServerPath).toHaveBeenCalledWith({ kind: "directory" });
  });
});
