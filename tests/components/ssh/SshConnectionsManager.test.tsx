import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { SshConnectionsManager } from "../../../src/components/ssh/SshConnectionsManager";
import type { SshConnection } from "../../../src/utils/ssh";

const sshMocks = vi.hoisted(() => ({
  loadSshConnections: vi.fn(),
  saveSshConnection: vi.fn(),
  updateSshConnection: vi.fn(),
  deleteSshConnection: vi.fn(),
  testSshConnection: vi.fn(),
  validateSshConnection: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// The global setup mock doesn't cover every icon this component uses.
vi.mock("lucide-react", () => ({
  Plus: () => null,
  Edit2: () => null,
  Trash2: () => null,
  Check: () => null,
  Loader2: () => null,
  Zap: () => null,
  XCircle: () => null,
  Eye: () => null,
  EyeOff: () => null,
  X: () => null,
  AlertTriangle: () => null,
  ChevronDown: () => null,
  Search: () => null,
}));

vi.mock("../../../src/utils/ssh", () => ({
  loadSshConnections: sshMocks.loadSshConnections,
  saveSshConnection: sshMocks.saveSshConnection,
  updateSshConnection: sshMocks.updateSshConnection,
  deleteSshConnection: sshMocks.deleteSshConnection,
  testSshConnection: sshMocks.testSshConnection,
  validateSshConnection: sshMocks.validateSshConnection,
}));

const CONNECTIONS: SshConnection[] = [
  {
    id: "ssh-1",
    name: "Prod bastion",
    host: "bastion.example.com",
    port: 22,
    user: "deploy",
    auth_type: "password",
  } as SshConnection,
];

function mockSavedConnections(sshUsage: Array<string | undefined>) {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "get_connections") {
      return Promise.resolve(
        sshUsage.map((sshId, i) => ({
          id: `db-${i}`,
          name: `db-${i}`,
          params: { ssh_connection_id: sshId },
        })),
      );
    }
    return Promise.resolve(null);
  });
}

describe("SshConnectionsManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sshMocks.loadSshConnections.mockResolvedValue(CONNECTIONS);
    sshMocks.deleteSshConnection.mockResolvedValue(undefined);
    mockSavedConnections([]);
  });

  it("shows the empty state when no connections exist", async () => {
    sshMocks.loadSshConnections.mockResolvedValue([]);
    render(<SshConnectionsManager />);
    expect(
      await screen.findByText("sshConnections.noConnections"),
    ).toBeInTheDocument();
  });

  it("lists loaded connections with user@host:port", async () => {
    render(<SshConnectionsManager />);
    expect(await screen.findByText("Prod bastion")).toBeInTheDocument();
    expect(
      screen.getByText("deploy@bastion.example.com:22"),
    ).toBeInTheDocument();
  });

  it("opens the editor form when Create New is clicked", async () => {
    render(<SshConnectionsManager />);
    await screen.findByText("Prod bastion");
    fireEvent.click(screen.getByText("sshConnections.createNew"));
    expect(
      screen.getByPlaceholderText("sshConnections.namePlaceholder"),
    ).toBeInTheDocument();
  });

  it("asks for confirmation before deleting and deletes on confirm", async () => {
    render(<SshConnectionsManager />);
    await screen.findByText("Prod bastion");

    fireEvent.click(screen.getByTitle("sshConnections.delete"));
    expect(
      await screen.findByText("sshConnections.confirmDelete"),
    ).toBeInTheDocument();
    expect(sshMocks.deleteSshConnection).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("common.delete"));
    await waitFor(() => {
      expect(sshMocks.deleteSshConnection).toHaveBeenCalledWith("ssh-1");
    });
  });

  it("warns how many database connections use the tunnel being deleted", async () => {
    mockSavedConnections(["ssh-1", "ssh-1", "other-ssh", undefined]);
    render(<SshConnectionsManager />);
    await screen.findByText("Prod bastion");

    fireEvent.click(screen.getByTitle("sshConnections.delete"));
    // The i18n test mock returns the key itself, so assert the key is present
    // in the confirmation message (the real string interpolates {{count}}).
    expect(
      await screen.findByText(/sshConnections\.deleteInUse/),
    ).toBeInTheDocument();
  });

  it("does not show the usage warning when no connection uses the tunnel", async () => {
    render(<SshConnectionsManager />);
    await screen.findByText("Prod bastion");

    fireEvent.click(screen.getByTitle("sshConnections.delete"));
    await screen.findByText("sshConnections.confirmDelete");
    expect(screen.queryByText(/deleteInUse/)).not.toBeInTheDocument();
  });
});
