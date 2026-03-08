import { useState, useRef } from "react";
import { ChevronRight, Folder, FolderOpen, Edit2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ConnectionGroup } from "../../../contexts/DatabaseContext";
import type { ConnectionStatus } from "../../../hooks/useConnectionManager";
import type { PluginManifest } from "../../../types/plugins";
import { ContextMenu } from "../../ui/ContextMenu";
import { OpenConnectionItem } from "./OpenConnectionItem";
import clsx from "clsx";

interface Props {
  group: ConnectionGroup;
  connections: ConnectionStatus[];
  allDrivers: PluginManifest[];
  selectedConnectionIds: Set<string>;
  onToggleCollapsed: () => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onSwitch: (connectionId: string) => void;
  onOpenInEditor: (connectionId: string) => void;
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
  onRename,
  onDelete,
  onSwitch,
  onOpenInEditor,
  onDisconnect,
  onToggleSelect,
  onActivateSplit,
  onDropConnection,
  showShortcutHints = false,
  startIndex = 1,
}: Props) => {
  const { t } = useTranslation();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(group.name);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isRenameCancelledRef = useRef(false);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleStartRename = () => {
    setIsEditing(true);
    setEditName(group.name);
    setContextMenu(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleRenameSubmit = () => {
    if (editName.trim() && editName !== group.name) {
      onRename(editName.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRenameSubmit();
    } else if (e.key === "Escape") {
      isRenameCancelledRef.current = true;
      setIsEditing(false);
      setEditName(group.name);
    }
  };

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

  const menuItems = [
    {
      label: t("groups.rename"),
      icon: Edit2,
      action: handleStartRename,
    },
    { separator: true as const },
    {
      label: t("groups.delete"),
      icon: Trash2,
      action: onDelete,
      danger: true,
    },
  ];

  const connectedCount = connections.filter(c => c.isConnected).length;

  return (
    <div className="w-full">
      {/* Group header */}
      <div
        className={clsx(
          "relative group w-full flex items-center justify-center mb-1",
          isDragOver && "ring-2 ring-blue-400 rounded-lg"
        )}
        onContextMenu={handleContextMenu}
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
              <div className="absolute -bottom-1 -right-1 min-w-[14px] h-[14px] bg-surface-secondary border border-default rounded-full flex items-center justify-center text-[9px] font-bold text-secondary px-0.5">
                {connections.length}
              </div>
            )}
          </div>

          {/* Chevron indicator */}
          <ChevronRight
            size={10}
            className={clsx(
              "absolute left-1 top-1/2 -translate-y-1/2 text-muted transition-transform",
              !group.collapsed && "rotate-90"
            )}
          />
        </button>

        {/* Tooltip */}
        <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-surface-secondary text-primary text-xs px-2 py-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none shadow-lg border border-default">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => {
                if (!isRenameCancelledRef.current) {
                  handleRenameSubmit();
                }
                isRenameCancelledRef.current = false;
              }}
              onKeyDown={handleKeyDown}
              className="bg-surface-primary border border-strong rounded px-1.5 py-0.5 text-xs text-primary w-32 focus:outline-none focus:border-blue-500"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <div className="font-medium">{group.name}</div>
              <div className="text-muted text-[10px]">
                {connections.length} {connections.length === 1 ? t("groups.connection") : t("groups.connections")}
                {connectedCount > 0 && ` (${connectedCount} open)`}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Expanded connections */}
      {!group.collapsed && connections.length > 0 && (
        <div className="pl-2 border-l border-default/50 ml-6 mb-2">
          {connections.map((conn, idx) => (
            <OpenConnectionItem
              key={conn.id}
              connection={conn}
              driverManifest={allDrivers.find(d => d.id === conn.driver)}
              isSelected={selectedConnectionIds.has(conn.id)}
              onSwitch={() => onSwitch(conn.id)}
              onOpenInEditor={() => onOpenInEditor(conn.id)}
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

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};
