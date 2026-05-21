import React from "react";
import { useTranslation } from "react-i18next";
import { Zap } from "lucide-react";
import clsx from "clsx";
import type { TriggerInfo } from "../../../contexts/DatabaseContext";
import type { ContextMenuData } from "../../../types/sidebar";

interface SidebarTriggerItemProps {
  trigger: TriggerInfo;
  connectionId: string;
  schema?: string;
  onContextMenu: (
    e: React.MouseEvent,
    type: string,
    id: string,
    label: string,
    data?: ContextMenuData,
  ) => void;
  onDoubleClick: (trigger: TriggerInfo) => void;
}

export const SidebarTriggerItem = ({
  trigger,
  schema,
  onContextMenu,
  onDoubleClick,
}: SidebarTriggerItemProps) => {
  const { t } = useTranslation();

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, "trigger", trigger.name, trigger.name, { ...trigger, schema } as unknown as ContextMenuData);
  };

  const badge = [trigger.timing, trigger.event].filter(Boolean).join(" ");

  return (
    <div
      onDoubleClick={() => onDoubleClick(trigger)}
      onContextMenu={handleContextMenu}
      className={clsx(
        "flex items-center gap-1.5 pl-3 pr-3 py-1.5 text-sm cursor-pointer group select-none transition-colors border-l-2",
        "text-secondary hover:bg-surface-secondary border-transparent hover:text-primary",
      )}
      title={badge || trigger.table_name}
    >
      <Zap
        size={13}
        className="text-muted group-hover:text-yellow-400 shrink-0"
      />
      <span className="truncate flex-1">{trigger.name}</span>
      {badge && (
        <span className="text-[10px] text-muted font-mono opacity-60 shrink-0">
          {badge}
        </span>
      )}
      <span className="text-[10px] text-muted opacity-50 shrink-0 hidden group-hover:inline">
        {t("sidebar.onTable", { table: trigger.table_name })}
      </span>
    </div>
  );
};
