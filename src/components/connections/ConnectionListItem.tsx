import type { MouseEvent } from 'react';
import { Shield, PlugZap } from 'lucide-react';
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
}: ConnectionListItemProps) => {
  const { t } = useTranslation();
  const { activeConnectionId, isConnectionOpen } = useDatabase();

  const isOpen = isConnectionOpen(conn.id);
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
        getCardClass(conn.id, activeConnectionId, isConnectionOpen),
      )}
    >
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
