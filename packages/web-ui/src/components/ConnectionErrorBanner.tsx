import { useState } from "react";
import { AlertCircle, X, ChevronRight, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { splitErrorDetails } from "../utils/errors";

interface ConnectionErrorBannerProps {
  /** Composed error message, optionally `${summary}\n\nError: ${detail}`. */
  message: string;
  onClose: () => void;
}

/**
 * Error banner that keeps the human-readable summary front and center and
 * tucks the (often verbose) technical detail behind a collapsible,
 * scrollable monospace block.
 */
export const ConnectionErrorBanner = ({
  message,
  onClose,
}: ConnectionErrorBannerProps) => {
  const { t } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);
  const { summary, details } = splitErrorDetails(message);

  return (
    <div className="mx-6 mt-4 p-3.5 bg-accent-error/10 border border-accent-error/20 rounded-xl flex items-start gap-3 text-accent-error shrink-0">
      <AlertCircle size={15} className="mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-sm whitespace-pre-wrap leading-relaxed block">
          {summary}
        </span>
        {details && (
          <>
            <button
              onClick={() => setShowDetails(v => !v)}
              className="mt-2 flex items-center gap-1 text-xs text-accent-error/70 hover:text-accent-error transition-colors"
            >
              {showDetails ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
              {showDetails
                ? t("common.hideDetails")
                : t("common.showDetails")}
            </button>
            {showDetails && (
              <pre className="mt-2 p-2.5 max-h-56 overflow-auto rounded-lg bg-accent-error/20 border border-accent-error/15 text-[11px] leading-relaxed text-accent-error/90 font-mono whitespace-pre-wrap break-words">
                {details}
              </pre>
            )}
          </>
        )}
      </div>
      <button
        onClick={onClose}
        className="text-accent-error/50 hover:text-accent-error transition-colors shrink-0 mt-0.5"
      >
        <X size={14} />
      </button>
    </div>
  );
};
