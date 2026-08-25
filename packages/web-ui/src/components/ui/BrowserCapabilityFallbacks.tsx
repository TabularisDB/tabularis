import { useEffect, useRef, useState } from "react";
import { ExternalLink, Info, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  subscribeBrowserCapabilityFallbacks,
  type BrowserCapabilityFallback,
} from "../../platform/browserFallbacks";

interface FallbackItem {
  readonly id: number;
  readonly fallback: BrowserCapabilityFallback;
}

export function BrowserCapabilityFallbacks() {
  const { t } = useTranslation();
  const [items, setItems] = useState<FallbackItem[]>([]);
  const nextId = useRef(1);

  useEffect(
    () =>
      subscribeBrowserCapabilityFallbacks((fallback) => {
        const id = nextId.current++;
        setItems((current) => [...current, { id, fallback }]);
      }),
    [],
  );

  if (items.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 left-4 z-[125] flex max-w-[min(420px,calc(100vw-2rem))] flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map(({ id, fallback }) => (
        <div
          key={id}
          role="status"
          className="flex items-start gap-3 rounded-lg border border-strong bg-elevated p-3 shadow-2xl"
        >
          <div className="shrink-0 rounded-lg bg-blue-900/30 p-1.5">
            {fallback.kind === "external-url" ? (
              <ExternalLink size={16} className="text-blue-400" />
            ) : (
              <Info size={16} className="text-blue-400" />
            )}
          </div>
          <div className="min-w-0 flex-1 text-sm">
            {fallback.kind === "notification" ? (
              <>
                <div className="font-medium text-primary">{fallback.title}</div>
                {fallback.body && (
                  <div className="mt-0.5 text-xs text-secondary">
                    {fallback.body}
                  </div>
                )}
              </>
            ) : (
              <a
                href={fallback.url}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-blue-400 underline underline-offset-2 hover:text-blue-300"
              >
                {fallback.url}
              </a>
            )}
          </div>
          <button
            type="button"
            onClick={() =>
              setItems((current) => current.filter((item) => item.id !== id))
            }
            aria-label={t("common.close")}
            className="shrink-0 text-secondary transition-colors hover:text-primary"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
