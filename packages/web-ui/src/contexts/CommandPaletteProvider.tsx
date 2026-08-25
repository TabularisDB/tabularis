import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";

import {
  CommandPaletteDispatchContext,
  CommandPaletteStateContext,
} from "./CommandPaletteContext";
import { CommandPaletteScopeContext } from "./CommandPaletteScopeContext";
import { useConnectionLayoutContext } from "../hooks/useConnectionLayoutContext";
import {
  createCommandScopeStore,
  getActiveCommandScopeId,
} from "../utils/commandScopeStore";
import { resolveRenderedSplitLayout } from "../utils/connectionLayout";
import type { CommandPaletteMode } from "../types/commands";

interface CommandPaletteProviderProps {
  children: ReactNode;
}

export const CommandPaletteProvider = ({
  children,
}: CommandPaletteProviderProps) => {
  const {
    explorerConnectionId,
    isSplitVisible,
    splitView,
  } = useConnectionLayoutContext();
  const location = useLocation();
  const [scopeStore] = useState(createCommandScopeStore);

  const [activePalette, setActivePalette] =
    useState<CommandPaletteMode | null>(null);
  const activePaletteRef = useRef<CommandPaletteMode | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const activeScopeId = getActiveCommandScopeId({
    explorerConnectionId,
    isSplitRendered: !!resolveRenderedSplitLayout({
      splitView,
      isSplitVisible,
      pathname: location.pathname,
    }),
  });

  const openPalette = useCallback((nextMode: CommandPaletteMode) => {
    const activeScope = scopeStore.getScope(activeScopeId);
    if (
      nextMode === "objects" &&
      !activeScope?.connectionId
    ) {
      return;
    }
    if (
      !previousFocusRef.current &&
      document.activeElement instanceof HTMLElement
    ) {
      previousFocusRef.current = document.activeElement;
    }
    activePaletteRef.current = nextMode;
    setActivePalette(nextMode);
  }, [activeScopeId, scopeStore]);

  const closePalette = useCallback(() => {
    const previousFocus = previousFocusRef.current;
    activePaletteRef.current = null;
    previousFocusRef.current = null;
    setActivePalette(null);
    window.requestAnimationFrame(() => previousFocus?.focus());
  }, []);

  const togglePalette = useCallback(
    (nextMode: CommandPaletteMode) => {
      if (activePaletteRef.current === nextMode) {
        closePalette();
      } else {
        openPalette(nextMode);
      }
    },
    [closePalette, openPalette],
  );

  const stateValue = useMemo(
    () => ({
      activePalette,
    }),
    [activePalette],
  );

  const dispatchValue = useMemo(
    () => ({
      openPalette,
      closePalette,
      togglePalette,
    }),
    [closePalette, openPalette, togglePalette],
  );
  const scopeValue = useMemo(
    () => ({
      activeScopeId,
      store: scopeStore,
    }),
    [activeScopeId, scopeStore],
  );

  return (
    <CommandPaletteDispatchContext.Provider value={dispatchValue}>
      <CommandPaletteStateContext.Provider value={stateValue}>
        <CommandPaletteScopeContext.Provider value={scopeValue}>
          {children}
        </CommandPaletteScopeContext.Provider>
      </CommandPaletteStateContext.Provider>
    </CommandPaletteDispatchContext.Provider>
  );
};
