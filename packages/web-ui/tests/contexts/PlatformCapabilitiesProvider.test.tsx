import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { PlatformCapabilities } from "../../src/platform/capabilities";
import { PlatformCapabilitiesProvider } from "../../src/contexts/PlatformCapabilitiesProvider";
import { usePlatformCapabilities } from "../../src/hooks/usePlatformCapabilities";

const capabilities = {
  negotiation: {
    environment: "tauri",
    capabilities: {},
  },
} as unknown as PlatformCapabilities;

describe("PlatformCapabilitiesProvider", () => {
  it("exposes one negotiated platform adapter", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlatformCapabilitiesProvider capabilities={capabilities}>
        {children}
      </PlatformCapabilitiesProvider>
    );

    const { result } = renderHook(() => usePlatformCapabilities(), { wrapper });

    expect(result.current).toBe(capabilities);
  });

  it("fails clearly when the hook is used outside the provider", () => {
    expect(() => renderHook(() => usePlatformCapabilities())).toThrow(
      "usePlatformCapabilities must be used within PlatformCapabilitiesProvider",
    );
  });
});
