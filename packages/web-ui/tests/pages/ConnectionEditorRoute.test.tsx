import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectionEditorRoute } from "../../src/pages/ConnectionEditorRoute";

const mocks = vi.hoisted(() => ({
  activeConnectionId: null as string | null,
  connect: vi.fn<(connectionId: string) => Promise<void>>(),
  connectionId: undefined as string | undefined,
  isConnectionOpen: vi.fn<(connectionId: string) => boolean>(),
  navigate: vi.fn(),
  switchConnection: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => ({ connectionId: mocks.connectionId }),
}));

vi.mock("../../src/hooks/useDatabase", () => ({
  useDatabase: () => ({
    activeConnectionId: mocks.activeConnectionId,
    connect: mocks.connect,
    isConnectionOpen: mocks.isConnectionOpen,
    switchConnection: mocks.switchConnection,
  }),
}));

vi.mock("../../src/pages/Editor", () => ({
  Editor: () => <div>editor</div>,
}));

vi.mock("../../src/components/ui/EditorErrorBoundary", () => ({
  EditorErrorBoundary: ({ children }: { children: ReactNode }) => children,
}));

describe("ConnectionEditorRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeConnectionId = null;
    mocks.connectionId = undefined;
    mocks.connect.mockResolvedValue(undefined);
    mocks.isConnectionOpen.mockReturnValue(false);
  });

  it("redirects the legacy editor route to the active connection", async () => {
    mocks.activeConnectionId = "connection-1";

    render(<ConnectionEditorRoute />);

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith(
        "/connections/connection-1/editor",
        { replace: true },
      ),
    );
  });

  it("opens the connection from a direct editor URL", async () => {
    mocks.connectionId = "connection-2";

    render(<ConnectionEditorRoute />);

    await waitFor(() =>
      expect(mocks.connect).toHaveBeenCalledWith("connection-2"),
    );
  });

  it("switches to a connection that is already open", async () => {
    mocks.connectionId = "connection-3";
    mocks.isConnectionOpen.mockReturnValue(true);

    render(<ConnectionEditorRoute />);

    await waitFor(() =>
      expect(mocks.switchConnection).toHaveBeenCalledWith("connection-3"),
    );
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("keeps the URL synchronized when the active connection changes", async () => {
    mocks.connectionId = "connection-1";
    mocks.activeConnectionId = "connection-1";
    mocks.isConnectionOpen.mockReturnValue(true);
    const { rerender } = render(<ConnectionEditorRoute />);

    mocks.activeConnectionId = "connection-4";
    rerender(<ConnectionEditorRoute />);

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith(
        "/connections/connection-4/editor",
        { replace: true },
      ),
    );
  });

  it("returns to connections when a direct connection fails", async () => {
    mocks.connectionId = "missing";
    mocks.connect.mockRejectedValue(new Error("missing"));

    render(<ConnectionEditorRoute />);

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith("/connections", {
        replace: true,
      }),
    );
  });
});
