import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { useEscapeKey } from "../../hooks/useEscapeKey";

interface AddCellButtonProps {
  onAddSql: () => void;
  onAddMarkdown: () => void;
}

export function AddCellButton({ onAddSql, onAddMarkdown }: AddCellButtonProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setIsOpen(false), []);
  useEscapeKey(isOpen, closeMenu);

  const handleToggle = () => {
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUpward(spaceBelow < 90);
    }
    setIsOpen((prev) => !prev);
  };

  return (
    <div className="relative flex items-center justify-center h-8 group">
      {/* Divider line */}
      <div className="absolute inset-x-4 top-1/2 h-px bg-default opacity-0 group-hover:opacity-100 transition-opacity" />

      {/* Add button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        aria-label={t("editor.notebook.addCell")}
        aria-expanded={isOpen}
        className="relative z-10 flex items-center justify-center w-6 h-6 rounded-full bg-surface-secondary text-muted hover:text-primary hover:bg-surface-tertiary opacity-0 group-hover:opacity-100 transition-all"
      >
        <Plus size={14} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          <div
            role="presentation"
            className="fixed inset-0 z-10"
            onClick={closeMenu}
          />
          <div
            className={`absolute z-20 bg-elevated border border-default rounded-lg shadow-lg overflow-hidden ${
              openUpward ? "bottom-full mb-1" : "top-full mt-1"
            }`}
          >
          <button
            type="button"
            onClick={() => {
              onAddSql();
              setIsOpen(false);
            }}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-secondary hover:bg-surface-secondary w-full text-left"
          >
            <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-accent-success/15 text-accent-success">
              SQL
            </span>
            {t("editor.notebook.addSqlCell")}
          </button>
          <button
            type="button"
            onClick={() => {
              onAddMarkdown();
              setIsOpen(false);
            }}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-secondary hover:bg-surface-secondary w-full text-left"
          >
            <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-accent-primary/15 text-accent">
              MD
            </span>
            {t("editor.notebook.addMarkdownCell")}
          </button>
        </div>
        </>
      )}
    </div>
  );
}
