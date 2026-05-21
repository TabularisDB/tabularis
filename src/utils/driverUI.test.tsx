import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { getConnectionAccent, getConnectionIcon } from "./driverUI";
import type { SavedConnection } from "../contexts/DatabaseContext";
import type { PluginManifest } from "../types/plugins";

// Avoid loading the lazy ConnectionIconImage during tests (it pulls Tauri APIs that aren't available in vitest)
vi.mock("../components/ConnectionIconImage", () => ({
  ConnectionIconImage: (props: { path: string; size: number }) =>
    <img data-testid="conn-icon-image" alt="" src={`mock://${props.path}`} width={props.size} height={props.size} />,
}));

// Ensure lucide-react is never auto-mocked — we need real icon components
vi.unmock("lucide-react");

const manifest = { id: "mysql", color: "#0000ff", icon: "database" } as unknown as PluginManifest;

describe("getConnectionAccent", () => {
  it("uses override when present", () => {
    const c = { appearance: { accentColor: "#ff0000" } } as SavedConnection;
    expect(getConnectionAccent(c, manifest)).toBe("#ff0000");
  });
  it("falls back to manifest color when override missing", () => {
    expect(getConnectionAccent({} as SavedConnection, manifest)).toBe("#0000ff");
  });
  it("falls back to grey when both missing", () => {
    expect(getConnectionAccent(null, null)).toBe("#64748b");
  });
});

describe("getConnectionIcon", () => {
  it("renders emoji when override is emoji", () => {
    const c = { id: "1", appearance: { icon: { type: "emoji", value: "🐘" } } } as SavedConnection;
    render(<>{getConnectionIcon(c, manifest, 16)}</>);
    expect(screen.getByText("🐘")).toBeInTheDocument();
  });
  it("falls back to manifest icon when override missing", () => {
    const { container } = render(<>{getConnectionIcon({ id: "1" } as SavedConnection, manifest, 16)}</>);
    expect(container.firstChild).toBeTruthy();
  });
  it("renders the mocked image component for image overrides", async () => {
    const c = { id: "1", appearance: { icon: { type: "image", path: "connection-icons/foo.png" } } } as SavedConnection;
    render(<>{getConnectionIcon(c, manifest, 16)}</>);
    await waitFor(() => expect(screen.getByTestId("conn-icon-image")).toBeInTheDocument());
  });
  it("falls back to manifest when pack id is unknown", () => {
    const c = { id: "1", appearance: { icon: { type: "pack", id: "this-icon-does-not-exist-xyz" } } } as SavedConnection;
    const { container } = render(<>{getConnectionIcon(c, manifest, 16)}</>);
    expect(container.firstChild).toBeTruthy();
  });
});
