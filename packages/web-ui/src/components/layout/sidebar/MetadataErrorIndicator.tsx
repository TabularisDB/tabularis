import { useState } from "react";
import { AlertCircle, Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { copyTextToClipboard } from "../../../utils/clipboard";

interface MetadataErrorIndicatorProps {
  error: string;
  title: string;
}

export const MetadataErrorIndicator = ({
  error,
  title,
}: MetadataErrorIndicatorProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  return (
    // The indicator lives inside clickable sidebar rows: clicks on it or on its
    // popover must not reach the row.
    <div role="presentation" className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => {
          setIsOpen((current) => !current);
          setIsCopied(false);
        }}
        className="flex items-center rounded p-1 text-accent-error transition-colors hover:bg-accent-error/10 hover:text-accent-error"
        title={t("sidebar.errorDetails")}
        aria-label={t("sidebar.errorDetails")}
        aria-expanded={isOpen}
      >
        <AlertCircle size={14} />
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label={title}
          className="absolute right-0 top-full z-50 mt-1 w-72 rounded-md border border-default bg-surface-primary p-3 text-left normal-case tracking-normal shadow-xl"
        >
          <div className="mb-2 text-xs font-semibold text-accent-error">{title}</div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-secondary p-2 text-xs font-normal text-muted select-text">
            {error}
          </pre>
          <button
            type="button"
            onClick={async () => {
              await copyTextToClipboard(error);
              setIsCopied(true);
            }}
            className="mt-2 flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-secondary transition-colors hover:bg-surface-secondary"
          >
            {isCopied ? (
              <Check size={12} className="text-accent-success" />
            ) : (
              <Copy size={12} />
            )}
            {isCopied ? t("common.copied") : t("common.copy")}
          </button>
        </div>
      )}
    </div>
  );
};
