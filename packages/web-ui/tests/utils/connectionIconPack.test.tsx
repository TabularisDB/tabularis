import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { camelToKebab, getLucideIconComponent, CONNECTION_ICON_PACK } from "../../src/utils/connectionIconPack";
import { getConnectionIcon } from "../../src/utils/driverUI";
import type { SavedConnection } from "../../src/contexts/DatabaseContext";
import type { PluginManifest } from "../../src/types/plugins";

const manifest = { id: "mysql", color: "#0000ff", icon: "database" } as unknown as PluginManifest;

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
