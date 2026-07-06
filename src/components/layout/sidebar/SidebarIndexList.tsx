import React from "react";
import { useTranslation } from "react-i18next";
import { Folder, List } from "lucide-react";
import type { GroupedIndex } from "../../../utils/indexes";

interface SidebarIndexListProps {
  indexes: GroupedIndex[];
  isOpen: boolean;
  onToggle: () => void;
  onIndexContextMenu?: (e: React.MouseEvent, indexName: string) => void;
  onFolderContextMenu?: (e: React.MouseEvent) => void;
}

export const SidebarIndexList = ({
  indexes,
  isOpen,
  onToggle,
  onIndexContextMenu,
  onFolderContextMenu,
}: SidebarIndexListProps) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col">
      <button
        type="button"
        className="flex items-center gap-2 px-2 py-1 text-xs text-muted hover:text-secondary w-full text-left select-none"
        aria-expanded={isOpen}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        onContextMenu={onFolderContextMenu}
      >
        <Folder size={12} className="text-green-400/70" />
        <span>{t("sidebar.indexes")}</span>
        <span className="ml-auto text-[10px] opacity-50">{indexes.length}</span>
      </button>
      {isOpen && (
        <div className="ml-4 border-l border-default/50">
          {indexes.map((idx) => (
            <div
              key={idx.name}
              className="flex items-center gap-2 px-3 py-1 text-xs text-secondary hover:bg-surface-secondary hover:text-primary cursor-pointer group font-mono"
              title={idx.columns.join(", ")}
              onContextMenu={
                onIndexContextMenu ? (e) => onIndexContextMenu(e, idx.name) : undefined
              }
            >
              <List size={12} className={idx.is_unique ? "text-blue-400" : "text-green-400"} />
              <span className="truncate flex-1">
                {idx.name}{" "}
                <span className="text-muted">({idx.columns.join(", ")})</span>
              </span>
              {idx.is_unique && (
                <span className="text-[9px] text-muted border border-strong px-1 rounded bg-elevated/50">
                  UNIQUE
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
