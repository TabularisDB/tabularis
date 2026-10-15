import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportDatabaseModal } from "../../../src/components/modals/ImportDatabaseModal";

const mocks = vi.hoisted(() => ({
  call: vi.fn(), uploadFile: vi.fn(), showAlert: vi.fn(),
  subscribe: vi.fn().mockResolvedValue(() => {}),
  platform: { negotiation: { environment: "browser" }, readInputBlob: vi.fn().mockResolvedValue(new Blob(["SELECT 1;"])) },
}));
vi.mock("../../../src/hooks/useTabularisClient", () => ({ useTabularisClient: () => mocks }));
vi.mock("../../../src/hooks/usePlatformCapabilities", () => ({ usePlatformCapabilities: () => mocks.platform }));
vi.mock("../../../src/hooks/useDatabase", () => ({ useDatabase: () => ({ activeSchema: "public" }) }));
vi.mock("../../../src/hooks/useAlert", () => ({ useAlert: () => ({ showAlert: mocks.showAlert }) }));
const t = (key: string) => key;
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t }) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const props = () => ({
  isOpen: true, onClose: vi.fn(), onSuccess: vi.fn(), connectionId: "connection-1",
  databaseName: "app", targetDatabase: "app", inputFile: { reference: "file-1", name: "dump.sql" },
});

