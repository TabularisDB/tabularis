import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { BookOpen, ExternalLink, Globe, Loader2, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import DOMPurify from "dompurify";

import { Modal } from "../ui/Modal";
import type { PluginReadme } from "../../types/plugins";
import { toRegistryLocale } from "../../i18n/registryLocale";
import { rewriteReadmeUrls } from "../../utils/pluginReadme";

interface PluginReadmeModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Registry slug of the plugin whose README to show. */
  slug: string;
  /** Display name for the modal header. */
  pluginName: string;
  /** Registry that serves this plugin; defaults to the configured one. */
  registryUrl?: string | null;
}

// Styling for the registry's server-rendered README HTML (same recipe as the
// notebook markdown preview, tuned for a scrollable document pane).
const README_PROSE =
  "text-sm text-secondary leading-relaxed " +
  "[&_h1]:text-xl [&_h1]:font-bold [&_h1]:mb-3 [&_h1]:mt-4 [&_h1]:text-primary first:[&_h1]:mt-0 " +
  "[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-primary " +
  "[&_h3]:text-base [&_h3]:font-medium [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-primary " +
  "[&_p]:mb-2 " +
  "[&_code]:bg-surface-secondary [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono " +
  "[&_pre]:bg-surface-secondary [&_pre]:p-3 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:mb-2 " +
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2 " +
  "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-2 " +
  "[&_li]:mb-1 " +
  "[&_a]:text-blue-400 [&_a]:underline [&_a]:cursor-pointer " +
  "[&_blockquote]:border-l-2 [&_blockquote]:border-muted [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted " +
  "[&_hr]:border-default [&_hr]:my-4 " +
  "[&_img]:max-w-full [&_img]:rounded " +
  "[&_table]:border-collapse [&_table]:w-full [&_table]:mb-2 " +
  "[&_th]:border [&_th]:border-default [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold " +
  "[&_td]:border [&_td]:border-default [&_td]:px-2 [&_td]:py-1 [&_td]:text-xs " +
  "[&_strong]:font-semibold [&_strong]:text-primary " +
  "[&_em]:italic";

/**
 * WordPress-style plugin details modal: renders the plugin's README as served
 * by the Tabularium registry, asking for the app's UI language first. The
 * registry resolves the closest available translation and reports the locale
 * it actually served, so we can show a "not available in your language" note
 * instead of guessing.
 */
export function PluginReadmeModal({
  isOpen,
  onClose,
  slug,
  pluginName,
  registryUrl,
}: PluginReadmeModalProps) {
  const { t, i18n } = useTranslation();
  const [readme, setReadme] = useState<PluginReadme | null>(null);
  const [error, setError] = useState<string | null>(null);

  const appLanguage = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const requestedLocale = toRegistryLocale(appLanguage);

  // Fetch once per (slug, locale); results stick around so reopening the
  // modal is instant. State is only touched from the async callbacks.
  useEffect(() => {
    if (!isOpen || readme || error) return;
    let cancelled = false;
    invoke<PluginReadme>("fetch_plugin_readme", {
      slug,
      locale: requestedLocale,
      registryUrl: registryUrl ?? null,
    })
      .then((r) => {
        if (!cancelled) setReadme(r);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, readme, error, slug, requestedLocale, registryUrl]);

  const safeHtml = useMemo(() => {
    if (!readme?.html) return null;
    const clean = DOMPurify.sanitize(readme.html, {
      USE_PROFILES: { html: true },
    });
    // Relative image/link paths only make sense inside the plugin's repo —
    // resolve them so README screenshots actually load.
    return rewriteReadmeUrls(clean, readme.repo_url ?? null);
  }, [readme]);

  const loading = isOpen && !readme && !error;
  const docsUrl = readme?.documentation_url ?? null;
  // The registry fell back to another language (usually English) — worth a
  // note, but only when the user's language isn't the one served.
  const servedBase = readme?.locale?.split("-")[0]?.toLowerCase() ?? null;
  const localeFellBack =
    !!safeHtml && !!servedBase && servedBase !== appLanguage.split("-")[0].toLowerCase();

  if (!isOpen) return null;

  const handleContentClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor) return;
    // Never let README links navigate the app window — open externally.
    event.preventDefault();
    const href = anchor.getAttribute("href");
    if (href && /^https?:\/\//i.test(href)) void openUrl(href);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      overlayClassName="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] backdrop-blur-sm"
    >
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[720px] max-w-[92vw] max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-blue-900/30 rounded-lg">
              <BookOpen size={18} className="text-blue-400" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold capitalize text-primary">
                {pluginName}
              </h2>
              <p className="text-xs text-secondary">
                {t("connectionCatalogue.readmeSubtitle", {
                  defaultValue: "Plugin README",
                })}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="text-secondary hover:text-primary transition-colors shrink-0 cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto">
          {localeFellBack && readme?.locale && (
            <div className="flex items-center gap-2 rounded-lg border border-default bg-base/60 px-3 py-2 text-xs text-muted">
              <Globe size={13} className="shrink-0" />
              <span>
                {t("connectionCatalogue.readmeFallbackLocale", {
                  locale: readme.locale,
                  defaultValue:
                    "This README isn't available in your language yet — showing “{{locale}}”.",
                })}
              </span>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
              <Loader2 size={16} className="animate-spin" />
              {t("connectionCatalogue.readmeLoading", {
                defaultValue: "Loading README…",
              })}
            </div>
          ) : safeHtml ? (
            <div
              className={README_PROSE}
              onClick={handleContentClick}
              dangerouslySetInnerHTML={{ __html: safeHtml }}
            />
          ) : (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <BookOpen size={24} className="text-muted" />
              <p className="text-sm text-muted">
                {t("connectionCatalogue.readmeUnavailable", {
                  defaultValue: "No README is available for this plugin.",
                })}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
          {docsUrl && (
            <button
              type="button"
              onClick={() => void openUrl(docsUrl)}
              className="px-4 py-2 text-sm text-secondary hover:text-primary rounded-lg border border-default transition-colors flex items-center gap-2 cursor-pointer"
            >
              <ExternalLink size={14} />
              {t("connectionCatalogue.openDocumentation", {
                defaultValue: "Open full documentation",
              })}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
