import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, BookOpen, ChevronUp } from "lucide-react";

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

  const iconSize = compact ? 10 : 12;
  const btnClass = compact
    ? "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted hover:text-purple-300 bg-elevated/80 hover:bg-purple-900/40 border border-default hover:border-purple-500/40 transition-all disabled:opacity-30 disabled:pointer-events-none backdrop-blur-sm"
    : "flex items-center gap-1.5 px-2 py-1 rounded text-xs text-muted hover:text-purple-300 bg-elevated/80 hover:bg-purple-900/40 border border-default hover:border-purple-500/40 transition-all disabled:opacity-30 disabled:pointer-events-none backdrop-blur-sm";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disableAll}
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
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute bottom-full mb-1 right-0 z-20 bg-elevated border border-default rounded-lg shadow-lg overflow-hidden min-w-[160px]">
            <button
              type="button"
              onClick={() => {
                onGenerate();
                setIsOpen(false);
              }}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-secondary hover:bg-purple-900/30 hover:text-purple-300 w-full text-left transition-colors"
            >
              <Sparkles size={12} className="text-purple-400" />
              {t("ai.generateSql")}
            </button>
            <button
              type="button"
              onClick={() => {
                onExplain();
                setIsOpen(false);
              }}
              disabled={disableExplain}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-secondary hover:bg-blue-900/30 hover:text-blue-300 w-full text-left transition-colors disabled:opacity-30 disabled:pointer-events-none"
            >
              <BookOpen size={12} className="text-blue-400" />
              {t("ai.explain")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
