import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { usePlatformCapabilities } from "../../hooks/usePlatformCapabilities";
import {
  X,
  Sparkles,
  Bug,
  AlertTriangle,
  Rocket,
  ExternalLink,
  Loader2,
  Heart,
  Star,
} from "lucide-react";
import { Modal } from "../ui/Modal";
import { SocialLinks } from "../SocialLinks";
import { GITHUB_URL } from "../../config/links";
import Markdown from "react-markdown";
import { type ChangelogEntry } from "../../utils/changelog";
import {
  dismissSupportPrompt,
  isSupportPromptDismissed,
  subscribeToSupportPrompt,
} from "../../utils/supportPrompt";

interface WhatsNewModalProps {
  isOpen: boolean;
  onClose: () => void;
  entries: ChangelogEntry[];
  isLoading: boolean;
}

const UTM_SUFFIX = "?utm_src=tabularis-app";

export const WhatsNewModal = ({
  isOpen,
  onClose,
  entries,
  isLoading,
}: WhatsNewModalProps) => {
  const { t } = useTranslation();
  const platform = usePlatformCapabilities();
  const supportDismissed = useSyncExternalStore(
    subscribeToSupportPrompt,
    isSupportPromptDismissed,
  );
  const [supportHideError, setSupportHideError] = useState(false);

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[640px] max-w-[calc(100vw-2rem)] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent-secondary/15 rounded-lg">
              <Sparkles size={20} className="text-accent-secondary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {t("whatsNew.title")}
              </h2>
              {entries.length > 0 && (
                <p className="text-xs text-secondary">
                  {t("whatsNew.subtitle", { version: entries[0].version })}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="text-secondary hover:text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto min-h-0">
          {!supportDismissed && (
            <section
              aria-labelledby="whats-new-support-title"
              className="rounded-xl border border-accent-secondary/20 bg-linear-to-br from-accent-secondary/10 via-accent-secondary/5 to-transparent p-4"
            >
              <div className="flex items-start gap-3">
                <img
                  src="/debba-avatar.jpg"
                  alt="Andrea Debernardi (debba)"
                  width={56}
                  height={56}
                  className="h-14 w-14 shrink-0 rounded-lg border border-strong bg-base p-0.5 shadow-sm"
                />
                <div className="min-w-0 space-y-1.5">
                  <h3 id="whats-new-support-title" className="text-sm font-semibold text-primary">
                    {t("whatsNew.supportTitle")}
                  </h3>
                  <p className="text-sm leading-relaxed text-secondary">
                    {t("whatsNew.supportDescription")}
                  </p>
                  <p className="text-xs text-secondary">
                    {t("whatsNew.supportThanks")}{" "}
                    <span className="inline-block font-medium italic text-primary">— Andrea · debba</span>
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <a
                  href="https://github.com/sponsors/debba"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => {
                    event.preventDefault();
                    void platform.openExternalUrl("https://github.com/sponsors/debba");
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent-secondary px-3 py-2 text-xs font-medium text-on-accent-secondary transition-colors hover:bg-accent-secondary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-secondary"
                >
                  <Heart size={14} className="shrink-0" aria-hidden="true" />
                  {t("whatsNew.supportAction")}
                  <ExternalLink size={14} className="shrink-0" aria-hidden="true" />
                </a>
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => {
                    event.preventDefault();
                    void platform.openExternalUrl(GITHUB_URL);
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-strong bg-base/50 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-secondary"
                >
                  <Star size={14} className="shrink-0 text-accent-warning" aria-hidden="true" />
                  {t("whatsNew.supportStarAction")}
                </a>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      dismissSupportPrompt();
                    } catch (error) {
                      console.error("Failed to save sponsorship prompt preference:", error);
                      setSupportHideError(true);
                    }
                  }}
                  className="rounded text-xs text-secondary underline underline-offset-4 transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-secondary"
                >
                  {t("whatsNew.supportNeverShow")}
                </button>
              </div>
              {supportHideError && (
                <p role="alert" className="mt-3 text-sm text-accent-error">
                  {t("whatsNew.supportHideError")}
                </p>
              )}
            </section>
          )}

          {isLoading && (
            <div className="text-center py-8 text-muted">
              <Loader2 size={24} className="animate-spin mx-auto mb-2" />
              {t("common.loading")}
            </div>
          )}

          {!isLoading &&
            entries.map((entry) => (
              <div key={entry.version} className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-primary">
                      v{entry.version}
                    </span>
                    <span className="text-xs text-muted">
                      {new Date(entry.date).toLocaleDateString()}
                    </span>
                  </div>
                  {entry.url && (
                    <button
                      onClick={() =>
                        void platform.openExternalUrl(`${entry.url}${UTM_SUFFIX}`)
                      }
                      className="flex items-center gap-1.5 text-xs text-accent transition-colors"
                    >
                      {t("whatsNew.readMore")}
                      <ExternalLink size={12} />
                    </button>
                  )}
                </div>

                {entry.features.length > 0 && (
                  <ChangelogSection
                    icon={<Rocket size={14} className="text-accent-success" />}
                    label={t("whatsNew.features")}
                    items={entry.features}
                    dotColor="before:bg-accent-success/60"
                  />
                )}

                {entry.bugFixes.length > 0 && (
                  <ChangelogSection
                    icon={<Bug size={14} className="text-accent" />}
                    label={t("whatsNew.bugFixes")}
                    items={entry.bugFixes}
                    dotColor="before:bg-accent-primary/60"
                  />
                )}

                {entry.breakingChanges.length > 0 && (
                  <ChangelogSection
                    icon={
                      <AlertTriangle size={14} className="text-accent-warning" />
                    }
                    label={t("whatsNew.breakingChanges")}
                    items={entry.breakingChanges}
                    dotColor="before:bg-accent-warning/60"
                  />
                )}

                {entries.indexOf(entry) < entries.length - 1 && (
                  <div className="border-t border-default" />
                )}
              </div>
            ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex shrink-0 flex-wrap items-center justify-between gap-3">
          <SocialLinks iconSize={18} />
          <button
            onClick={onClose}
            className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-inverse rounded-lg text-sm font-medium transition-colors"
          >
            {t("whatsNew.dismiss")}
          </button>
        </div>
      </div>
    </Modal>
  );
};

function ChangelogSection({
  icon,
  label,
  items,
  dotColor,
}: {
  icon: React.ReactNode;
  label: string;
  items: string[];
  dotColor: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs uppercase font-bold text-muted">{label}</span>
      </div>
      <ul className="space-y-1.5 overflow-hidden">
        {items.map((item, i) => (
          <li
            key={i}
            className={`text-sm text-secondary pl-5 relative break-words before:content-[''] before:absolute before:left-1.5 before:top-2 before:w-1.5 before:h-1.5 before:rounded-full ${dotColor}`}
          >
            <InlineMarkdown text={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function InlineMarkdown({ text }: { text: string }) {
  const platform = usePlatformCapabilities();
  return (
    <Markdown
      components={{
        // Keep list items on a single line: unwrap the paragraph react-markdown
        // wraps inline content in.
        p: ({ children }) => <>{children}</>,
        // Open links via the OS opener instead of navigating the app window.
        a: ({ href, children }) => (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              if (href) void platform.openExternalUrl(href);
            }}
            className="text-accent underline underline-offset-2 transition-colors cursor-pointer"
          >
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="px-1 py-0.5 rounded bg-base text-primary font-mono text-xs">
            {children}
          </code>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-primary">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
      }}
    >
      {text}
    </Markdown>
  );
}
