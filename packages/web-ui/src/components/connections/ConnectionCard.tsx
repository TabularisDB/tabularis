import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { SavedConnection } from '../../contexts/DatabaseContext';
import type { PluginManifest } from '../../types/plugins';
import type { ConnectionTag } from '../../types/tags';
import { useDatabase } from '../../hooks/useDatabase';
import { CompactCard, CompactCardHeader, CompactCardFooter } from '../ui/CompactCard';
import { getConnectionAccent, getConnectionIcon } from '../../utils/driverUI';
import { getCapabilitiesForDriver } from '../../utils/driverCapabilities';
import { connectionSubtitle, getCardClass, migrationDirectionForDriver } from '../../utils/connections';
import { StatusBadge } from './StatusBadge';
import { ActionButtons } from './ActionButtons';
import { ConnectionChips } from './ConnectionChips';
import { SelectionCheckbox } from './SelectionCheckbox';

export interface ConnectionCardProps {
  conn: SavedConnection;
  connectingId: string | null;
  allDrivers: PluginManifest[];
  enabledDrivers: PluginManifest[];
  /** All known connection tags, for resolving the card's tag chips. */
  tags?: ConnectionTag[];
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
  /** Called when the migration button is clicked; omitted outside the migration window. */
  onMigrate?: () => void;
}

export const ConnectionCard = ({
  conn,
  connectingId,
  allDrivers,
  enabledDrivers,
  tags = [],
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
  onMigrate,
}: ConnectionCardProps) => {
  const { t } = useTranslation();
  const { activeConnectionId, isConnectionOpenAnywhere } = useDatabase();

  // Reflect connection status across all windows (open here or in another window).
  const isOpen = isConnectionOpenAnywhere(conn.id);
  const isConnecting = connectingId === conn.id;
  const isDriverEnabled = enabledDrivers.some(d => d.id === conn.params.driver);
  const driverManifest = allDrivers.find(d => d.id === conn.params.driver);
  const capabilities = getCapabilitiesForDriver(conn.params.driver, allDrivers);
  const subtitle = connectionSubtitle(conn, capabilities, {
    allDatabases: t("newConnection.allDatabases"),
    databaseCount: (count) =>
      t("connections.databaseCount", { count, defaultValue: "{{count}} databases" }),
  });
  const driverColor = getConnectionAccent(conn, driverManifest);
  const migrationDirection = migrationDirectionForDriver(conn.params.driver, allDrivers);

  return (
    <CompactCard
      onDoubleClick={() => isDriverEnabled && !isConnecting && onConnect()}
      onContextMenu={onContextMenu}
      onMouseDown={onMouseDown}
      className={clsx(
        'cursor-pointer select-none',
        !isDriverEnabled && 'opacity-60 cursor-not-allowed',
        isConnecting && 'pointer-events-none',
        selected && 'ring-2 ring-accent-primary/70',
        getCardClass(conn.id, activeConnectionId, isConnectionOpenAnywhere),
      )}
    >
      {onToggleSelect && (
        <SelectionCheckbox
          selected={selected}
          selectionActive={selectionActive}
          onToggle={onToggleSelect}
          className="absolute top-2.5 left-2.5 z-10"
        />
      )}
      <CompactCardHeader
        icon={getConnectionIcon(conn, driverManifest, 20)}
        iconColor={driverColor}
      >
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
          <ConnectionChips
            conn={conn}
            driverManifest={driverManifest}
            isDriverEnabled={isDriverEnabled}
            tags={tags}
          />
        </div>
        <p className="text-[11px] text-muted truncate">{subtitle}</p>
      </CompactCardHeader>
      <CompactCardFooter className="gap-0.5 opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150">
        <ActionButtons
          conn={conn}
          isOpen={isOpen}
          isDriverEnabled={isDriverEnabled}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          migrationDirection={migrationDirection}
          onMigrate={onMigrate}
        />
      </CompactCardFooter>
    </CompactCard>
  );
};
