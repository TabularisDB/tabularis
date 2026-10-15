import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TabularisClient } from "../../src/api/client";
import { TauriTransport } from "../../src/api/transports/tauriTransport";
import { TabularisClientProvider } from "../../src/contexts/TabularisClientProvider";
import { usePluginInstallConfirmation } from "../../src/hooks/usePluginInstallConfirmation";

const client = new TabularisClient(new TauriTransport());
const wrapper = ({ children }: { children: ReactNode }) => (
  <TabularisClientProvider client={client}>{children}</TabularisClientProvider>
);

describe("usePluginInstallConfirmation", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("installs only after confirmation and preserves the selected registry", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { result } = renderHook(() => usePluginInstallConfirmation(), { wrapper });

    expect(invoke).not.toHaveBeenCalled();

    await act(async () => {
      await expect(
        result.current.confirm({
          slug: "postgres-driver",
          version: "1.2.3",
          registry: "https://registry.example/api",
        }),
      ).resolves.toBe(true);
    });

    expect(invoke).toHaveBeenCalledWith("install_plugin", {
      pluginId: "postgres-driver",
      version: "1.2.3",
      registryUrl: "https://registry.example/api",
    });
  });

  it("keeps the confirmation active when installation fails", async () => {
    const failingInvoke = <T,>(): Promise<T> =>
      Promise.reject(new Error("install failed"));
    const failingClient = new TabularisClient(new TauriTransport(failingInvoke));
    const failingWrapper = ({ children }: { children: ReactNode }) => (
      <TabularisClientProvider client={failingClient}>
        {children}
      </TabularisClientProvider>
    );
    const { result } = renderHook(() => usePluginInstallConfirmation(), {
      wrapper: failingWrapper,
    });

    let confirmed = true;
    await act(async () => {
      confirmed = await result.current.confirm({ slug: "postgres-driver" });
    });

    expect(confirmed).toBe(false);
    expect(result.current.error).toContain("install failed");
    expect(result.current.busy).toBe(false);
  });
});
