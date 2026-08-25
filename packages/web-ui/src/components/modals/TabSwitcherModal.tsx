import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X, FileCode, Network, BookOpen } from "lucide-react";
import { Table as TableIcon } from "lucide-react";
import type { Tab } from "../../types/editor";
import { getTabSwitcherRowClassName } from "../../utils/tabScroll";

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
      className="fixed inset-0 bg-black/50 flex items-start justify-center z-[100] backdrop-blur-sm pt-[15vh]"
      onClick={onDismiss}
    >
      <div
        className="bg-elevated border border-strong rounded-xl shadow-2xl w-[480px] max-h-[60vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-default bg-base">
          <h2 className="text-sm font-semibold text-primary">
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
                onClick={() => onSelect(tab.id)}
                className={getTabSwitcherRowClassName(isActive)}
              >
                {tab.type === "table" ? (
                  <TableIcon size={14} className="text-blue-400 shrink-0" />
                ) : tab.type === "notebook" ? (
                  <BookOpen size={14} className="text-orange-400 shrink-0" />
                ) : tab.type === "query_builder" ? (
                  <Network size={14} className="text-purple-400 shrink-0" />
                ) : (
                  <FileCode size={14} className="text-green-500 shrink-0" />
                )}
                <span className="flex-1 text-sm truncate">{tab.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-surface-tertiary text-muted hover:text-primary transition-all shrink-0"
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
