import { fireEvent, render, screen } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsNewModal } from "../../../src/components/modals/WhatsNewModal";
import { SUPPORT_PROMPT_DISMISSED_KEY } from "../../../src/utils/supportPrompt";

vi.mock("../../../src/hooks/useTabularisClient", () => import("../../support/tauriBackedHooks"));
vi.mock("../../../src/hooks/usePlatformCapabilities", () => import("../../support/tauriBackedHooks"));
const entry = {
  version: "0.23.0",
  date: "2026-09-10",
  url: "https://github.com/TabularisDB/tabularis/releases/tag/v0.23.0",
  features: ["Save **SQL files**"],
  bugFixes: ["Keep typed characters"],
  breakingChanges: ["Review connection settings"],
};

const renderModal = (props = {}) => {
  const onClose = vi.fn();
  const view = render(
    <WhatsNewModal
      isOpen
      onClose={onClose}
      entries={[entry]}
      isLoading={false}
      {...props}
    />,
  );
  return { onClose, ...view };
};

describe("WhatsNewModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows the sponsorship invitation alongside every changelog section", () => {
    renderModal();
    expect(screen.getByRole("region", { name: "whatsNew.supportTitle" })).toBeInTheDocument();
    expect(screen.getByText("whatsNew.supportDescription")).toBeInTheDocument();
    expect(screen.getByText(/Andrea · debba/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Andrea Debernardi (debba)" })).toHaveAttribute("src", "/debba-avatar.jpg");
    expect(screen.getByText("SQL files").tagName).toBe("STRONG");
    expect(screen.getByText("Keep typed characters")).toBeInTheDocument();
    expect(screen.getByText("Review connection settings")).toBeInTheDocument();
  });

  it("opens the configured GitHub Sponsors profile externally without dismissing", () => {
    const { onClose } = renderModal();
    const link = screen.getByRole("link", { name: "whatsNew.supportAction" });
    expect(link).toHaveAttribute("href", "https://github.com/sponsors/debba");
    fireEvent.click(link);
    expect(openUrl).toHaveBeenCalledExactlyOnceWith("https://github.com/sponsors/debba");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("opens the project repository externally to leave a star without dismissing", () => {
    const { onClose } = renderModal();
    const link = screen.getByRole("link", { name: "whatsNew.supportStarAction" });
    expect(link).toHaveAttribute("href", "https://github.com/TabularisDB/tabularis");
    fireEvent.click(link);
    expect(openUrl).toHaveBeenCalledExactlyOnceWith("https://github.com/TabularisDB/tabularis");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("can be dismissed without sponsoring", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "whatsNew.dismiss" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("supports the accessible close button and Escape", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])("keeps sponsorship available with no entries (loading: %s)", (isLoading) => {
    renderModal({ entries: [], isLoading });
    expect(screen.getByRole("link", { name: "whatsNew.supportAction" })).toBeInTheDocument();
    expect(screen.queryByText("common.loading") !== null).toBe(isLoading);
  });

  it("remembers never-show-again after remounting without hiding the changelog", () => {
    const { onClose, unmount } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "whatsNew.supportNeverShow" }));
    expect(localStorage.getItem(SUPPORT_PROMPT_DISMISSED_KEY)).toBe("true");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.getByText("SQL files")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    unmount();
    renderModal();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.getByText("SQL files")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "whatsNew.dismiss" })).toBeInTheDocument();
  });

  it("keeps multiple modal instances in sync", () => {
    renderModal();
    renderModal();
    expect(screen.getAllByRole("region")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "whatsNew.supportNeverShow" })[0]);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("reports persistence failures instead of claiming the choice was saved", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "whatsNew.supportNeverShow" }));
    expect(screen.getByRole("alert")).toHaveTextContent("whatsNew.supportHideError");
    expect(screen.getByRole("region")).toBeInTheDocument();
    expect(localStorage.getItem(SUPPORT_PROMPT_DISMISSED_KEY)).toBeNull();
  });

  it("does not render when closed", () => {
    renderModal({ isOpen: false });
    expect(screen.queryByRole("link", { name: "whatsNew.supportAction" })).not.toBeInTheDocument();
  });
});
