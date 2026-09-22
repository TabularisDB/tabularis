import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, BookOpen, ChevronUp } from "lucide-react";
import { useEscapeKey } from "../../hooks/useEscapeKey";

interface AiDropdownButtonProps {
  onGenerate: () => void;
  onExplain: () => void;
  disableAll?: boolean;
  disableExplain?: boolean;
  compact?: boolean;
}

export function AiDropdownButton({
  onGenerate,
  onExplain,
  disableAll,
  disableExplain,
  compact,
}: AiDropdownButtonProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  useEscapeKey(isOpen, close);

  const iconSize = compact ? 10 : 12;
  const btnClass = compact
    ? "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted hover:text-accent-secondary bg-elevated/80 hover:bg-accent-secondary/20 border border-default hover:border-accent-secondary/40 transition-all disabled:opacity-30 disabled:pointer-events-none backdrop-blur-sm"
    : "flex items-center gap-1.5 px-2 py-1 rounded text-xs text-muted hover:text-accent-secondary bg-elevated/80 hover:bg-accent-secondary/20 border border-default hover:border-accent-secondary/40 transition-all disabled:opacity-30 disabled:pointer-events-none backdrop-blur-sm";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disableAll}
        aria-expanded={isOpen}
        className={btnClass}
        title="AI"
      >
        <Sparkles size={iconSize} />
        AI
        <ChevronUp
          size={iconSize - 2}
          className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <>
          <div
            role="presentation"
            className="fixed inset-0 z-10"
            onClick={close}
          />
          <div className="absolute bottom-full mb-1 right-0 z-20 bg-elevated border border-default rounded-lg shadow-lg overflow-hidden min-w-[160px]">
            <button
              type="button"
              onClick={() => {
                onGenerate();
                setIsOpen(false);
              }}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-secondary hover:bg-accent-secondary/15 hover:text-accent-secondary w-full text-left transition-colors"
            >
              <Sparkles size={12} className="text-accent-secondary" />
              {t("ai.generateSql")}
            </button>
            <button
              type="button"
              onClick={() => {
                onExplain();
                setIsOpen(false);
              }}
              disabled={disableExplain}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-secondary hover:bg-accent-primary/15 hover:text-accent w-full text-left transition-colors disabled:opacity-30 disabled:pointer-events-none"
            >
              <BookOpen size={12} className="text-accent" />
              {t("ai.explain")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
