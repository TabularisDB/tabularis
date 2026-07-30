import { useState } from "react";
import { AlertCircle, X, ChevronRight, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { ClassifiedConnectionError } from "../../../utils/connectionErrors";

interface ConnectionErrorPanelProps {
  error: ClassifiedConnectionError;
  onClose?: () => void;
  className?: string;
}

/**
 * Classified connection-error panel: translated summary, actionable recovery
 * hint, and the raw backend message behind a collapsible monospace block.
 */
export const ConnectionErrorPanel = ({
  error,
  onClose,
  className,
}: ConnectionErrorPanelProps) => {
  const { t } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div
      role="alert"
      className={clsx(
        "p-3 bg-red-900/20 border border-red-900/40 rounded-lg flex items-start gap-2.5 text-red-400",
        className,
      )}
    >
      <AlertCircle size={14} className="mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium leading-relaxed">
          {t(error.summaryKey)}
        </p>
        {error.recoveryKey && (
          <p className="mt-0.5 text-xs text-secondary leading-relaxed">
            {t(error.recoveryKey)}
          </p>
        )}
        {error.detail && (
          <>
            <button
              type="button"
              onClick={() => setShowDetails((visible) => !visible)}
              className="mt-1.5 flex items-center gap-1 text-[11px] text-red-400/70 hover:text-red-400 transition-colors"
            >
              {showDetails ? (
                <ChevronDown size={11} />
              ) : (
                <ChevronRight size={11} />
              )}
              {showDetails ? t("common.hideDetails") : t("common.showDetails")}
            </button>
            {showDetails && (
              <pre className="mt-1.5 p-2 max-h-40 overflow-auto rounded-md bg-red-950/40 border border-red-900/30 text-[11px] leading-relaxed text-red-300/90 font-mono whitespace-pre-wrap break-words">
                {error.detail}
              </pre>
            )}
          </>
        )}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="text-red-400/50 hover:text-red-400 transition-colors shrink-0 mt-0.5"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
};
