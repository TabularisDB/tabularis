import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useDatabase } from "../../hooks/useDatabase";
import { useEditor } from "../../hooks/useEditor";
import { useRegisterCommandPaletteScope } from "../../hooks/useCommandPaletteScope";
import { resolveCommandTable } from "../../utils/commandTable";
import { openEditor as navigateToEditor } from "../../utils/editorNavigation";
import type {
  CommandRuntime,
  CommandScope,
} from "../../types/commands";

interface CommandPaletteScopeBridgeProps {
  scopeId: string;
  openEditor?: CommandRuntime["openEditor"];
  getEditorCommands?: CommandScope["getEditorCommands"];
  getResultCommands?: CommandScope["getResultCommands"];
}

export const CommandPaletteScopeBridge = ({
  scopeId,
  openEditor,
  getEditorCommands,
  getResultCommands,
}: CommandPaletteScopeBridgeProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    activeConnectionId,
    activeDriver,
    activeSchema,
    connections: availableConnections,
    openConnectionIds,
    switchConnection: switchActiveConnection,
  } = useDatabase();
  const { activeTab } = useEditor();
  const activeTable = activeTab?.activeTable ?? null;
  const activeTabSchema = activeTab?.schema;
  const activeTabType = activeTab?.type;

  const table = useMemo(
    () =>
      resolveCommandTable({
        pathname: location.pathname,
        activeConnectionId,
        activeSchema,
        activeTab: activeTabType
          ? {
              type: activeTabType,
              activeTable,
              schema: activeTabSchema,
            }
          : null,
      }),
    [
      activeConnectionId,
      activeSchema,
      activeTable,
      activeTabSchema,
      activeTabType,
      location.pathname,
    ],
  );

  const runtime = useMemo<CommandRuntime>(
    () => ({
      navigate: (path) => navigate(path),
      openEditor:
        openEditor ??
        ((request) => navigateToEditor(navigate, request)),
      switchConnection: (connectionId) => {
        switchActiveConnection(connectionId);
        navigate("/editor");
      },
    }),
    [navigate, openEditor, switchActiveConnection],
  );

  const commandConnections = useMemo(
    () =>
      availableConnections
        .filter((connection) => openConnectionIds.includes(connection.id))
        .map((connection) => ({
          id: connection.id,
          name: connection.name,
          driver: connection.params.driver,
          database: Array.isArray(connection.params.database)
            ? (connection.params.database[0] ?? "")
            : connection.params.database,
          ...(connection.params.host ? { host: connection.params.host } : {}),
        })),
    [availableConnections, openConnectionIds],
  );

  const scope = useMemo<CommandScope>(
    () => ({
      connectionId: activeConnectionId,
      connections: commandConnections,
      driver: activeDriver,
      table,
      getEditorCommands,
      getResultCommands,
      runtime,
    }),
    [
      activeConnectionId,
      activeDriver,
      commandConnections,
      getEditorCommands,
      getResultCommands,
      runtime,
      table,
    ],
  );

  useRegisterCommandPaletteScope(scopeId, scope);
  return null;
};
