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
    }),
    [navigate, openEditor],
  );

  const scope = useMemo<CommandScope>(
    () => ({
      connectionId: activeConnectionId,
      driver: activeDriver,
      table,
      getEditorCommands,
      getResultCommands,
      runtime,
    }),
    [
      activeConnectionId,
      activeDriver,
      getEditorCommands,
      getResultCommands,
      runtime,
      table,
    ],
  );

  useRegisterCommandPaletteScope(scopeId, scope);
  return null;
};
