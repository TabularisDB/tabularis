import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "../contexts/SettingsContext";

/** Optional AI discovery must not hold up settings hydration or reconnection. */
export async function detectAiDefaults(settings: Settings): Promise<Partial<Settings>> {
  if (!settings.aiEnabled || (settings.aiProvider && settings.aiModel)) return {};
  let provider = settings.aiProvider;
  if (!provider) {
    const providers = ["openai", "anthropic", "openrouter", "minimax"] as const;
    const available = await Promise.all(providers.map((provider) =>
      invoke<boolean>("check_ai_key", { provider }).catch(() => false),
    ));
    provider = providers.find((_, index) => available[index]) ?? null;
  }
  if (!provider) return {};
  if (settings.aiModel) return { aiProvider: provider };
  const models = await invoke<Record<string, string[]>>("get_ai_models", { forceRefresh: false });
  return { aiProvider: provider, aiModel: models[provider]?.[0] ?? null };
}
