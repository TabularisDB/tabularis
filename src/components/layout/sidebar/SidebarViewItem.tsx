import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
  Eye,
  Layers,
  Loader2,
  Folder,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import clsx from "clsx";
import { SidebarColumnItem } from "./SidebarColumnItem";
import { SidebarIndexList } from "./SidebarIndexList";
import { groupIndexes } from "../../../utils/indexes";
import type { TableColumn, Index } from "../../../types/schema";
import type { ContextMenuData } from "../../../types/sidebar";

interface SidebarViewItemProps {
  view: { name: string };
  activeView: string | null;
  onViewClick: (name: string) => void;
  onViewDoubleClick: (name: string) => void;
  onContextMenu: (
    e: React.MouseEvent,
    type: string,
    id: string,
    label: string,
    data?: ContextMenuData,
  ) => void;
  connectionId: string;
  driver: string;
  schema?: string;
  materialized?: boolean;
  isRefreshing?: boolean;
}

export const SidebarViewItem = ({
  view,
  activeView,
  onViewClick,
  onViewDoubleClick,
  onContextMenu,
  connectionId,
  driver,
  schema,
  materialized = false,
  isRefreshing = false,
}: SidebarViewItemProps) => {
  const { t } = useTranslation();
  const ViewIcon = materialized ? Layers : Eye;

  const [isExpanded, setIsExpanded] = useState(false);
  const [columns, setColumns] = useState<TableColumn[]>([]);
  const [indexes, setIndexes] = useState<Index[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandIndexes, setExpandIndexes] = useState(false);

  const refreshColumns = React.useCallback(async () => {
    if (!connectionId) return;
    setIsLoading(true);
    try {
      const [cols, idxs] = await Promise.all([
        invoke<TableColumn[]>(
          materialized ? "get_materialized_view_columns" : "get_view_columns",
          {
            connectionId,
            viewName: view.name,
            ...(schema ? { schema } : {}),
          },
        ),
        // Materialized views can carry indexes (regular views cannot).
        materialized
          ? invoke<Index[]>("get_indexes", {
            connectionId,
            tableName: view.name,
            ...(schema ? { schema } : {}),
          })
          : Promise.resolve([] as Index[]),
      ]);
      setColumns(cols);
      setIndexes(idxs);
    } catch (err) {
      console.error("Failed to load view columns:", err);
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, view.name, schema, materialized]);

  useEffect(() => {
    if (isExpanded) {
      refreshColumns();
    }
  }, [isExpanded, refreshColumns]);

  const handleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded((prev) => !prev);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, materialized ? "materialized_view" : "view", view.name, view.name, { tableName: view.name, schema });
  };

  const groupedIndexes = React.useMemo(() => groupIndexes(indexes), [indexes]);

  return (
    <div className="flex flex-col">
      <div
        onClick={() => onViewClick(view.name)}
        onDoubleClick={() => onViewDoubleClick(view.name)}
        onContextMenu={handleContextMenu}
        className={clsx(
          "flex items-center gap-1 pl-1 pr-3 py-1.5 text-sm cursor-pointer group select-none transition-colors border-l-2",
          activeView === view.name
            ? "bg-[color-mix(in_srgb,var(--accent-secondary)_20%,transparent)] text-accent-secondary border-(--accent-secondary)"
            : "text-secondary hover:bg-surface-secondary border-transparent hover:text-primary",
        )}
      >
        <button
          onClick={handleExpand}
          className="p-0.5 rounded hover:bg-surface-secondary text-muted hover:text-primary transition-colors"
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {isRefreshing ? (
          <Loader2
            size={14}
            className="animate-spin text-accent-secondary shrink-0"
          />
        ) : (
          <ViewIcon
            size={14}
            className={
              activeView === view.name
                ? "text-accent-secondary"
                : "text-muted group-hover:text-accent-secondary"
            }
          />
        )}
        <span className="truncate flex-1">{view.name}</span>
      </div>
      {isExpanded && (
        <div className="ml-[22px] border-l border-default">
          {isLoading ? (
            <div className="flex items-center gap-2 p-2 text-xs text-muted">
              <Loader2 size={12} className="animate-spin" />
              {t("sidebar.loadingSchema")}
            </div>
          ) : (
            <div className="flex flex-col">
              <div
                className="flex items-center gap-2 px-2 py-1 text-xs text-muted select-none"
              >
                <Folder size={12} className="text-blue-400/70" />
                <span>{t("sidebar.columns")}</span>
                <span className="ml-auto text-[10px] opacity-50">
                  {columns.length}
                </span>
              </div>
              <div className="ml-4 border-l border-default/50">
                {columns.map((col) => (
                  <SidebarColumnItem
                    key={col.name}
                    column={col}
                    tableName={view.name}
                    connectionId={connectionId}
                    driver={driver}
                    onRefresh={refreshColumns}
                    onEdit={() => {}}
                    isView={true}
                  />
                ))}
              </div>
              {materialized && (
                <SidebarIndexList
                  indexes={groupedIndexes}
                  isOpen={expandIndexes}
                  onToggle={() => setExpandIndexes(!expandIndexes)}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
