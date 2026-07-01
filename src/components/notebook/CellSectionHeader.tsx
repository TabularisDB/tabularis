import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";

interface CellSectionHeaderProps {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  /** Draw a separating top border. Defaults to true; pass false for the first section. */
  divider?: boolean;
  /** Optional right-aligned content (row counts, export buttons, etc.). */
  children?: React.ReactNode;
}

/**
 * Thin, labelled header bar used to collapse/expand an individual area inside a
 * notebook cell (query editor, result grid, chart). Clicking the label/chevron
 * toggles the section; the optional children render on the right.
 */
export function CellSectionHeader({
  label,
  collapsed,
  onToggle,
  divider = true,
  children,
}: CellSectionHeaderProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`flex items-center gap-1 px-2 py-1 bg-elevated text-xs text-muted select-none ${
        divider ? "border-t border-default" : ""
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 text-muted hover:text-primary transition-colors rounded"
        title={t(collapsed ? "editor.notebook.expandSection" : "editor.notebook.collapseSection")}
      >
        <ChevronRight
          size={12}
          className={`transition-transform ${collapsed ? "" : "rotate-90"}`}
        />
        <span className="font-medium uppercase tracking-wide text-[10px]">{label}</span>
      </button>
      {children != null && (
        <>
          <div className="flex-1" />
          <div className="flex items-center gap-2">{children}</div>
        </>
      )}
    </div>
  );
}
