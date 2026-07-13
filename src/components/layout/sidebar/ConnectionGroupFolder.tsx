import { useState } from "react";
import { Folder, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ConnectionGroup } from "../../../contexts/DatabaseContext";
import type { ConnectionStatus } from "../../../hooks/useConnectionManager";
import type { PluginManifest } from "../../../types/plugins";
import { OpenConnectionItem } from "./OpenConnectionItem";
import clsx from "clsx";

interface Props {
  group: ConnectionGroup;
  connections: ConnectionStatus[];
  allDrivers: PluginManifest[];
  selectedConnectionIds: Set<string>;
  onToggleCollapsed: () => void;
  onSwitch: (connectionId: string) => void;
  onOpenInEditor: (connectionId: string) => void;
  onOpenInNewWindow: (connectionId: string) => void;
  onDisconnect: (connectionId: string) => void;
  onToggleSelect: (connectionId: string, isCtrlHeld: boolean) => void;
  onActivateSplit: (mode: 'vertical' | 'horizontal') => void;
  onDropConnection?: (connectionId: string, groupId: string) => void;
  showShortcutHints?: boolean;
  startIndex?: number;
}

export const ConnectionGroupFolder = ({
  group,
  connections,
  allDrivers,
  selectedConnectionIds,
  onToggleCollapsed,
  onSwitch,
  onOpenInEditor,
  onOpenInNewWindow,
  onDisconnect,
  onToggleSelect,
  onActivateSplit,
  onDropConnection,
  showShortcutHints = false,
  startIndex = 1,
}: Props) => {
  const { t } = useTranslation();
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const connectionId = e.dataTransfer.getData("connectionId");
    if (connectionId && onDropConnection) {
      onDropConnection(connectionId, group.id);
    }
  };

  const connectedCount = connections.filter(c => c.isConnected).length;

  return (
    <div className="w-full" data-group-id={group.id}>
      {/* Group header */}
      <div
        className={clsx(
          "relative group w-full flex flex-col items-center mb-0.5",
          isDragOver && "ring-2 ring-blue-400 rounded-lg"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <button
          onClick={onToggleCollapsed}
          className={clsx(
            "flex items-center justify-center w-12 h-10 rounded-lg transition-all relative",
            "text-muted hover:text-secondary hover:bg-surface-secondary"
          )}
        >
          <div className="relative">
            {group.collapsed ? (
              <Folder size={20} className="text-amber-400/70" />
            ) : (
              <FolderOpen size={20} className="text-amber-400" />
            )}
            {/* Connection count badge */}
            {connections.length > 0 && (
              <div className="absolute -bottom-1 -right-1.5 min-w-[14px] h-[14px] bg-surface-secondary border border-default rounded-full flex items-center justify-center text-[9px] font-bold text-secondary px-0.5">
                {connections.length}
              </div>
            )}
          </div>
        </button>

        {/* Group name label */}
        <span className="text-[9px] text-muted leading-tight max-w-[56px] truncate text-center select-none">
          {group.name}
        </span>

        {/* Tooltip */}
        <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-surface-secondary text-primary text-xs px-2 py-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-30 pointer-events-none shadow-lg border border-default">
          <div className="font-medium">{group.name}</div>
          <div className="text-muted text-[10px]">
            {connections.length} {connections.length === 1 ? t("groups.connection") : t("groups.connections")}
            {connectedCount > 0 && ` (${connectedCount} open)`}
          </div>
        </div>
      </div>

      {/* Expanded connections */}
      {!group.collapsed && connections.length > 0 && (
        <div className="flex flex-col items-center w-full mb-1">
          {connections.map((conn, idx) => (
            <OpenConnectionItem
              key={conn.id}
              connection={conn}
              driverManifest={allDrivers.find(d => d.id === conn.driver)}
              isSelected={selectedConnectionIds.has(conn.id)}
              onSwitch={() => onSwitch(conn.id)}
              onOpenInEditor={() => onOpenInEditor(conn.id)}
              onOpenInNewWindow={() => onOpenInNewWindow(conn.id)}
              onDisconnect={() => onDisconnect(conn.id)}
              onToggleSelect={(isCtrlHeld) => onToggleSelect(conn.id, isCtrlHeld)}
              selectedConnectionIds={selectedConnectionIds}
              onActivateSplit={onActivateSplit}
              shortcutIndex={startIndex + idx}
              showShortcutHint={showShortcutHints && startIndex + idx <= 9}
            />
          ))}
        </div>
      )}
    </div>
  );
};
