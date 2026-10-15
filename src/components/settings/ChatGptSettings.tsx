import { useCallback, useEffect, useId, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toneStyle } from "../../utils/tones";
import { useSettings } from "../../hooks/useSettings";
import type { ChatGptModel, ChatGptSession } from "../../types/chatgpt";
import { OpenAIIcon } from "../icons/ClientIcons";
import { Select } from "../ui/Select";

const secondaryButton =
  "inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-secondary bg-surface-secondary border border-default rounded-lg hover:bg-surface-hover hover:text-primary transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export function ChatGptSettings() {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const fieldId = useId();
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
    <div className="space-y-4 pt-5 pb-4">
      <p className="text-sm leading-relaxed text-secondary">
        {t("settings.ai.chatgpt.description")}
      </p>
      {session && session.profiles.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label
              htmlFor={`${fieldId}-account`}
              className="text-sm font-medium text-primary"
            >
              {t("settings.ai.chatgpt.account")}
            </label>
            {active?.sharing && (
              <span
                role="status"
                className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
                style={toneStyle("success")}
              >
                <CheckCircle2 size={12} aria-hidden="true" />
                {t("settings.ai.chatgpt.usingPlan")}
              </span>
            )}
          </div>
          <Select
            id={`${fieldId}-account`}
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
        </div>
      )}
      {active && !active.sharing && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border p-3 text-sm leading-relaxed"
          style={toneStyle("warning")}
        >
          <AlertCircle
            size={16}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          {active.connected
            ? t("settings.ai.chatgpt.permissionRequired")
            : t("settings.ai.chatgpt.disconnected")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!active?.sharing && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void signIn(active?.id ?? null)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-accent-primary hover:bg-accent-primary/90 text-inverse rounded-lg text-sm font-medium transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <OpenAIIcon size={18} />
            {t("settings.ai.chatgpt.continue")}
          </button>
        )}
        {session && session.profiles.length > 0 && (
          <button
            type="button"
            disabled={busy !== null}
            className={secondaryButton}
            onClick={() => void signIn(null)}
          >
            <Plus size={14} aria-hidden="true" />
            {t("settings.ai.chatgpt.addAccount")}
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
          <ExternalLink size={14} aria-hidden="true" />
          {t("settings.ai.chatgpt.manageUsage")}
        </button>
        {active?.connected && (
          <button
            type="button"
            disabled={busy !== null}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs text-muted hover:text-primary hover:bg-surface-secondary transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            onClick={() => void signOut()}
          >
            <LogOut size={13} aria-hidden="true" />
            {t("settings.ai.chatgpt.signOut")}
          </button>
        )}
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
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg bg-surface-secondary px-3 py-2.5 text-sm text-secondary"
        >
          <Loader2
            size={16}
            className="shrink-0 animate-spin"
            aria-hidden="true"
          />
          {busy === "signIn"
            ? t("settings.ai.chatgpt.browserPending")
            : t("common.loading")}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border p-3 text-sm leading-relaxed break-words"
          style={toneStyle("danger")}
        >
          <AlertCircle
            size={16}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span className="min-w-0">{error}</span>
        </p>
      )}
      {active?.sharing && (
        <div className="space-y-2 border-t border-default pt-5">
          <label
            htmlFor={`${fieldId}-model`}
            className="block text-sm font-medium text-primary"
          >
            {t("settings.ai.defaultModel")}
          </label>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Select
                id={`${fieldId}-model`}
                ariaDescribedBy={`${fieldId}-model-help`}
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
                searchPlaceholder={t("settings.ai.searchPlaceholder")}
                noResultsLabel={t("settings.ai.noResults")}
                disabled={busy !== null}
              />
            </div>
            <button
              type="button"
              className={secondaryButton}
              aria-label={t("settings.ai.refresh")}
              title={t("settings.ai.refresh")}
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
              <RefreshCw size={18} aria-hidden="true" />
            </button>
          </div>
          <p
            id={`${fieldId}-model-help`}
            className="text-xs leading-relaxed text-muted"
          >
            {t("settings.ai.chatgpt.modelHelp")}
          </p>
        </div>
      )}
      <div className="flex items-start gap-2.5 rounded-lg bg-surface-secondary px-3 py-3 text-xs leading-relaxed text-secondary">
        <ShieldCheck
          size={15}
          className="mt-0.5 shrink-0 text-muted"
          aria-hidden="true"
        />
        <p>{t("settings.ai.chatgpt.privacy")}</p>
      </div>
    </div>
  );
}
