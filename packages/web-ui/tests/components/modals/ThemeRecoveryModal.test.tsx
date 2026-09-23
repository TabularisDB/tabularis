import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeRecoveryModal } from "../../../src/components/modals/ThemeRecoveryModal";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), refresh: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../../src/hooks/useTheme", () => ({ useTheme: () => ({ refreshCatalog: mocks.refresh }) }));
beforeEach(() => { vi.clearAllMocks(); mocks.invoke.mockResolvedValue([]); mocks.refresh.mockResolvedValue(undefined); });

describe("explicit theme recovery", () => {
  it("does not recover on opening or closing the dialog", () => {
    const close = vi.fn(); render(<ThemeRecoveryModal isOpen onClose={close} />);
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "common.close" })[0]);
    expect(close).toHaveBeenCalled(); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("checks only after confirmation and surfaces partial failures with a read-only refresh", async () => {
    mocks.invoke.mockResolvedValueOnce(["One namespace still needs recovery"]);
    render(<ThemeRecoveryModal isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "common.confirm" }));
    await screen.findByText("themePackages.recoveryDone");
    expect(mocks.invoke).toHaveBeenCalledWith("recover_theme_packages");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("One namespace still needs recovery");
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
  });
});
