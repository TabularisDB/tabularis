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

export interface ConnectionCardProps {
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

export const ConnectionCard = ({
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
}: ConnectionCardProps) => {
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
        'group relative flex flex-col rounded-2xl border transition-all duration-150 cursor-pointer select-none overflow-hidden',
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
            'absolute top-2.5 left-2.5 z-10 w-5 h-5 rounded-md border flex items-center justify-center transition-all duration-150',
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
      <div className="flex items-start gap-3.5 px-4 pt-4 pb-3">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center text-white shrink-0 shadow-md"
          style={{ backgroundColor: driverColor }}
        >
          {getConnectionIcon(conn, driverManifest, 20)}
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <span className="font-bold text-sm text-primary leading-snug truncate">{conn.name}</span>
            <div className="shrink-0">
              <StatusBadge
                isActive={activeConnectionId === conn.id}
                isOpen={isOpen}
                isConnecting={isConnecting}
              />
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
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
          <p className="text-[11px] text-muted truncate">{subtitle}</p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-0.5 px-3 py-2 border-t border-default/50 mt-auto opacity-40 group-hover:opacity-100 transition-opacity duration-150">
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
