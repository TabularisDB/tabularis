import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImportFromAppModal } from "../../../src/components/modals/ImportFromAppModal";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  chooseInputFile: vi.fn(),
  readInputFile: vi.fn(),
  openExternalUrl: vi.fn(),
}));

vi.mock("../../../src/hooks/useDatabase", () => ({
  useDatabase: () => ({ connectionGroups: [] }),
}));

vi.mock("../../../src/hooks/useTabularisClient", () => ({
  useTabularisClient: () => mocks,
}));

vi.mock("../../../src/hooks/usePlatformCapabilities", () => ({
  usePlatformCapabilities: () => ({
    negotiation: { environment: "tauri" },
    chooseInputFile: mocks.chooseInputFile,
    readInputFile: mocks.readInputFile,
    openExternalUrl: mocks.openExternalUrl,
  }),
}));

vi.mock("../../../src/components/ui/Select", () => ({
  Select: () => null,
}));

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
    mocks.chooseInputFile.mockResolvedValue({
      name: "export.json",
      reference: "/tmp/export.json",
    });
    mocks.readInputFile.mockResolvedValue(
      new TextEncoder().encode(JSON.stringify(TAB_PAYLOAD)),
    );
    mocks.call.mockImplementation((command: string) => {
      if (command === "list_connection_import_sources") return Promise.resolve([]);
      if (command === "preview_tabularis_import_file") {
        return Promise.resolve({ kind: "preview", preview: PREVIEW });
      }
      return Promise.resolve(undefined);
    });
  });

  it("previews a plaintext export through an opaque file reference, then applies", async () => {
    const { onImported, onClose } = renderModal();

    await clickContinue();

    await waitFor(() => {
      expect(mocks.call).toHaveBeenCalledWith("preview_tabularis_import_file", {
        file: { kind: "serverPath", path: "/tmp/export.json" },
      });
    });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByText("connections.importFromApp.importCount"));

    await waitFor(() => {
      expect(mocks.call).toHaveBeenCalledWith("apply_prepared_tabularis_import", {
        resolutions: [{ index: 0, action: "import", groupId: "" }],
      });
    });
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("prompts for a password before the backend decrypts and previews", async () => {
    mocks.call.mockImplementation((command: string, request?: { password?: string }) => {
      if (command === "list_connection_import_sources") return Promise.resolve([]);
      if (command === "preview_tabularis_import_file") {
        return Promise.resolve(
          request?.password
            ? { kind: "preview", preview: PREVIEW }
            : { kind: "passwordRequired" },
        );
      }
      return Promise.resolve(undefined);
    });
    renderModal();

    await clickContinue();
    await waitFor(() => expect(passwordInput()).toBeInTheDocument());

    fireEvent.change(passwordInput(), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByText("connections.importPasswordModal.unlock"));

    await waitFor(() => {
      expect(mocks.call).toHaveBeenCalledWith("preview_tabularis_import_file", {
        file: { kind: "serverPath", path: "/tmp/export.json" },
        password: "hunter2",
      });
    });
    await screen.findByText("connections.importFromApp.importCount");
  });

  it("surfaces a wrong-password error and keeps the modal open", async () => {
    mocks.call.mockImplementation((command: string, request?: { password?: string }) => {
      if (command === "list_connection_import_sources") return Promise.resolve([]);
      if (command === "preview_tabularis_import_file") {
        return request?.password
          ? Promise.reject("wrong password or corrupted file")
          : Promise.resolve({ kind: "passwordRequired" });
      }
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
    expect(onImported).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
