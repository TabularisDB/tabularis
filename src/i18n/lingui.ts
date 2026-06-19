import { i18n } from "@lingui/core";
import type { useLingui } from "@lingui/react/macro";

export { i18n };

/** The `t` macro function returned by `useLingui()` (tagged template + descriptor). */
export type LinguiT = ReturnType<typeof useLingui>["t"];

export async function dynamicActivate(locale: string): Promise<void> {
  const { messages } = await import(`../locales/${locale}/messages.ts`);
  i18n.load(locale, messages);
  i18n.activate(locale);
}
