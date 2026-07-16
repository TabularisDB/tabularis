import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { ImportFromAppModal } from "../../../src/components/modals/ImportFromAppModal";

// The global plugin-fs mock only exposes writeTextFile; the modal also needs
// readTextFile for the Tabularis JSON path.
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn(),
  readTextFile: vi.fn(),
  BaseDirectory: { Document: 1 },
}));

vi.mock("../../../src/hooks/useDatabase", () => ({
  useDatabase: () => ({ connectionGroups: [] }),
}));

// The real Select is portal/ref-heavy; these tests drive the modal via the
// default resolutions, so a no-op stand-in is enough.
vi.mock("../../../src/components/ui/Select", () => ({
  Select: () => null,
}));

const mockInvoke = vi.mocked(invoke);
const mockOpen = vi.mocked(open);
const mockReadTextFile = vi.mocked(readTextFile);

const TAB_PAYLOAD = {
  version: 1,
  groups: [],
  connections: [{ id: "c1", name: "Prod" }],
};

const PREVIEW = {
  sourceName: "Tabularis",
  credentialsAborted: false,
  items: [
    {
      index: 0,
      name: "Prod",
      driverId: "postgres",
      driverInstalled: true,
      host: "db",
      port: 5432,
      database: "app",
      username: "u",
      hasSsh: false,
      hasPassword: false,
      status: { kind: "ready" },
    },
  ],
};

function renderModal(onImported = vi.fn(), onClose = vi.fn()) {
  render(
    <ImportFromAppModal isOpen={true} onClose={onClose} onImported={onImported} />,
  );
  return { onImported, onClose };
}

async function clickContinue() {
  fireEvent.click(await screen.findByText("common.continue"));
}

function passwordInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="password"]');
  if (!input) throw new Error("password input not rendered");
  return input;
}

describe("ImportFromAppModal — Tabularis JSON import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_connection_import_sources") return Promise.resolve([]);
      if (cmd === "preview_tabularis_import") return Promise.resolve(PREVIEW);
      return Promise.resolve(undefined);
    });
    mockOpen.mockResolvedValue("/tmp/export.json");
  });

  it("previews a plaintext export (no silent import), then applies on confirm", async () => {
    mockReadTextFile.mockResolvedValue(JSON.stringify(TAB_PAYLOAD));
    const { onImported, onClose } = renderModal();

    await clickContinue();

    // Preview is fetched; nothing is imported yet and the modal stays open.
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("preview_tabularis_import", {
        payload: TAB_PAYLOAD,
      });
    });
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "apply_tabularis_import",
      expect.anything(),
    );
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByText("connections.importFromApp.importCount"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("apply_tabularis_import", {
        payload: TAB_PAYLOAD,
        resolutions: [{ index: 0, action: "import", groupId: "" }],
      });
    });
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("prompts for a password on an encrypted export, decrypts, then previews", async () => {
    const envelope = { encrypted: true, ciphertext: "…" };
    mockReadTextFile.mockResolvedValue(JSON.stringify(envelope));
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_connection_import_sources") return Promise.resolve([]);
      if (cmd === "decrypt_export_payload") return Promise.resolve(TAB_PAYLOAD);
      if (cmd === "preview_tabularis_import") return Promise.resolve(PREVIEW);
      return Promise.resolve(undefined);
    });
    renderModal();

    await clickContinue();

    await waitFor(() => expect(passwordInput()).toBeInTheDocument());
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "preview_tabularis_import",
      expect.anything(),
    );

    fireEvent.change(passwordInput(), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByText("connections.importPasswordModal.unlock"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("decrypt_export_payload", {
        envelope,
        password: "hunter2",
      });
    });
    // After decrypt it previews (rather than importing and closing silently).
    expect(mockInvoke).toHaveBeenCalledWith("preview_tabularis_import", {
      payload: TAB_PAYLOAD,
    });
    await screen.findByText("connections.importFromApp.importCount");
  });

  it("surfaces a wrong-password error and keeps the modal open", async () => {
    const envelope = { encrypted: true, ciphertext: "…" };
    mockReadTextFile.mockResolvedValue(JSON.stringify(envelope));
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_connection_import_sources") return Promise.resolve([]);
      if (cmd === "decrypt_export_payload")
        return Promise.reject("wrong password or corrupted file");
      return Promise.resolve(undefined);
    });
    const { onImported, onClose } = renderModal();

    await clickContinue();
    await waitFor(() => expect(passwordInput()).toBeInTheDocument());

    fireEvent.change(passwordInput(), { target: { value: "bad" } });
    fireEvent.click(screen.getByText("connections.importPasswordModal.unlock"));

    await waitFor(() => {
      expect(screen.getByText(/wrong password or corrupted file/)).toBeInTheDocument();
    });
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "preview_tabularis_import",
      expect.anything(),
    );
    expect(onImported).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
