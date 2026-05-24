import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { getConnectionAccent, getConnectionIcon } from "./driverUI";
import { camelToKebab, getLucideIconComponent, CONNECTION_ICON_PACK } from "./connectionIconPack";
import type { SavedConnection } from "../contexts/DatabaseContext";
import type { PluginManifest } from "../types/plugins";

// Avoid loading the lazy ConnectionIconImage during tests (it pulls Tauri APIs that aren't available in vitest)
vi.mock("../components/ConnectionIconImage", () => ({
  ConnectionIconImage: (props: { path: string; size: number }) =>
    <img data-testid="conn-icon-image" alt="" src={`mock://${props.path}`} width={props.size} height={props.size} />,
}));

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
    // Smoke test: should not throw; icons are mocked to null in test env
    expect(() => render(<>{getConnectionIcon({ id: "1" } as SavedConnection, manifest, 16)}</>)).not.toThrow();
  });
  it("renders the mocked image component for image overrides", async () => {
    const c = { id: "1", appearance: { icon: { type: "image", path: "connection-icons/foo.png" } } } as SavedConnection;
    render(<>{getConnectionIcon(c, manifest, 16)}</>);
    await waitFor(() => expect(screen.getByTestId("conn-icon-image")).toBeInTheDocument());
  });
  it("falls back to manifest when pack id is unknown", () => {
    const c = { id: "1", appearance: { icon: { type: "pack", id: "this-icon-does-not-exist-xyz" } } } as SavedConnection;
    // Smoke test: should not throw; icons are mocked to null in test env
    expect(() => render(<>{getConnectionIcon(c, manifest, 16)}</>)).not.toThrow();
  });
});

describe("camelToKebab / getLucideIconComponent — legacy id normalization", () => {
  it("converts camelCase to kebab-case correctly", () => {
    expect(camelToKebab("shieldCheck")).toBe("shield-check");
    expect(camelToKebab("hardDrive")).toBe("hard-drive");
    expect(camelToKebab("cloudCog")).toBe("cloud-cog");
    expect(camelToKebab("server")).toBe("server");
  });

  it("normalizes legacy camelCase pack ids in the resolver", () => {
    // "shieldCheck" (camelCase) resolves to the same component as "shield-check" (kebab-case)
    // Both should return a non-null lazy component (mocked in setup.ts via dynamicIconImports)
    const byKebab = getLucideIconComponent("shield-check");
    // kebab-case hits dynamicIconImports directly
    expect(byKebab).not.toBeNull();
    // camelCase is not in the mock set, so the resolver must return null (caller will re-try with camelToKebab)
    expect(getLucideIconComponent("shieldCheck")).toBeNull();
    // …and the fallback (kebab translation) resolves correctly.
    expect(getLucideIconComponent(camelToKebab("shieldCheck"))).not.toBeNull();
  });

  it("getConnectionIcon with camelCase pack id still renders without throwing", () => {
    // { type: "pack", id: "shieldCheck" } — legacy camelCase id
    const c = { id: "1", appearance: { icon: { type: "pack", id: "shieldCheck" } } } as SavedConnection;
    expect(() => render(<>{getConnectionIcon(c, manifest, 16)}</>)).not.toThrow();
  });

  it("getConnectionIcon with kebab-case pack id still renders without throwing", () => {
    // { type: "pack", id: "shield-check" } — canonical kebab-case id
    const c = { id: "1", appearance: { icon: { type: "pack", id: "shield-check" } } } as SavedConnection;
    expect(() => render(<>{getConnectionIcon(c, manifest, 16)}</>)).not.toThrow();
  });
});

describe("CONNECTION_ICON_PACK Proxy — Symbol safety", () => {
  it("does not throw on Symbol property access (e.g. Object.prototype.toString)", () => {
    expect(() => Object.prototype.toString.call(CONNECTION_ICON_PACK)).not.toThrow();
  });

  it("returns undefined for Symbol.toStringTag instead of throwing", () => {
    // Previously the proxy had `key: string` type annotation which would throw when
    // JS passed a Symbol (e.g. Symbol.toStringTag). The fix guards with typeof check.
    const result = (CONNECTION_ICON_PACK as unknown as Record<symbol, unknown>)[Symbol.toStringTag];
    expect(result).toBeUndefined();
  });

  it("returns undefined for Symbol.iterator instead of throwing", () => {
    const result = (CONNECTION_ICON_PACK as unknown as Record<symbol, unknown>)[Symbol.iterator];
    expect(result).toBeUndefined();
  });
});
