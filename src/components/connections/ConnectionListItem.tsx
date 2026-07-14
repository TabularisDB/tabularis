import type { MouseEvent } from 'react';
import { Shield, PlugZap, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { SavedConnection } from '../../contexts/DatabaseContext';
import type { PluginManifest } from '../../types/plugins';
import { useDatabase } from '../../hooks/useDatabase';
import { getConnectionAccent, getConnectionIcon } from '../../utils/driverUI';
import { getCapabilitiesForDriver } from '../../utils/driverCapabilities';
import { connectionSubtitle, getCardClass } from '../../utils/connections';
import { StatusBadge } from './StatusBadge';
import { ActionButtons } from './ActionButtons';

export interface ConnectionListItemProps {
  conn: SavedConnection;
  connectingId: string | null;
  allDrivers: PluginManifest[];
  enabledDrivers: PluginManifest[];
  onConnect: () => void;
  onDisconnect: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onContextMenu: (e: MouseEvent<HTMLDivElement>) => void;
  onMouseDown?: (e: MouseEvent<HTMLDivElement>) => void;
  /** Whether this connection is checked in multi-select mode. */
  selected?: boolean;
  /** Whether any connection is currently selected (keeps checkboxes visible). */
  selectionActive?: boolean;
  /** Toggles this connection's selection. Enables the checkbox when provided. */
  onToggleSelect?: () => void;
}

export const ConnectionListItem = ({
  conn,
  connectingId,
  allDrivers,
  enabledDrivers,
  onConnect,
  onDisconnect,
  onEdit,
  onDuplicate,
  onDelete,
  onContextMenu,
  onMouseDown,
  selected = false,
  selectionActive = false,
  onToggleSelect,
}: ConnectionListItemProps) => {
  const { t } = useTranslation();
  const { activeConnectionId, isConnectionOpenAnywhere } = useDatabase();

  // Reflect connection status across all windows (open here or in another window).
  const isOpen = isConnectionOpenAnywhere(conn.id);
  const isConnecting = connectingId === conn.id;
  const isDriverEnabled = enabledDrivers.some(d => d.id === conn.params.driver);
  const driverManifest = allDrivers.find(d => d.id === conn.params.driver);
  const capabilities = getCapabilitiesForDriver(conn.params.driver, allDrivers);
  const subtitle = connectionSubtitle(conn, capabilities);
  const driverColor = getConnectionAccent(conn, driverManifest);

  return (
    <div
      onDoubleClick={() => isDriverEnabled && !isConnecting && onConnect()}
      onContextMenu={onContextMenu}
      onMouseDown={onMouseDown}
      className={clsx(
        'group flex items-center gap-3 px-3.5 py-2 rounded-xl border transition-all duration-150 cursor-pointer select-none',
        !isDriverEnabled && 'opacity-60 cursor-not-allowed',
        isConnecting && 'pointer-events-none',
        selected && 'ring-2 ring-blue-500/70',
        getCardClass(conn.id, activeConnectionId, isConnectionOpenAnywhere),
      )}
    >
      {onToggleSelect && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          aria-pressed={selected}
          className={clsx(
            'w-5 h-5 shrink-0 rounded-md border flex items-center justify-center transition-all duration-150',
            selected
              ? 'bg-blue-600 border-blue-500 text-white opacity-100'
              : clsx(
                  'bg-elevated/90 border-strong text-transparent hover:border-blue-400',
                  selectionActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                ),
          )}
        >
          <Check size={12} />
        </button>
      )}
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 shadow-sm"
        style={{ backgroundColor: driverColor }}
      >
        {getConnectionIcon(conn, driverManifest, 14)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-primary truncate leading-snug">{conn.name}</p>
        <p className="text-[11px] text-muted truncate leading-snug mt-0.5">{subtitle}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <StatusBadge
          isActive={activeConnectionId === conn.id}
          isOpen={isOpen}
          isConnecting={isConnecting}
        />
        <span className="text-[10px] font-semibold text-secondary bg-surface-secondary border border-strong/40 px-1.5 py-0.5 rounded-md capitalize">
          {conn.params.driver}
        </span>
        {conn.params.ssh_enabled && (
          <span className="flex items-center gap-0.5 text-[10px] font-bold text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-1.5 py-0.5 rounded-md">
            <Shield size={8} /> SSH
          </span>
        )}
        {conn.params.k8s_enabled && (
          <span className="flex items-center gap-0.5 text-[10px] font-bold text-blue-400 bg-blue-400/10 border border-blue-400/20 px-1.5 py-0.5 rounded-md">
            <Shield size={8} /> K8s
          </span>
        )}
        {!isDriverEnabled && (
          <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded-md">
            <PlugZap size={8} /> {t('connections.pluginDisabled')}
          </span>
        )}
      </div>
      <div className="flex items-center gap-0.5 shrink-0 pl-1 border-l border-default/50">
        <ActionButtons
          conn={conn}
          isOpen={isOpen}
          isDriverEnabled={isDriverEnabled}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
};
