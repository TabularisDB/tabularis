import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TabularisClient } from "../../src/api/client";
import { TauriTransport } from "../../src/api/transports/tauriTransport";
import { TabularisClientProvider } from "../../src/contexts/TabularisClientProvider";
import { PluginInstallRoutePage } from "../../src/pages/PluginInstallRoutePage";

vi.mock("../../src/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: { tabulariumRegistryUrl: "https://configured.example" },
  }),
}));

vi.mock("../../src/components/modals/PluginInstallConfirmModal", () => ({
  PluginInstallConfirmModal: ({
    request,
    onConfirm,
    onCancel,
    configuredRegistry,
  }: {
    request: {
      slug: string;
      version?: string | null;
      registry?: string | null;
    } | null;
    onConfirm: () => void;
    onCancel: () => void;
    configuredRegistry?: string | null;
  }) =>
    request ? (
      <div>
        <span>{request.slug}</span>
        <span>{request.registry}</span>
        <span>{configuredRegistry}</span>
        <button type="button" onClick={onConfirm}>
          Confirm install
        </button>
        <button type="button" onClick={onCancel}>
          Cancel install
        </button>
      </div>
    ) : null,
}));

const client = new TabularisClient(new TauriTransport());

function LocationProbe() {
  const location = useLocation();
  return <span>{location.pathname}</span>;
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <TabularisClientProvider client={client}>
      {children}
    </TabularisClientProvider>
  );
}

function renderRoute(initialEntry: string) {
  return render(
    <Providers>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/install/:slug" element={<PluginInstallRoutePage />} />
          <Route path="/connections" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </Providers>,
  );
}

describe("PluginInstallRoutePage", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("requires confirmation, installs from the selected registry, and clears the route", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    renderRoute(
      "/install/postgres-driver?version=1.2.3&registry=https%3A%2F%2Fregistry.example%2Fapi",
    );

    expect(screen.getByText("postgres-driver")).toBeInTheDocument();
    expect(screen.getByText("https://registry.example/api")).toBeInTheDocument();
    expect(screen.getByText("https://configured.example")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm install" }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("install_plugin", {
        pluginId: "postgres-driver",
        version: "1.2.3",
        registryUrl: "https://registry.example/api",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("/connections")).toBeInTheDocument(),
    );
  });

  it("cancels without installing and rejects invalid install routes", () => {
    renderRoute("/install/postgres-driver");
    fireEvent.click(screen.getByRole("button", { name: "Cancel install" }));
    expect(screen.getByText("/connections")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();

    renderRoute("/install/INVALID");
    expect(screen.getAllByText("/connections")).toHaveLength(2);
    expect(invoke).not.toHaveBeenCalled();
  });
});
