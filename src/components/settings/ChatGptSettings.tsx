import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { useSettings } from "../../hooks/useSettings";
import type { ChatGptModel, ChatGptSession } from "../../types/chatgpt";
import { OpenAIIcon } from "../icons/ClientIcons";
import { Select } from "../ui/Select";

const secondaryButton =
  "px-3 py-2 text-sm text-secondary bg-surface-secondary border border-default rounded-lg hover:text-primary disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export function ChatGptSettings() {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const [session, setSession] = useState<ChatGptSession | null>(null);
  const [models, setModels] = useState<ChatGptModel[]>([]);
  const [busy, setBusy] = useState<"load" | "signIn" | "account" | null>(
    "load",
  );
  const [error, setError] = useState<string | null>(null);
  const signingIn = useRef(false);
  const active = session?.profiles.find(
    (p) => p.id === session.activeProfileId,
  );

  const loadModels = useCallback(async (next: ChatGptSession) => {
    const profile = next.profiles.find((p) => p.id === next.activeProfileId);
    if (!profile?.sharing) {
      setModels([]);
      return;
    }
    const available = await invoke<ChatGptModel[]>("get_chatgpt_models");
    setModels(available);
  }, []);

  useEffect(() => {
    let alive = true;
    invoke<ChatGptSession>("get_chatgpt_session")
      .then(async (next) => {
        if (!alive) return;
        setSession(next);
        const profile = next.profiles.find(
          (p) => p.id === next.activeProfileId,
        );
        if (profile?.sharing) {
          const available = await invoke<ChatGptModel[]>("get_chatgpt_models");
          if (alive) setModels(available);
        }
      })
      .catch((e: unknown) => {
        if (alive) setError(String(e));
      })
      .finally(() => {
        if (alive) setBusy(null);
      });
    return () => {
      alive = false;
      if (signingIn.current)
        void invoke("cancel_chatgpt_sign_in").catch(console.error);
    };
  }, []);

  const signIn = async (profileId: string | null) => {
    setError(null);
    setBusy("signIn");
    signingIn.current = true;
    try {
      const next = await invoke<ChatGptSession>("sign_in_chatgpt", {
        profileId,
      });
      setSession(next);
      setModels([]);
      await updateSetting("aiModel", "");
      await loadModels(next);
    } catch (e) {
      setError(String(e));
      // Failed code exchanges can still have a saved client registration.
      const next = await invoke<ChatGptSession>("get_chatgpt_session").catch(
        () => null,
      );
      if (next) setSession(next);
    } finally {
      signingIn.current = false;
      setBusy(null);
    }
  };

  const selectAccount = async (profileId: string) => {
    setBusy("account");
    setError(null);
    setModels([]);
    try {
      await updateSetting("aiModel", "");
      const next = await invoke<ChatGptSession>("select_chatgpt_profile", {
        profileId,
      });
      setSession(next);
      await loadModels(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    if (!active) return;
    setBusy("account");
    setError(null);
    try {
      const warning = await invoke<string | null>("sign_out_chatgpt", {
        profileId: active.id,
      });
      setModels([]);
      await updateSetting("aiModel", "");
      setSession(await invoke<ChatGptSession>("get_chatgpt_session"));
      if (warning) setError(warning);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4 py-3">
      <p className="text-sm text-secondary">
        {t("settings.ai.chatgpt.description")}
      </p>
      {session && session.profiles.length > 0 && (
        <Select
          ariaLabel={t("settings.ai.chatgpt.account")}
          value={session.activeProfileId}
          options={session.profiles.map((p) => p.id)}
          labels={Object.fromEntries(
            session.profiles.map((p) => [
              p.id,
              `${p.label}${p.email ? ` · ${p.email}` : ""}`,
            ]),
          )}
          placeholder={t("settings.ai.chatgpt.account")}
          disabled={busy !== null}
          onChange={(id) => void selectAccount(id)}
        />
      )}
      {active && (
        <p role="status" className="text-sm text-primary">
          {active.sharing
            ? t("settings.ai.chatgpt.usingPlan")
            : active.connected
              ? t("settings.ai.chatgpt.permissionRequired")
              : t("settings.ai.chatgpt.disconnected")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void signIn(active?.id ?? null)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-inverse border border-strong rounded-lg text-sm disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <OpenAIIcon size={18} />
          {t("settings.ai.chatgpt.continue")}
        </button>
        {session && session.profiles.length > 0 && (
          <button
            type="button"
            disabled={busy !== null}
            className={secondaryButton}
            onClick={() => void signIn(null)}
          >
            {t("settings.ai.chatgpt.addAccount")}
          </button>
        )}
        {active?.connected && (
          <button
            type="button"
            disabled={busy !== null}
            className={secondaryButton}
            onClick={() => void signOut()}
          >
            {t("settings.ai.chatgpt.signOut")}
          </button>
        )}
        <button
          type="button"
          className={secondaryButton}
          onClick={() =>
            void invoke("open_chatgpt_usage").catch((e: unknown) =>
              setError(String(e)),
            )
          }
        >
          {t("settings.ai.chatgpt.manageUsage")}
        </button>
        {busy === "signIn" && (
          <button
            type="button"
            className={secondaryButton}
            onClick={() =>
              void invoke("cancel_chatgpt_sign_in").catch((e: unknown) =>
                setError(String(e)),
              )
            }
          >
            {t("common.cancel")}
          </button>
        )}
      </div>
      {busy && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" />
          {busy === "signIn"
            ? t("settings.ai.chatgpt.browserPending")
            : t("common.loading")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-accent-error">
          {error}
        </p>
      )}
      {active?.sharing && (
        <div className="space-y-2 border-t border-default pt-4">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Select
                ariaLabel={t("settings.ai.defaultModel")}
                value={
                  models.some((m) => m.slug === settings.aiModel)
                    ? settings.aiModel
                    : null
                }
                options={models.map((m) => m.slug)}
                labels={Object.fromEntries(
                  models.map((m) => [m.slug, m.displayName]),
                )}
                onChange={(model) => void updateSetting("aiModel", model)}
                placeholder={t("settings.ai.modelPlaceholder")}
                noResultsLabel={t("settings.ai.noResults")}
                disabled={busy !== null}
              />
            </div>
            <button
              type="button"
              className={secondaryButton}
              disabled={busy !== null}
              onClick={async () => {
                if (!session) return;
                setBusy("load");
                setError(null);
                setModels([]);
                try {
                  await loadModels(session);
                } catch (e) {
                  setError(String(e));
                } finally {
                  setBusy(null);
                }
              }}
            >
              {t("settings.ai.refresh")}
            </button>
          </div>
          <p className="text-xs text-muted">
            {t("settings.ai.chatgpt.modelHelp")}
          </p>
        </div>
      )}
      <p className="text-xs text-muted">{t("settings.ai.chatgpt.privacy")}</p>
    </div>
  );
}
