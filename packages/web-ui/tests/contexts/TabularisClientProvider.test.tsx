import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { TabularisClient, type TabularisTransport } from "../../src/api/client";
import { TabularisClientProvider } from "../../src/contexts/TabularisClientProvider";
import { useTabularisClient } from "../../src/hooks/useTabularisClient";

const createClient = () =>
  new TabularisClient({
    call: async () => {
      throw new Error("Unexpected command call");
    },
    callUnmigrated: async () => {
      throw new Error("Unexpected unmigrated command call");
    },
    subscribe: async () => {
      throw new Error("Unexpected event subscription");
    },
    emit: async () => {
      throw new Error("Unexpected event emission");
    },
  } as TabularisTransport);

describe("TabularisClientProvider", () => {
  it("exposes the application client without exposing its transport", () => {
    const client = createClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TabularisClientProvider client={client}>
        {children}
      </TabularisClientProvider>
    );

    const { result } = renderHook(() => useTabularisClient(), { wrapper });

    expect(result.current).toBe(client);
  });

  it("fails clearly when the hook is used outside the provider", () => {
    expect(() => renderHook(() => useTabularisClient())).toThrow(
      "useTabularisClient must be used within TabularisClientProvider",
    );
  });
});
