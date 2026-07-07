import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
  Code2,
  Folder,
  Loader2,
  ChevronDown,
  ChevronRight,
  Variable,
} from "lucide-react";
import clsx from "clsx";
import type { RoutineInfo } from "../../../contexts/DatabaseContext";
import type { ContextMenuData } from "../../../types/sidebar";

interface RoutineParameter {
  name: string;
  data_type: string;
  mode: string;
  ordinal_position: number;
}

interface SidebarRoutineItemProps {
  routine: RoutineInfo;
  onContextMenu: (
    e: React.MouseEvent,
    type: string,
    id: string,
    label: string,
    data?: ContextMenuData,
  ) => void;
  onDoubleClick: (routine: RoutineInfo) => void;
  connectionId: string;
  schema?: string;
}

export const SidebarRoutineItem = ({
  routine,
  onContextMenu,
  onDoubleClick,
  connectionId,
  schema,
}: SidebarRoutineItemProps) => {
  const { t } = useTranslation();

  const [isExpanded, setIsExpanded] = useState(false);
  const [parameters, setParameters] = useState<RoutineParameter[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refreshParameters = React.useCallback(async () => {
    if (!connectionId) return;
    setIsLoading(true);
    try {
      const params = await invoke<RoutineParameter[]>(
        "get_routine_parameters",
        {
          connectionId,
          routineName: routine.name,
          ...(schema ? { schema } : {}),
        },
      );
      setParameters(params);
    } catch (err) {
      console.error("Failed to load routine parameters:", err);
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, routine.name, schema]);

  useEffect(() => {
    if (isExpanded) {
      refreshParameters();
    }
  }, [isExpanded, refreshParameters]);

  const handleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded((prev) => !prev);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Forward the item's schema so menu actions (run / edit / drop) target
    // the right namespace even outside the connection's active schema.
    onContextMenu(e, "routine", routine.name, routine.name, { ...routine, schema });
  };

  return (
    <div className="flex flex-col">
      <div
        onClick={handleExpand}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onDoubleClick(routine);
        }}
        onContextMenu={handleContextMenu}
        className={clsx(
          "flex items-center gap-1 pl-1 pr-3 py-1.5 text-sm cursor-pointer group select-none transition-colors border-l-2",
          "text-secondary hover:bg-surface-secondary border-transparent hover:text-primary",
        )}
      >
        <button className="p-0.5 rounded hover:bg-surface-secondary text-muted hover:text-primary transition-colors">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <Code2 size={14} className="text-muted group-hover:text-yellow-400" />
        <span className="truncate flex-1">{routine.name}</span>
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
              {parameters.length > 0 ? (
                <>
                  <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted select-none">
                    <Folder size={12} className="text-blue-400/70" />
                    <span>{t("sidebar.parameters")}</span>
                    {/* mr-3.5 lines the count up with the group counts of
                        Functions / Procedures (px-2 + mr-3.5 = same edge). */}
                    <span className="ml-auto mr-3.5 text-[10px] opacity-50">
                      {parameters.length}
                    </span>
                  </div>
                  <div className="ml-4 border-l border-default/50">
                    {parameters.map((param) => {
                      const mode =
                        param.mode ||
                        (routine.routine_type === "FUNCTION" && !param.name
                          ? "OUT"
                          : "");
                      return (
                        <div
                          key={`${param.name}-${param.ordinal_position}`}
                          className="flex items-center gap-2 px-3 py-1 text-xs text-secondary hover:bg-surface-secondary hover:text-primary group font-mono"
                          title={`${mode} ${param.name} ${param.data_type}`.trim()}
                        >
                          <Variable size={12} className="text-muted shrink-0" />
                          <span className="truncate flex-1 min-w-0">
                            {param.name || t("routines.returnValue")}
                          </span>
                          {mode && (
                            <span className="text-[10px] text-muted opacity-60 shrink-0">
                              {mode}
                            </span>
                          )}
                          {/* px-3 (12px) + mr-2.5 (10px) ends at the same
                              22px right edge as the group / parameter counts. */}
                          <span className="text-muted text-[10px] ml-auto mr-2.5 shrink-0">
                            {param.data_type}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="p-2 text-xs text-muted italic ml-2">
                  {t("sidebar.noParameters")}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
