import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { truncateCellPreview } from "../../utils/text";

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
  const [isOverflowing, setIsOverflowing] = useState(false);

  // Cap the inline preview before any per-character work. Multi-megabyte text
  // values would otherwise stringify, newline-replace and render in full on
  // every pass; the full value remains available via the inline expander.
  const { text: previewText, truncated } = useMemo(
    () => truncateCellPreview(displayText),
    [displayText],
  );

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    setIsOverflowing(el.scrollWidth > el.clientWidth);
  }, [previewText]);

  const isNullish = value === null || value === undefined;
  const showChevron = !isNullish && !isPendingDelete;
  const isTruncated = isOverflowing || truncated;
  const iconVisibilityClass = isTruncated
    ? "opacity-100"
    : "opacity-0 group-hover/textcell:opacity-100";

  const preview = previewText.includes("\n")
    ? previewText.replace(/\n/g, " ⏎ ")
    : previewText;

  return (
    <span
      className="flex items-center gap-1 group/textcell w-full"
      title={truncated ? `${previewText}…` : displayText}
    >
      <span ref={textRef} className="truncate flex-1">
        {preview}
        {truncated && "…"}
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
