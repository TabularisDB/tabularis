import { useState } from 'react';
import {
  Loader2,
  Shield,
  X,
  AlertCircle,
  Terminal,
  Check,
  Copy,
  Power,
  Columns2,
  Rows2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { ConnectionStatus } from '../../../hooks/useConnectionManager';
import { canActivateSplit } from '../../../utils/connectionLayout';
import { ContextMenu } from '../../ui/ContextMenu';
import type { PluginManifest } from '../../../types/plugins';
import { getDriverIcon, getDriverColor } from '../../../utils/driverUI';

interface ConnectionRowProps {
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
  draggable?: boolean;
  onReorderDragStart?: (e: React.DragEvent) => void;
  onReorderDragOver?: (e: React.DragEvent) => void;
  onReorderDragLeave?: () => void;
  onReorderDrop?: (e: React.DragEvent) => void;
  onReorderDragEnd?: () => void;
  dropIndicator?: 'above' | 'below' | null;
}

export const ConnectionRow = ({
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
  draggable: isDraggable = false,
  onReorderDragStart,
  onReorderDragOver,
  onReorderDragLeave,
  onReorderDrop,
  onReorderDragEnd,
  dropIndicator = null,
}: ConnectionRowProps) => {
  const { t } = useTranslation();
  const { isActive, isConnecting, name, database, sshEnabled, error } =
    connection;
  const driverColor = getDriverColor(driverManifest);
  const hasError = !!error;
  const canSplit = canActivateSplit(selectedConnectionIds);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

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
      label: t('sidebar.openInEditor'),
      icon: Terminal,
      action: onOpenInEditor,
    },
    {
      label: t('sidebar.setAsActive'),
      icon: Check,
      action: onSwitch,
      disabled: isActive,
    },
    { separator: true as const },
    {
      label: t('sidebar.copyName'),
      icon: Copy,
      action: () => navigator.clipboard.writeText(name),
    },
    { separator: true as const },
    {
      label: t('connections.disconnect'),
      icon: Power,
      action: onDisconnect,
      danger: true,
    },
  ];

  return (
    <>
      <div
        className="relative group"
        draggable={isDraggable}
        onDragStart={onReorderDragStart}
        onDragOver={onReorderDragOver}
        onDragLeave={onReorderDragLeave}
        onDrop={onReorderDrop}
        onDragEnd={onReorderDragEnd}
      >
        {dropIndicator === 'above' && (
          <div className="absolute -top-px left-1 right-1 h-0.5 bg-accent-primary rounded-full z-30" />
        )}

        <button
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          className={clsx(
            'w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-all text-left relative',
            isSelected
              ? 'ring-1 ring-accent-primary bg-accent-primary/10 text-accent-primary'
              : isActive
                ? 'bg-surface-hover text-primary'
                : 'text-secondary hover:bg-surface-hover hover:text-primary',
          )}
        >
          {/* Driver icon badge */}
          <div className="relative shrink-0">
            {isConnecting ? (
              <div className="w-5 h-5 rounded flex items-center justify-center">
                <Loader2 size={14} className="animate-spin text-accent-primary" />
              </div>
            ) : (
              <div
                className="w-5 h-5 rounded flex items-center justify-center text-white shadow-sm"
                style={{ backgroundColor: driverColor }}
              >
                {getDriverIcon(driverManifest, 12)}
              </div>
            )}

            {/* Status / error dot */}
            {!isConnecting && (
              <span
                className={clsx(
                  'absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-elevated',
                  hasError
                    ? 'bg-accent-error'
                    : isActive
                      ? 'bg-accent-success'
                      : 'bg-accent-success/60',
                )}
              />
            )}
          </div>

          {/* Name + database */}
          <div className="flex-1 min-w-0 flex flex-col">
            <span className="text-xs font-medium truncate leading-tight">
              {name}
            </span>
            {database && (
              <span className="text-[10px] text-muted truncate leading-tight">
                {database}
              </span>
            )}
          </div>

          {/* Right indicators */}
          <div className="flex items-center gap-1 shrink-0">
            {sshEnabled && (
              <Shield
                size={11}
                className="text-emerald-400"
                aria-label="SSH"
              />
            )}
            {hasError && (
              <AlertCircle size={11} className="text-accent-error" />
            )}
            {showShortcutHint && shortcutIndex !== undefined && (
              <span className="bg-accent-primary text-inverse text-[9px] font-bold px-1 rounded">
                {shortcutIndex}
              </span>
            )}
            {isSelected && (
              <Check size={11} className="text-accent-primary" />
            )}
          </div>

          {/* Disconnect button (visible on hover) */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDisconnect();
            }}
            className="ml-1 p-0.5 rounded text-muted hover:text-accent-error hover:bg-surface-secondary opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            title={t('connections.disconnect')}
          >
            <X size={11} />
          </button>
        </button>

        {dropIndicator === 'below' && (
          <div className="absolute -bottom-px left-1 right-1 h-0.5 bg-accent-primary rounded-full z-30" />
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
