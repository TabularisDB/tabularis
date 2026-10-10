import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import { fuzzyFilter } from "../../utils/fuzzy";
import { Modal } from "../ui/Modal";

export interface ColumnChoice {
  name: string;
  index: number;
  type?: string;
}

interface JumpToColumnModalProps {
  isOpen: boolean;
  columns: ColumnChoice[];
  onSelect: (index: number) => void;
  onClose: () => void;
}

export function JumpToColumnModal({
  isOpen,
  columns,
  onSelect,
  onClose,
}: JumpToColumnModalProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const titleId = useId();
  const listId = useId();
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const results = useMemo(
    () => fuzzyFilter(columns, query, (column) => column.name),
    [columns, query],
  );
  const activeIndex = Math.min(selectedIndex, Math.max(0, results.length - 1));

  useEffect(() => {
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, results]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} closeOnBackdrop>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-elevated border border-strong rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-default">
          <h2 id={titleId} className="text-base font-semibold text-primary">
            {t("dataGrid.jumpToColumn")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-1 rounded text-secondary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-default">
          <Search size={16} className="text-muted shrink-0" aria-hidden="true" />
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-label={t("dataGrid.searchColumns")}
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results.length ? `${listId}-${activeIndex}` : undefined}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedIndex(Math.min(activeIndex + 1, results.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex(Math.max(activeIndex - 1, 0));
              } else if (event.key === "Enter" && results[activeIndex]) {
                event.preventDefault();
                onSelect(results[activeIndex].index);
              }
            }}
            className="w-full bg-transparent text-primary text-sm outline-none placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            placeholder={t("dataGrid.searchColumns")}
          />
        </div>
        <div id={listId} role="listbox" aria-label={t("dataGrid.jumpToColumn")} className="overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted text-center">{t("dataGrid.noMatchingColumns")}</p>
          ) : (
            results.map((column, index) => (
              <button
                key={column.index}
                id={`${listId}-${index}`}
                ref={(element) => { optionRefs.current[index] = element; }}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => onSelect(column.index)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                  index === activeIndex ? "bg-accent-primary/15 text-primary" : "text-secondary hover:bg-surface-secondary"
                }`}
              >
                <span className="truncate">{column.name}</span>
                {column.type && <span className="shrink-0 text-xs text-muted">{column.type}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
