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

export async function bootstrapTabularisClient(
  environment: PlatformEnvironment,
  dependencies: ClientBootstrapDependencies = {},
): Promise<TabularisClient> {
  if (environment === "tauri") {
    const transport =
      dependencies.createTauriTransport?.() ?? new TauriTransport();
    return new TabularisClient(transport);
  }

  const transport =
    dependencies.createHttpTransport?.() ?? new HttpTransport();
  await transport.initialize();
  return new TabularisClient(transport);
}
