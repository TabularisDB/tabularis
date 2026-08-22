export interface PluginInstallRequest {
  slug: string;
  version?: string | null;
  registry?: string | null;
}

export const PLUGIN_INSTALL_DEADLINE_MS = 30 * 60 * 1000;
