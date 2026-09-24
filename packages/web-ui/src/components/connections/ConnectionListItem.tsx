import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { SavedConnection } from '../../contexts/DatabaseContext';
import type { PluginManifest } from '../../types/plugins';
import type { ConnectionTag } from '../../types/tags';
import { useDatabase } from '../../hooks/useDatabase';
import { getConnectionAccent, getConnectionIcon } from '../../utils/driverUI';
import { getCapabilitiesForDriver } from '../../utils/driverCapabilities';
import { connectionSubtitle, getCardClass, migrationDirectionForDriver } from '../../utils/connections';
import { StatusBadge } from './StatusBadge';
import { ActionButtons } from './ActionButtons';
import { ConnectionChips } from './ConnectionChips';
import { SelectionCheckbox } from './SelectionCheckbox';
import { onActivationKey } from '../../utils/keyboardEvents';

export interface ConnectionListItemProps {
  conn: SavedConnection;
  connectingId: string | null;
  allDrivers: PluginManifest[];
  enabledDrivers: PluginManifest[];
  /** All known connection tags, for resolving the row's tag chips. */
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

export const ConnectionListItem = ({
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
}: ConnectionListItemProps) => {
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
  const connectIfPossible = () => {
    if (isDriverEnabled && !isConnecting) onConnect();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={conn.name}
      aria-disabled={!isDriverEnabled || undefined}
      onDoubleClick={connectIfPossible}
      onKeyDown={onActivationKey(connectIfPossible)}
      onContextMenu={onContextMenu}
      onMouseDown={onMouseDown}
      className={clsx(
        'group flex items-center gap-3 px-3.5 py-2 rounded-xl border transition-all duration-150 cursor-pointer select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
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
        />
      )}
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 shadow-sm"
        style={{ backgroundColor: driverColor }}
      >
        {getConnectionIcon(conn, driverManifest, 14)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm text-primary truncate leading-snug">{conn.name}</p>
        <p className="text-[11px] text-muted truncate leading-snug mt-0.5">{subtitle}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <StatusBadge
          isActive={activeConnectionId === conn.id}
          isOpen={isOpen}
          isConnecting={isConnecting}
        />
        <ConnectionChips
          conn={conn}
          driverManifest={driverManifest}
          isDriverEnabled={isDriverEnabled}
          tags={tags}
        />
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
          migrationDirection={migrationDirection}
          onMigrate={onMigrate}
        />
      </div>
    </div>
  );
};
