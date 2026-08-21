import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  X,
  Sparkles,
  Bug,
  AlertTriangle,
  Rocket,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { Modal } from "../ui/Modal";
import { SocialLinks } from "../SocialLinks";
import Markdown from "react-markdown";
import { type ChangelogEntry } from "../../utils/changelog";

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

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-900/30 rounded-lg">
              <Sparkles size={20} className="text-purple-400" />
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
            className="text-secondary hover:text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto">
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
                        openUrl(`${entry.url}${UTM_SUFFIX}`)
                      }
                      className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      {t("whatsNew.readMore")}
                      <ExternalLink size={12} />
                    </button>
                  )}
                </div>

                {entry.features.length > 0 && (
                  <ChangelogSection
                    icon={<Rocket size={14} className="text-green-400" />}
                    label={t("whatsNew.features")}
                    items={entry.features}
                    dotColor="before:bg-green-400/60"
                  />
                )}

                {entry.bugFixes.length > 0 && (
                  <ChangelogSection
                    icon={<Bug size={14} className="text-blue-400" />}
                    label={t("whatsNew.bugFixes")}
                    items={entry.bugFixes}
                    dotColor="before:bg-blue-400/60"
                  />
                )}

                {entry.breakingChanges.length > 0 && (
                  <ChangelogSection
                    icon={
                      <AlertTriangle size={14} className="text-yellow-400" />
                    }
                    label={t("whatsNew.breakingChanges")}
                    items={entry.breakingChanges}
                    dotColor="before:bg-yellow-400/60"
                  />
                )}

                {entries.indexOf(entry) < entries.length - 1 && (
                  <div className="border-t border-default" />
                )}
              </div>
            ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex items-center justify-between">
          <SocialLinks iconSize={18} />
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
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
              if (href) openUrl(href);
            }}
            className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors cursor-pointer"
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
