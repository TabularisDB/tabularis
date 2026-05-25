import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { ConnectionIconImage } from "./ConnectionIconImage";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (s: string) => `tauri://${s}`,
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn().mockResolvedValue("/app/data"),
  join: vi.fn().mockImplementation(async (...parts: string[]) => parts.join("/")),
}));

// Helper: find the decorative img (alt="") which has role="presentation", not "img"
function queryImg(container: HTMLElement) {
  return container.querySelector("img");
}

describe("ConnectionIconImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders fallback initially then loads image", async () => {
    const { container } = render(
      <ConnectionIconImage path="connection-icons/a.png" size={16} fallback={<span>FB</span>} />
    );
    expect(screen.getByText("FB")).toBeInTheDocument(); // initial: src=null → fallback
    await waitFor(() => {
      expect(queryImg(container)).not.toBeNull();
    });
  });

  it("recovers from a previous failure when path changes to a valid one", async () => {
    const { rerender, container } = render(
      <ConnectionIconImage path="connection-icons/broken.png" size={16} fallback={<span>FB</span>} />
    );
    // Wait for image to render, then simulate failure
    await waitFor(() => expect(queryImg(container)).not.toBeNull());
    act(() => {
      queryImg(container)!.dispatchEvent(new Event("error"));
    });
    expect(screen.getByText("FB")).toBeInTheDocument();

    // New path arrives — should NOT stay in fallback (Fix 2: reset failed state)
    rerender(<ConnectionIconImage path="connection-icons/working.png" size={16} fallback={<span>FB</span>} />);
    await waitFor(() => {
      expect(queryImg(container)).not.toBeNull();
    });
  });
});
