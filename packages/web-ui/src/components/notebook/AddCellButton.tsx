import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";

interface AddCellButtonProps {
  onAddSql: () => void;
  onAddMarkdown: () => void;
}

export function AddCellButton({ onAddSql, onAddMarkdown }: AddCellButtonProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative flex items-center justify-center h-8 group">
      {/* Divider line */}
      <div className="absolute inset-x-4 top-1/2 h-px bg-default opacity-0 group-hover:opacity-100 transition-opacity" />

      {/* Add button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative z-10 flex items-center justify-center w-6 h-6 rounded-full bg-surface-secondary text-muted hover:text-primary hover:bg-surface-tertiary opacity-0 group-hover:opacity-100 transition-all"
      >
        <Plus size={14} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-full mt-1 z-20 bg-elevated border border-default rounded-lg shadow-lg overflow-hidden">
          <button
            type="button"
            onClick={() => {
              onAddSql();
              setIsOpen(false);
            }}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-secondary hover:bg-surface-secondary w-full text-left"
          >
            <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-green-500/15 text-green-400">
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
            <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-blue-500/15 text-blue-400">
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
