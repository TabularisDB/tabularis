import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Braces, ChevronRight } from "lucide-react";
import { tokenizeJsonDisplay, type JsonToken } from "../../utils/jsonHighlight";

interface JsonCellProps {
  value: unknown;
  displayText: string;
  isExpanded: boolean;
  isPendingDelete: boolean;
  onToggleExpand: () => void;
  onOpenViewer: () => void;
}

const TOKEN_CLASS: Record<JsonToken["type"], string> = {
  key: "text-blue-300",
  string: "text-emerald-300",
  number: "text-amber-300",
  boolean: "text-purple-300",
  null: "text-muted italic",
  punct: "text-secondary",
  whitespace: "",
};

export const JsonCell = ({
  value,
  displayText,
  isExpanded,
  isPendingDelete,
  onToggleExpand,
  onOpenViewer,
}: JsonCellProps) => {
  const { t } = useTranslation();
  const textRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    setIsTruncated(el.scrollWidth > el.clientWidth);
  }, [displayText]);

  const tokens = useMemo(() => {
    try {
      return tokenizeJsonDisplay(displayText);
    } catch {
      return [{ type: "string" as const, text: displayText }];
    }
  }, [displayText]);

  const isNullish = value === null || value === undefined;
  const showIcons = !isNullish && !isPendingDelete;
  const iconVisibilityClass = isTruncated
    ? "opacity-100"
    : "opacity-0 group-hover/jsoncell:opacity-100";

  return (
    <span
      className={`flex items-center gap-1 group/jsoncell w-full ${
        isTruncated ? "json-cell-truncated" : ""
      }`}
      title={displayText}
    >
      <span ref={textRef} className="truncate flex-1">
        {tokens.map((tok, idx) => (
          <span
            key={idx}
            data-token={tok.type}
            className={TOKEN_CLASS[tok.type]}
          >
            {tok.text}
          </span>
        ))}
      </span>
      {showIcons && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            className={`${iconVisibilityClass} transition-all p-0.5 rounded text-muted hover:text-secondary hover:bg-surface-tertiary flex-shrink-0 ${
              isExpanded ? "rotate-90" : ""
            }`}
            title={t("jsonCell.expand")}
            aria-label={t("jsonCell.expand")}
          >
            <ChevronRight size={11} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenViewer();
            }}
            className={`${iconVisibilityClass} transition-opacity p-0.5 rounded text-muted hover:text-secondary hover:bg-surface-tertiary flex-shrink-0`}
            title={t("jsonCell.openViewer")}
            aria-label={t("jsonCell.openViewer")}
          >
            <Braces size={11} />
          </button>
        </>
      )}
    </span>
  );
};
