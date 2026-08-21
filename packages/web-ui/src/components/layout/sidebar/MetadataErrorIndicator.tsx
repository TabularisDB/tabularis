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
    <div className="relative">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen((current) => !current);
          setIsCopied(false);
        }}
        className="flex items-center rounded p-1 text-red-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
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
          onClick={(event) => event.stopPropagation()}
          className="absolute right-0 top-full z-50 mt-1 w-72 rounded-md border border-default bg-surface-primary p-3 text-left normal-case tracking-normal shadow-xl"
        >
          <div className="mb-2 text-xs font-semibold text-red-500">{title}</div>
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
              <Check size={12} className="text-green-500" />
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
