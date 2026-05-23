import type { SavedConnection, ConnectionData } from '../contexts/DatabaseContext';

export interface ConnectionStatus {
  id: string;
  name: string;
  driver: string;
  database: string;
  host?: string;
  sshEnabled: boolean;
  k8sEnabled: boolean;
  isOpen: boolean;
  isActive: boolean;
  isConnecting: boolean;
  isConnected: boolean;
  error?: string;
}

/** Build a ConnectionStatus from raw connection data */
export function buildConnectionStatus(
  conn: SavedConnection,
  isOpen: boolean,
  isActive: boolean,
  data: ConnectionData | undefined,
): ConnectionStatus {
  return {
    id: conn.id,
    name: conn.name,
    driver: conn.params.driver,
    database: Array.isArray(conn.params.database) ? conn.params.database[0] : conn.params.database,
    host: conn.params.host,
    sshEnabled: conn.params.ssh_enabled ?? false,
    k8sEnabled: conn.params.k8s_enabled ?? false,
    isOpen,
    isActive,
    isConnecting: data?.isConnecting ?? false,
    isConnected: data?.isConnected ?? false,
    error: data?.error,
  };
}

/** Split connections into open and closed */
export function partitionConnections(connections: ConnectionStatus[]): {
  openConnections: ConnectionStatus[];
  closedConnections: ConnectionStatus[];
} {
  return {
    openConnections: connections.filter((c) => c.isOpen),
    closedConnections: connections.filter((c) => !c.isOpen),
  };
}

/** CSS class for the connection button in the narrow sidebar */
export function getConnectionItemClass(isActive: boolean): string {
  return isActive
    ? 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/40'
    : 'text-secondary hover:bg-surface-secondary hover:text-primary';
}

/** CSS class for the status dot inside the connection button */
export function getStatusDotClass(isActive: boolean, hasError: boolean): string {
  if (hasError) return 'bg-red-400';
  return isActive ? 'bg-green-400' : 'bg-green-400/70';
}

/**
 * Returns the IDs of open connections whose driver matches any of the given driver IDs.
 * Used when disabling or uninstalling a plugin to determine which connections must be closed.
 */
export function findConnectionsForDrivers(
  openConnectionIds: string[],
  connectionDataMap: Record<string, { driver: string } | undefined>,
  driverIds: string[],
): string[] {
  return openConnectionIds.filter(id => {
    const driver = connectionDataMap[id]?.driver;
    return driver !== undefined && driverIds.includes(driver);
  });
}
