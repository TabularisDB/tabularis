import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";

interface TextCellProps {
  value: unknown;
  displayText: string;
  isExpanded: boolean;
  isPendingDelete: boolean;
  onToggleExpand: () => void;
}

export const TextCell = ({
  value,
  displayText,
  isExpanded,
  isPendingDelete,
  onToggleExpand,
}: TextCellProps) => {
  const { t } = useTranslation();
  const textRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    setIsTruncated(el.scrollWidth > el.clientWidth);
  }, [displayText]);

  const isNullish = value === null || value === undefined;
  const showChevron = !isNullish && !isPendingDelete;
  const iconVisibilityClass = isTruncated
    ? "opacity-100"
    : "opacity-0 group-hover/textcell:opacity-100";

  const preview = displayText.includes("\n")
    ? displayText.replace(/\n/g, " ⏎ ")
    : displayText;

  return (
    <span
      className="flex items-center gap-1 group/textcell w-full"
      title={displayText}
    >
      <span ref={textRef} className="truncate flex-1">
        {preview}
      </span>
      {showChevron && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          className={`${iconVisibilityClass} transition-all p-0.5 rounded text-muted hover:text-secondary hover:bg-surface-tertiary flex-shrink-0 ${
            isExpanded ? "rotate-90" : ""
          }`}
          title={t("textCell.expand", {
            defaultValue: "Toggle inline text editor",
          })}
          aria-label={t("textCell.expand", {
            defaultValue: "Toggle inline text editor",
          })}
        >
          <ChevronRight size={11} />
        </button>
      )}
    </span>
  );
};
