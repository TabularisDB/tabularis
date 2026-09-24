import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X, FileCode, Network, BookOpen } from "lucide-react";
import { Table as TableIcon } from "lucide-react";
import type { Tab } from "../../types/editor";
import { getTabSwitcherRowClassName } from "../../utils/tabScroll";
import { onActivationKey } from "../../utils/keyboardEvents";

interface TabSwitcherModalProps {
  isOpen: boolean;
  tabs: Tab[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onDismiss: () => void;
}

export const TabSwitcherModal = ({
  isOpen,
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onDismiss,
}: TabSwitcherModalProps) => {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onDismiss]);

  if (!isOpen) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 bg-black/50 flex items-start justify-center z-[100] backdrop-blur-sm pt-[15vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-elevated border border-strong rounded-xl shadow-2xl w-[480px] max-h-[60vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-default bg-base">
          <h2 id={titleId} className="text-sm font-semibold text-primary">
            {t("editor.tabSwitcher.title")}
          </h2>
          <span className="text-xs text-muted">{t("editor.tabSwitcher.hint")}</span>
        </div>

        {/* Tab list */}
        <div ref={listRef} className="overflow-y-auto flex flex-col py-1">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                role="button"
                tabIndex={0}
                aria-current={isActive ? "true" : undefined}
                onClick={() => onSelect(tab.id)}
                onKeyDown={onActivationKey(() => onSelect(tab.id))}
                className={`${getTabSwitcherRowClassName(isActive)} focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus`}
              >
                {tab.type === "table" ? (
                  <TableIcon size={14} className="text-accent shrink-0" />
                ) : tab.type === "notebook" ? (
                  <BookOpen size={14} className="text-accent-warning shrink-0" />
                ) : tab.type === "query_builder" ? (
                  <Network size={14} className="text-accent-secondary shrink-0" />
                ) : (
                  <FileCode size={14} className="text-accent-success shrink-0" />
                )}
                <span className="flex-1 text-sm truncate">{tab.title}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  aria-label={t("editor.closeTab")}
                  className="p-0.5 rounded opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-tertiary text-muted hover:text-primary transition-all shrink-0"
                  title={t("editor.closeTab")}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-default bg-base/50 flex justify-between text-xs text-muted">
          <span>{t("editor.tabSwitcher.tabs", { count: tabs.length })}</span>
          <span>{t("editor.tabSwitcher.escHint")}</span>
        </div>
      </div>
    </div>
  );
};
