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

vi.mock("../../../src/hooks/useTabularisClient", () => ({
  useTabularisClient: () => ({
    call: (command: string, request: unknown) => invoke(command, request),
  }),
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
  loadSshConnections: () => sshMocks.loadSshConnections(),
  saveSshConnection: (name: string, ssh: unknown) =>
    sshMocks.saveSshConnection(name, ssh),
  updateSshConnection: (id: string, name: string, ssh: unknown) =>
    sshMocks.updateSshConnection(id, name, ssh),
  deleteSshConnection: (id: string) => sshMocks.deleteSshConnection(id),
  testSshConnection: (ssh: unknown, options: unknown) =>
    sshMocks.testSshConnection(ssh, options),
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

  it("themes create, edit, save, update, focus and checkboxes without changing delete semantics", async () => {
    render(<SshConnectionsManager />);
    await screen.findByText("Prod bastion");
    const create = screen.getByRole("button", { name: "sshConnections.createNew" });
    expect(create).toHaveClass("bg-accent-primary", "hover:bg-accent-primary/90", "text-inverse");
    expect(screen.getByTitle("sshConnections.edit")).toHaveClass("text-accent", "hover:bg-accent-primary/10");
    expect(screen.getByTitle("sshConnections.delete")).toHaveClass("text-accent-error");
    fireEvent.click(create);
    expect(screen.getByPlaceholderText("sshConnections.namePlaceholder")).toHaveClass("focus:border-focus");
    expect(screen.getByRole("button", { name: "sshConnections.save" })).toHaveClass("bg-accent-primary", "text-inverse");
    for (const checkbox of screen.getAllByRole("checkbox")) expect(checkbox).toHaveClass("accent-accent-primary");
    fireEvent.click(screen.getByRole("button", { name: "sshConnections.cancel" }));
    fireEvent.click(screen.getByTitle("sshConnections.edit"));
    expect(screen.getByRole("button", { name: "sshConnections.update" })).toHaveClass("bg-accent-primary", "text-inverse");
    expect(sshMocks.saveSshConnection).not.toHaveBeenCalled();
    expect(sshMocks.updateSshConnection).not.toHaveBeenCalled();
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