describe("ImportDatabaseModal cancellation", () => {
  beforeEach(() => {
    mocks.call.mockReset().mockResolvedValue(undefined);
    mocks.uploadFile.mockReset();
    mocks.showAlert.mockClear();
    mocks.subscribe.mockClear();
    mocks.platform.negotiation.environment = "browser";
  });

  it("keeps native imports on the file path without uploading", async () => {
    mocks.platform.negotiation.environment = "tauri";
    const callbacks = props();
    render(<ImportDatabaseModal {...callbacks} />);
    await act(async () => {});
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.call).toHaveBeenCalledExactlyOnceWith("import_database", {
      connectionId: "connection-1", database: "app", schema: "public", filePath: "file-1",
    }, expect.objectContaining({ cancellationId: expect.any(String) }));
    expect(callbacks.onSuccess).toHaveBeenCalledOnce();
  });

  it.each(["button", "escape"])("cancels an upload locally using %s before any SQL can start", async (action) => {
    const upload = deferred<{ token: string }>();
    mocks.uploadFile.mockReturnValue(upload.promise);
    const callbacks = props();
    render(<ImportDatabaseModal {...callbacks} />);
    await act(async () => {});
    if (action === "button") fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    else fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => {});
    expect(callbacks.onClose).toHaveBeenCalledOnce();
    expect(mocks.call).not.toHaveBeenCalled();
    await act(async () => { upload.resolve({ token: "cancelled-upload" }); });
    expect(mocks.call).not.toHaveBeenCalled();
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"])("ignores an old upload that will %s after closing and reopening", async (outcome) => {
    const oldUpload = deferred<{ token: string }>();
    const newUpload = deferred<{ token: string }>();
    mocks.uploadFile.mockReturnValueOnce(oldUpload.promise).mockReturnValueOnce(newUpload.promise);
    const callbacks = props();
    const view = render(<ImportDatabaseModal {...callbacks} />);
    await act(async () => {});
    view.rerender(<ImportDatabaseModal {...callbacks} isOpen={false} />);
    view.rerender(<ImportDatabaseModal {...callbacks} />);
    await act(async () => {
      if (outcome === "resolve") oldUpload.resolve({ token: "old" });
      else oldUpload.reject(new Error("stale upload failed"));
    });
    expect(mocks.call).not.toHaveBeenCalled();
    expect(screen.queryByText(/stale upload failed/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.cancel" })).toBeInTheDocument();
    await act(async () => { newUpload.resolve({ token: "new" }); });
    expect(mocks.call).toHaveBeenCalledExactlyOnceWith("import_database", {
      connectionId: "connection-1", database: "app", schema: "public", uploadToken: "new",
    }, expect.objectContaining({ cancellationId: expect.any(String) }));
    expect(callbacks.onSuccess).toHaveBeenCalledOnce();
  });

  it("does not close a completed new opening when an old backend cancellation returns", async () => {
    mocks.uploadFile.mockResolvedValue({ token: "ready" });
    const importing = deferred<void>();
    const cancelling = deferred<void>();
    mocks.call.mockReturnValueOnce(importing.promise).mockReturnValueOnce(cancelling.promise).mockResolvedValue(undefined);
    const callbacks = props();
    const view = render(<ImportDatabaseModal {...callbacks} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    view.rerender(<ImportDatabaseModal {...callbacks} isOpen={false} />);
    view.rerender(<ImportDatabaseModal {...callbacks} />);
    await act(async () => {});
    expect(screen.getByText("dump.importSuccess")).toBeInTheDocument();
    await act(async () => { cancelling.resolve(); importing.resolve(); });
    expect(callbacks.onClose).not.toHaveBeenCalled();
    expect(callbacks.onSuccess).toHaveBeenCalledOnce();
  });

  it.each(["complete", "retry"])("keeps the live import after failed cancellation so it can %s", async (outcome) => {
    mocks.uploadFile.mockResolvedValue({ token: "ready" });
    const importing = deferred<void>();
    mocks.call.mockReturnValueOnce(importing.promise).mockRejectedValueOnce(new Error("temporarily offline")).mockResolvedValue(undefined);
    const callbacks = props();
    render(<ImportDatabaseModal {...callbacks} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    await act(async () => {});
    expect(callbacks.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "common.cancel" })).toBeInTheDocument();
    act(() => mocks.subscribe.mock.calls[0][1]({
      connection_id: "connection-1", total_statements: 10, statements_executed: 5,
      percentage: 50, current_operation: "Still importing",
    }));
    expect(screen.getByText("Still importing")).toBeInTheDocument();
    if (outcome === "complete") {
      await act(async () => { importing.resolve(); });
      expect(callbacks.onSuccess).toHaveBeenCalledOnce();
      expect(screen.getByText("dump.importSuccess")).toBeInTheDocument();
    } else {
      fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
      await act(async () => {});
      expect(mocks.call.mock.calls.filter(([command]) => command === "cancel_import")).toHaveLength(2);
      expect(callbacks.onClose).toHaveBeenCalledOnce();
      await act(async () => { importing.resolve(); });
      expect(callbacks.onSuccess).not.toHaveBeenCalled();
    }
  });

  it("keeps an import completion that arrives while cancellation is pending", async () => {
    mocks.uploadFile.mockResolvedValue({ token: "ready" });
    const importing = deferred<void>();
    const cancelling = deferred<void>();
    mocks.call.mockReturnValueOnce(importing.promise).mockReturnValueOnce(cancelling.promise);
    const callbacks = props();
    render(<ImportDatabaseModal {...callbacks} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    await act(async () => { importing.resolve(); });
    expect(callbacks.onSuccess).toHaveBeenCalledOnce();
    expect(screen.getByText("dump.importSuccess")).toBeInTheDocument();
    await act(async () => { cancelling.reject(new Error("job already finished")); });
    expect(callbacks.onClose).not.toHaveBeenCalled();
    expect(screen.getByText("dump.importSuccess")).toBeInTheDocument();
  });

  it("does not start SQL after unmounting during upload", async () => {
    const upload = deferred<{ token: string }>();
    mocks.uploadFile.mockReturnValue(upload.promise);
    const view = render(<ImportDatabaseModal {...props()} />);
    await act(async () => {});
    view.unmount();
    await act(async () => { upload.resolve({ token: "old" }); });
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("starts once under StrictMode and cancels an already dispatched import on the backend", async () => {
    mocks.uploadFile.mockResolvedValue({ token: "ready" });
    const importing = deferred<void>();
    mocks.call.mockImplementation((command: string) => command === "import_database" ? importing.promise : Promise.resolve());
    const callbacks = props();
    render(<StrictMode><ImportDatabaseModal {...callbacks} /></StrictMode>);
    await act(async () => {});
    expect(mocks.uploadFile).toHaveBeenCalledOnce();
    expect(mocks.call).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    await act(async () => {});
    expect(mocks.call).toHaveBeenLastCalledWith("cancel_import", { connectionId: "connection-1" });
    expect(callbacks.onClose).toHaveBeenCalledOnce();
    await act(async () => { importing.resolve(); });
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
  });
});
