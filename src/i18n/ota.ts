import PO from "pofile";
import { generateMessageId } from "@lingui/message-utils/generateMessageId";
import { i18n } from "./lingui";

// Tolgee Content Delivery (public CDN, no auth) — serves <base>/<lng>.po (ICU).
const CDN = "https://cdn.tolg.ee/04ebb496deb39eaaf4703e8565ff6e62";

const OTA_ENABLED_KEY = "tabularis.i18n.otaEnabled";
const OTA_INTERVAL_MIN_KEY = "tabularis.i18n.otaIntervalMinutes";
const DEFAULT_INTERVAL_MIN = 15;

/** OTA is opt-out: enabled unless the user explicitly turned it off ("0"). */
export function isOtaEnabled(): boolean {
  try {
    return localStorage.getItem(OTA_ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setOtaEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(OTA_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    // no-op — OTA just stays at its default if storage is unavailable.
  }
}

export function getOtaIntervalMinutes(): number {
  try {
    const raw = Number(localStorage.getItem(OTA_INTERVAL_MIN_KEY));
    if (Number.isFinite(raw) && raw >= 1) return raw;
  } catch {
    // fall through to default
  }
  return DEFAULT_INTERVAL_MIN;
}

export function setOtaIntervalMinutes(minutes: number): void {
  try {
    localStorage.setItem(OTA_INTERVAL_MIN_KEY, String(minutes));
  } catch {
    // no-op
  }
}

/**
 * Overlay the latest Tolgee CDN translations onto the active Lingui catalog.
 *
 * The bundled compiled catalogs are the offline/instant base; this merges CDN
 * updates on top (Lingui's `load` is a merge), so a translation edited in Tolgee
 * shows up without a rebuild. Offline / not-yet-published / untranslated entries
 * are skipped, leaving the bundled value in place.
 *
 * Plural entries are intentionally NOT overlaid: the CDN serializes them as
 * gettext `msgstr[n]`, whose per-locale CLDR-category reconstruction is brittle,
 * and the bundled (build-time) catalog already carries correct plurals. Plurals
 * therefore update with releases, not OTA.
 */
export async function refreshFromCdn(locale: string): Promise<void> {
  let text: string;
  try {
    const res = await fetch(`${CDN}/${locale}.po`, { cache: "no-cache" });
    if (!res.ok) return;
    text = await res.text();
  } catch {
    return; // offline — keep the bundled catalog
  }

  let parsed;
  try {
    parsed = PO.parse(text);
  } catch {
    return; // malformed payload — keep the bundled catalog
  }

  const messages: Record<string, string> = {};
  for (const item of parsed.items) {
    if (!item.msgid || item.obsolete) continue;
    if (item.msgid_plural || item.msgstr.length > 1) continue; // plural -> bundled
    const value = item.msgstr[0];
    if (!value) continue; // untranslated -> keep bundled fallback
    // The runtime id is the hash of (source msgid, context) — matches the
    // compiled catalog, verified for plain + context entries in the spike.
    messages[generateMessageId(item.msgid, item.msgctxt ?? "")] = value;
  }

  if (Object.keys(messages).length === 0) return;
  i18n.load(locale, messages);
  i18n.activate(locale); // re-activate so <Trans>/useLingui consumers re-render
}
