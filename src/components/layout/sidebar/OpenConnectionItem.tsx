import { useState } from "react";
import { Loader2, Shield, X, AlertCircle, Terminal, Check, Copy, Power, Columns2, Rows2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ConnectionStatus } from "../../../hooks/useConnectionManager";
import { getConnectionItemClass, getStatusDotClass } from "../../../utils/connectionManager";
import { canActivateSplit } from "../../../utils/connectionLayout";
import { ContextMenu } from "../../ui/ContextMenu";
import type { PluginManifest } from "../../../types/plugins";
import { getDriverIcon, getDriverColor } from "../../../utils/driverUI";

interface Props {
  connection: ConnectionStatus;
  driverManifest?: PluginManifest | null;
  isSelected: boolean;
  onSwitch: () => void;
  onOpenInEditor: () => void;
  onDisconnect: () => void;
  onToggleSelect: (isCtrlHeld: boolean) => void;
  selectedConnectionIds: Set<string>;
  onActivateSplit: (mode: 'vertical' | 'horizontal') => void;
  shortcutIndex?: number;
  showShortcutHint?: boolean;
  showLabel?: boolean;
  draggable?: boolean;
  onReorderDragStart?: (e: React.DragEvent) => void;
  onReorderDragOver?: (e: React.DragEvent) => void;
  onReorderDragLeave?: () => void;
  onReorderDrop?: (e: React.DragEvent) => void;
  onReorderDragEnd?: () => void;
  dropIndicator?: 'above' | 'below' | null;
}

export const OpenConnectionItem = ({
  connection,
  driverManifest,
  isSelected,
  onSwitch,
  onOpenInEditor,
  onDisconnect,
  onToggleSelect,
  selectedConnectionIds,
  onActivateSplit,
  shortcutIndex,
  showShortcutHint = false,
  showLabel = false,
  draggable: isDraggable = false,
  onReorderDragStart,
  onReorderDragOver,
  onReorderDragLeave,
  onReorderDrop,
  onReorderDragEnd,
  dropIndicator = null,
}: Props) => {
  const { t } = useTranslation();
  const { isActive, isConnecting, name, database, sshEnabled, error } = connection;
  const driverColor = getDriverColor(driverManifest);
  const hasError = !!error;
  const canSplit = canActivateSplit(selectedConnectionIds);

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

  const menuItems = [
    ...splitItems,
    {
      label: t("sidebar.openInEditor"),
      icon: Terminal,
      action: onOpenInEditor,
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
      <div
        className={`relative group w-full flex flex-col items-center ${showLabel ? 'mb-0.5' : 'mb-1'}`}
        draggable={isDraggable}
        onDragStart={onReorderDragStart}
        onDragOver={onReorderDragOver}
        onDragLeave={onReorderDragLeave}
        onDrop={onReorderDrop}
        onDragEnd={onReorderDragEnd}
      >
        {/* Drop indicator - above */}
        {dropIndicator === 'above' && (
          <div className="absolute -top-0.5 left-2 right-2 h-0.5 bg-blue-400 rounded-full z-30" />
        )}

        <button
          onClick={handleClick}
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
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-md"
              style={{ backgroundColor: driverColor }}
            >
              {getDriverIcon(driverManifest, 16)}
            </div>
          )}

          {/* Status dot */}
          {!isConnecting && (
            <div
              className={`absolute bottom-1.5 right-1.5 w-2 h-2 rounded-full border border-elevated ${getStatusDotClass(isActive, hasError)}`}
            />
          )}

          {/* SSH badge */}
          {sshEnabled && !showShortcutHint && (
            <div className="absolute top-1 right-1">
              <Shield size={9} className="text-emerald-400 fill-emerald-400/20" />
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

        {/* Connection name label */}
        {showLabel && (
          <span className="text-[9px] text-muted leading-tight max-w-[56px] truncate text-center select-none mt-0.5">
            {name}
          </span>
        )}

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
