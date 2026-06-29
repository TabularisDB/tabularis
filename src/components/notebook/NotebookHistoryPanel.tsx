import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { History, X, Check } from "lucide-react";
import type { NotebookState } from "../../types/notebook";
import { describeChange, type ChangeDescriptor } from "../../utils/notebookUndo";

interface NotebookHistoryPanelProps {
  /** Full timeline, oldest first. */
  states: NotebookState[];
  currentIndex: number;
  onJump: (index: number) => void;
  onClose: () => void;
}

export function NotebookHistoryPanel({
  states,
  currentIndex,
  onJump,
  onClose,
}: NotebookHistoryPanelProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const labelFor = (d: ChangeDescriptor): string =>
    t(`editor.notebook.history.change.${d.kind}`, { n: d.n ?? 0 });

  const descriptorAt = (index: number): ChangeDescriptor =>
    index === 0
      ? { kind: "initial" }
      : describeChange(states[index - 1], states[index]);

  return (
    <div
      ref={panelRef}
      className="absolute right-2 top-12 z-40 w-72 max-h-[60vh] flex flex-col bg-elevated border border-strong rounded-lg shadow-2xl overflow-hidden"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-default bg-base">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
          <History size={14} className="text-secondary" />
          {t("editor.notebook.history.title")}
        </div>
        <button
          onClick={onClose}
          className="text-secondary hover:text-primary transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="overflow-y-auto py-1">
        {/* Newest first */}
        {states
          .map((_, index) => index)
          .reverse()
          .map((index) => {
            const isCurrent = index === currentIndex;
            const descriptor = descriptorAt(index);
            return (
              <button
                key={index}
                onClick={() => {
                  if (!isCurrent) onJump(index);
                }}
                className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors ${
                  isCurrent
                    ? "bg-blue-500/10 text-primary cursor-default"
                    : "text-secondary hover:bg-surface-secondary hover:text-primary"
                }`}
              >
                <span className="w-4 shrink-0 text-center">
                  {isCurrent ? (
                    <Check size={12} className="text-blue-400" />
                  ) : (
                    <span className="text-[10px] text-muted">{index + 1}</span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px]">
                    {labelFor(descriptor)}
                  </span>
                  {descriptor.detail && (
                    <span className="block truncate text-[10px] text-muted font-mono">
                      {descriptor.detail}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
      </div>
    </div>
  );
}
