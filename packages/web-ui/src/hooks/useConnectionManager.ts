import { useState, useCallback, useEffect } from 'react';
import { useDatabase } from './useDatabase';
import { buildConnectionStatus, partitionConnections } from '../utils/connectionManager';
import { toErrorMessage } from '../utils/errors';

export type { ConnectionStatus } from '../utils/connectionManager';

export function useConnectionManager() {
  const {
    connections,
    loadConnections,
    connectionDataMap,
    activeConnectionId,
    connect,
    disconnect,
    switchConnection,
    isConnectionOpen,
  } = useDatabase();

  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (connections.length === 0) {
      loadConnections();
    }
  }, [connections.length, loadConnections]);

  const allConnectionStatuses = connections.map((conn) =>
    buildConnectionStatus(
      conn,
      isConnectionOpen(conn.id),
      activeConnectionId === conn.id,
      connectionDataMap[conn.id],
    ),
  );

  const { openConnections, closedConnections } = partitionConnections(allConnectionStatuses);

  const handleConnect = useCallback(async (connectionId: string) => {
    setError(null);
    setConnectingId(connectionId);
    try {
      await connect(connectionId);
    } catch (e) {
      const errorMsg = toErrorMessage(e);
      setError(errorMsg);
      throw e;
    } finally {
      setConnectingId(null);
    }
  }, [connect]);

  const handleDisconnect = useCallback(async (connectionId: string) => {
    setError(null);
    try {
      await disconnect(connectionId);
    } catch (e) {
      const errorMsg = toErrorMessage(e);
      setError(errorMsg);
      throw e;
    }
  }, [disconnect]);

  const handleSwitch = useCallback((connectionId: string) => {
    if (isConnectionOpen(connectionId)) {
      switchConnection(connectionId);
    }
  }, [switchConnection, isConnectionOpen]);

  const handleToggle = useCallback(async (connectionId: string) => {
    if (isConnectionOpen(connectionId)) {
      if (activeConnectionId === connectionId) {
        await handleDisconnect(connectionId);
      } else {
        switchConnection(connectionId);
      }
    } else {
      await handleConnect(connectionId);
    }
  }, [isConnectionOpen, activeConnectionId, handleConnect, handleDisconnect, switchConnection]);

  return {
    connections: allConnectionStatuses,
    openConnections,
    closedConnections,
    activeConnectionId,
    connectingId,
    isConnecting: connectingId !== null,
    error,
    handleConnect,
    handleDisconnect,
    handleSwitch,
    handleToggle,
    loadConnections,
    clearError: () => setError(null),
  };
}
