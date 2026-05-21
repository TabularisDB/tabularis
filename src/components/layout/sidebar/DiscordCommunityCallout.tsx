import { useState } from "react";
import { X, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { DISCORD_URL } from "../../../config/links";
import { DiscordIcon } from "../../icons/DiscordIcon";

export const DISCORD_CALLOUT_STORAGE_KEY = "tabularis:discord-callout-v2-dismissed";

type CalloutStorage = Pick<Storage, "getItem" | "setItem">;

interface DiscordCommunityCalloutProps {
  /** Hook used by tests to inject a storage implementation. */
  storage?: CalloutStorage;
}

const resolveStorage = (storage?: CalloutStorage): CalloutStorage | null => {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
};

const computeInitialVisible = (storage?: CalloutStorage): boolean => {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    return store.getItem(DISCORD_CALLOUT_STORAGE_KEY) !== "true";
  } catch {
    return true;
  }
};

export const DiscordCommunityCallout = ({ storage }: DiscordCommunityCalloutProps) => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(() => computeInitialVisible(storage));

  if (!visible) return null;

  const dismiss = () => {
    try {
      resolveStorage(storage)?.setItem(DISCORD_CALLOUT_STORAGE_KEY, "true");
    } catch {
      // quota / privacy mode — still hide for this session
    }
    setVisible(false);
  };

  const handleJoin = () => {
    void openUrl(DISCORD_URL);
    dismiss();
  };

  return (
    <>
      {/* Persistent pulsing indicator anchored to the Discord button */}
      <span
        aria-hidden="true"
        data-testid="discord-callout-pulse"
        className="pointer-events-none absolute top-0 right-0 flex h-2.5 w-2.5"
      >
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-500 ring-2 ring-elevated" />
      </span>

      {/* Callout popover */}
      <div
        role="dialog"
        aria-labelledby="discord-callout-title"
        data-testid="discord-callout"
        className="absolute left-[calc(100%+0.75rem)] bottom-0 w-72 rounded-xl overflow-hidden z-40 text-white shadow-2xl shadow-indigo-900/60 ring-1 ring-white/15 bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-700 animate-fade-in"
      >
        {/* Pointer arrow toward the Discord icon */}
        <span
          aria-hidden="true"
          className="absolute -left-1.5 bottom-5 w-3 h-3 rotate-45 bg-indigo-600 ring-1 ring-white/15"
        />

        <div className="relative p-4">
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("discordCallout.dismiss")}
            className="absolute top-2 right-2 p-1 text-white/70 hover:text-white hover:bg-white/15 rounded-md transition-colors"
          >
            <X size={14} />
          </button>

          <div className="flex items-start gap-3 mb-3 pr-6">
            <div className="p-2 bg-white/15 rounded-lg shrink-0">
              <DiscordIcon size={20} className="text-white" />
            </div>
            <div>
              <div
                id="discord-callout-title"
                className="text-sm font-semibold leading-tight flex items-center gap-1.5"
              >
                <Sparkles size={14} className="text-yellow-300" />
                {t("discordCallout.title")}
              </div>
              <div className="text-xs text-indigo-50/90 mt-1 leading-snug">
                {t("discordCallout.body")}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleJoin}
            className="w-full text-sm font-semibold bg-white text-indigo-700 hover:bg-indigo-50 active:bg-indigo-100 transition-colors rounded-md py-2 shadow-sm"
          >
            {t("discordCallout.cta")}
          </button>
        </div>
      </div>
    </>
  );
};
