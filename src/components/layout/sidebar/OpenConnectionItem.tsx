import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Loader2, Shield, X, AlertCircle, Terminal, Check, Copy, Power, Columns2, Rows2, AppWindow, SquarePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ConnectionStatus } from "../../../hooks/useConnectionManager";
import { getConnectionItemClass, getStatusDotClass } from "../../../utils/connectionManager";
import { canActivateSplit, canAddToSplit } from "../../../utils/connectionLayout";
import { useConnectionLayoutContext } from "../../../hooks/useConnectionLayoutContext";
import { ContextMenu } from "../../ui/ContextMenu";
import { RailIndicator } from "./RailIndicator";
import type { PluginManifest } from "../../../types/plugins";
import { getConnectionAccent, getConnectionIcon } from "../../../utils/driverUI";
import { useDatabase } from "../../../hooks/useDatabase";

interface Props {
  connection: ConnectionStatus;
  driverManifest?: PluginManifest | null;
  isSelected: boolean;
  onSwitch: () => void;
  onOpenInEditor: () => void;
  onOpenInNewWindow: () => void;
  onDisconnect: () => void;
  onToggleSelect: (isCtrlHeld: boolean) => void;
  selectedConnectionIds: Set<string>;
  onActivateSplit: (mode: 'vertical' | 'horizontal') => void;
  shortcutIndex?: number;
  showShortcutHint?: boolean;
  /** Starts a pointer-based drag session (reorder / drop into split group) */
  onMoveMouseDown?: (e: React.MouseEvent) => void;
  dropIndicator?: 'above' | 'below' | null;
}

export const OpenConnectionItem = ({
  connection,
  driverManifest,
  isSelected,
  onSwitch,
  onOpenInEditor,
  onOpenInNewWindow,
  onDisconnect,
  onToggleSelect,
  selectedConnectionIds,
  onActivateSplit,
  shortcutIndex,
  showShortcutHint = false,
  onMoveMouseDown,
  dropIndicator = null,
}: Props) => {
  const { t } = useTranslation();
  const { connections } = useDatabase();
  const location = useLocation();
  const { isActive, isConnecting, name, database, sshEnabled, error } = connection;
  // The rail indicator marks the current view: a connection "owns" it only in
  // the editor, otherwise it belongs to the active nav item (connections/mcp/settings)
  const isCurrentView = isActive && location.pathname === "/editor";
  const savedConnection = connections.find(c => c.id === connection.id);
  const driverColor = getConnectionAccent(savedConnection, driverManifest);
  const hasError = !!error;
  const canSplit = canActivateSplit(selectedConnectionIds);
  const { splitView, addConnectionToSplit } = useConnectionLayoutContext();
  const canJoinSplit = canAddToSplit(splitView, connection.id);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleClick = (e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      onToggleSelect(true);
    } else {
      onSwitch();
    }
  };

  const splitItems = canSplit
    ? [
        {
          label: t('sidebar.splitVertical'),
          icon: Columns2,
          action: () => onActivateSplit('vertical'),
        },
        {
          label: t('sidebar.splitHorizontal'),
          icon: Rows2,
          action: () => onActivateSplit('horizontal'),
        },
        { separator: true as const },
      ]
    : [];

  const joinSplitItems = canJoinSplit
    ? [
        {
          label: t('sidebar.addToSplitGroup'),
          icon: SquarePlus,
          action: () => addConnectionToSplit(connection.id),
        },
        { separator: true as const },
      ]
    : [];

  const menuItems = [
    ...splitItems,
    ...joinSplitItems,
    {
      label: t("sidebar.openInEditor"),
      icon: Terminal,
      action: onOpenInEditor,
    },
    {
      label: t("sidebar.openInNewWindow"),
      icon: AppWindow,
      action: onOpenInNewWindow,
    },
    {
      label: t("sidebar.setAsActive"),
      icon: Check,
      action: onSwitch,
      disabled: isActive,
    },
    { separator: true as const },
    {
      label: t("sidebar.copyName"),
      icon: Copy,
      action: () => navigator.clipboard.writeText(name),
    },
    { separator: true as const },
    {
      label: t("connections.disconnect"),
      icon: Power,
      action: onDisconnect,
      danger: true,
    },
  ];

  return (
    <>
      <div className="relative group w-full flex flex-col items-center mb-1">
        {/* Drop indicator - above */}
        {dropIndicator === 'above' && (
          <div className="absolute -top-0.5 left-2 right-2 h-0.5 bg-blue-400 rounded-full z-30" />
        )}

        <RailIndicator isActive={isCurrentView} />

        <button
          onClick={handleClick}
          onMouseDown={onMoveMouseDown}
          onContextMenu={handleContextMenu}
          className={`flex items-center justify-center w-12 h-12 rounded-lg transition-all relative ${
            isSelected
              ? 'ring-2 ring-blue-400 bg-blue-500/20 text-blue-400'
              : getConnectionItemClass(isActive)
          }`}
        >
          {isConnecting ? (
            <Loader2 size={20} className="animate-spin text-blue-400" />
          ) : (
            <div
              className="w-11 h-11 rounded-lg flex items-center justify-center text-white shadow-md"
              style={{ backgroundColor: driverColor }}
            >
              {getConnectionIcon(savedConnection, driverManifest, 20)}
            </div>
          )}

          {/* Status dot */}
          {!isConnecting && (
            <div
              className={`absolute bottom-1.5 right-1.5 w-2 h-2 rounded-full border border-elevated ${getStatusDotClass(isActive, hasError)}`}
            />
          )}

          {/* SSH badge */}
          {sshEnabled && !showShortcutHint && !connection.k8sEnabled && (
            <div className="absolute top-1 right-1">
              <Shield size={9} className="text-emerald-400 fill-emerald-400/20" />
            </div>
          )}

          {/* K8s badge */}
          {connection.k8sEnabled && !showShortcutHint && (
            <div className="absolute top-1 right-1">
              <Shield size={9} className="text-blue-400 fill-blue-400/20" />
            </div>
          )}

          {/* Shortcut hint badge */}
          {showShortcutHint && shortcutIndex !== undefined && (
            <div className="absolute -top-1 -left-1 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center text-white text-[9px] font-bold z-20 shadow-sm">
              {shortcutIndex}
            </div>
          )}

          {/* Error indicator */}
          {hasError && !isConnecting && (
            <div className="absolute -top-0.5 -left-0.5">
              <AlertCircle size={12} className="text-red-400" />
            </div>
          )}

          {/* Selection indicator */}
          {isSelected && (
            <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-blue-500 rounded-full flex items-center justify-center">
              <Check size={8} className="text-white" />
            </div>
          )}
        </button>

        {/* Disconnect button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDisconnect();
          }}
          className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-elevated border border-default rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-900/50 hover:text-red-400 text-muted z-10"
          title={t("connections.disconnect")}
        >
          <X size={8} />
        </button>

        {/* Tooltip */}
        <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-surface-secondary text-primary text-xs px-2 py-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-30 pointer-events-none shadow-lg border border-default">
          <div className="font-medium">{name}</div>
          <div className="text-muted text-[10px]">{database}</div>
          {isSelected && (
            <div className="text-blue-400 text-[10px] mt-0.5">Selected (Ctrl+click to deselect)</div>
          )}
          {hasError && <div className="text-red-400 text-[10px] mt-0.5 max-w-[180px] truncate">{error}</div>}
        </div>

        {/* Drop indicator - below */}
        {dropIndicator === 'below' && (
          <div className="absolute -bottom-0.5 left-2 right-2 h-0.5 bg-blue-400 rounded-full z-30" />
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
};
