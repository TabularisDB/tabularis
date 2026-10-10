import type { PlatformEnvironment } from "../platform/capabilities";
import { TabularisClient, type TabularisTransport } from "./client";
import type { SessionNegotiation } from "./session";
import { HttpTransport } from "./transports/httpTransport";
import { TauriTransport } from "./transports/tauriTransport";

interface InitializableBrowserTransport extends TabularisTransport {
  initialize(): Promise<SessionNegotiation>;
}

interface ClientBootstrapDependencies {
  readonly createTauriTransport?: () => TabularisTransport;
  readonly createHttpTransport?: () => InitializableBrowserTransport;
}

export interface TabularisRuntimeBootstrap {
  readonly client: TabularisClient;
  readonly session: SessionNegotiation | null;
}

export async function bootstrapTabularisRuntime(
  environment: PlatformEnvironment,
  dependencies: ClientBootstrapDependencies = {},
): Promise<TabularisRuntimeBootstrap> {
  if (environment === "tauri") {
    const transport =
      dependencies.createTauriTransport?.() ?? new TauriTransport();
    return { client: new TabularisClient(transport), session: null };
  }

  const transport =
    dependencies.createHttpTransport?.() ?? new HttpTransport();
  const session = await transport.initialize();
  return { client: new TabularisClient(transport), session };
}

export async function bootstrapTabularisClient(
  environment: PlatformEnvironment,
  dependencies: ClientBootstrapDependencies = {},
): Promise<TabularisClient> {
  return (await bootstrapTabularisRuntime(environment, dependencies)).client;
}
