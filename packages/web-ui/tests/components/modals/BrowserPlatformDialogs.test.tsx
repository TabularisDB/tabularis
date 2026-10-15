import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserPlatformDialogs } from "../../../src/components/modals/BrowserPlatformDialogs";
import {
  requestBrowserMessage,
  requestBrowserSaveTarget,
  requestBrowserServerPath,
} from "../../../src/platform/browserDialogs";

const call = vi.fn();
const showAlert = vi.fn();

vi.mock("../../../src/hooks/useTabularisClient", () => ({
  useTabularisClient: () => ({ call }),
}));

vi.mock("../../../src/hooks/useAlert", () => ({
  useAlert: () => ({ showAlert }),
}));

describe("BrowserPlatformDialogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("browses server entries and resolves a selected file", async () => {
    call.mockResolvedValue({
      path: "/srv/databases",
      parent: null,
      entries: [
        {
          name: "main.sqlite",
          path: "/srv/databases/main.sqlite",
          kind: "file",
        },
      ],
    });
    render(<BrowserPlatformDialogs />);

    let selection!: Promise<{ reference: string } | null>;
    act(() => {
      selection = requestBrowserServerPath({
        kind: "file",
        title: "Choose database",
        filters: [{ name: "SQLite", extensions: ["sqlite"] }],
      });
    });

    expect(await screen.findByText("Choose database")).toBeInTheDocument();
    fireEvent.click(await screen.findByText("main.sqlite"));
    fireEvent.click(
      screen.getByRole("button", { name: "serverFilePicker.select" }),
    );

    await expect(selection).resolves.toEqual({
      reference: "/srv/databases/main.sqlite",
    });
    expect(call).toHaveBeenCalledWith("list_server_directory", {});
  });

  it("creates a save target inside the selected server folder", async () => {
    call.mockImplementation((command: string) => {
      if (command === "list_server_directory") {
        return Promise.resolve({
          path: "/srv/databases",
          parent: null,
          entries: [],
        });
      }
      return Promise.resolve({ path: "/srv/databases/database.db" });
    });
    render(<BrowserPlatformDialogs />);

    let selection!: Promise<{ reference: string } | null>;
    act(() => {
      selection = requestBrowserSaveTarget({ suggestedName: "database.db" });
    });

    const input = await screen.findByDisplayValue("database.db");
    fireEvent.change(input, { target: { value: "customers.db" } });
    fireEvent.click(
      screen.getByRole("button", { name: "serverFilePicker.select" }),
    );

    await expect(selection).resolves.toEqual({
      reference: "/srv/databases/database.db",
    });
    expect(call).toHaveBeenLastCalledWith("resolve_server_save_target", {
      directory: "/srv/databases",
      fileName: "customers.db",
    });
  });

  it("routes platform messages through the shared Tailwind alert", async () => {
    showAlert.mockImplementation(
      (_message: string, options: { onClose?: () => void }) =>
        options.onClose?.(),
    );
    render(<BrowserPlatformDialogs />);

    await act(() =>
      requestBrowserMessage({
        title: "Unavailable",
        message: "Server browsing is disabled",
        kind: "info",
      }),
    );

    await waitFor(() =>
      expect(showAlert).toHaveBeenCalledWith(
        "Server browsing is disabled",
        expect.objectContaining({ title: "Unavailable", kind: "info" }),
      ),
    );
  });
});
