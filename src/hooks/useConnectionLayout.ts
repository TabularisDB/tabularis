import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  addToSplit,
  canActivateSplit,
  layoutFromIds,
  makeSplitView,
  moveInSplit,
  removeFromLayout,
  resizeLayoutAt,
  swapInSplit,
} from '../utils/connectionLayout';
import type { SplitEdge, SplitMode, SplitView } from '../utils/connectionLayout';

export interface ConnectionLayoutState {
  selectedConnectionIds: Set<string>;
  splitView: SplitView | null;
  isSplitVisible: boolean;
  explorerConnectionId: string | null;
  toggleSelection: (id: string, isCtrlHeld: boolean) => void;
  activateSplit: (mode: SplitMode) => void;
  deactivateSplit: () => void;
  removeConnectionFromSplit: (id: string) => void;
  addConnectionToSplit: (id: string) => void;
  swapSplitConnections: (aId: string, bId: string) => void;
  moveSplitConnection: (draggedId: string, targetId: string, edge: SplitEdge) => void;
  resizeSplitNode: (path: number[], sizes: number[]) => void;
  showSplitView: () => void;
  hideSplitView: () => void;
  clearSelection: () => void;
  setExplorerConnectionId: (id: string | null) => void;
}

export function useConnectionLayout(): ConnectionLayoutState {
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<Set<string>>(new Set());
  const [splitView, setSplitView] = useState<SplitView | null>(null);
  const [isSplitVisible, setIsSplitVisible] = useState(false);
  const [explorerConnectionId, setExplorerConnectionId] = useState<string | null>(null);
  const navigate = useNavigate();

  const toggleSelection = useCallback((id: string, isCtrlHeld: boolean) => {
    if (!isCtrlHeld) {
      setSelectedConnectionIds(new Set());
      return;
    }
    setSelectedConnectionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const activateSplit = useCallback((mode: SplitMode) => {
    if (!canActivateSplit(selectedConnectionIds)) return;
    const view = makeSplitView(layoutFromIds(Array.from(selectedConnectionIds), mode));
    if (!view) return;
    setSplitView(view);
    setIsSplitVisible(true);
    setExplorerConnectionId(view.connectionIds[0]);
    setSelectedConnectionIds(new Set());
    navigate('/editor');
  }, [selectedConnectionIds, navigate]);

  const deactivateSplit = useCallback(() => {
    setSplitView(null);
    setIsSplitVisible(false);
    setExplorerConnectionId(null);
  }, []);

  const removeConnectionFromSplit = useCallback((connectionId: string) => {
    setSplitView(prev => {
      if (!prev) return null;
      const next = makeSplitView(removeFromLayout(prev.layout, connectionId));
      // A split needs at least two panels to stay alive
      if (!next || next.connectionIds.length < 2) {
        setIsSplitVisible(false);
        return null;
      }
      return next;
    });
    setExplorerConnectionId(prev => (prev === connectionId ? null : prev));
  }, []);

  const addConnectionToSplit = useCallback((connectionId: string) => {
    setSplitView(prev => (prev ? addToSplit(prev, connectionId) : prev));
  }, []);

  const swapSplitConnections = useCallback((aId: string, bId: string) => {
    setSplitView(prev => (prev ? swapInSplit(prev, aId, bId) : prev));
  }, []);

  const moveSplitConnection = useCallback((draggedId: string, targetId: string, edge: SplitEdge) => {
    setSplitView(prev => (prev ? moveInSplit(prev, draggedId, targetId, edge) : prev));
  }, []);

  const resizeSplitNode = useCallback((path: number[], sizes: number[]) => {
    setSplitView(prev =>
      prev ? (makeSplitView(resizeLayoutAt(prev.layout, path, sizes)) ?? prev) : prev,
    );
  }, []);

  const showSplitView = useCallback(() => {
    setIsSplitVisible(true);
  }, []);

  const hideSplitView = useCallback(() => {
    setIsSplitVisible(false);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedConnectionIds(new Set());
  }, []);

  return {
    selectedConnectionIds,
    splitView,
    isSplitVisible,
    explorerConnectionId,
    toggleSelection,
    activateSplit,
    deactivateSplit,
    removeConnectionFromSplit,
    addConnectionToSplit,
    swapSplitConnections,
    moveSplitConnection,
    resizeSplitNode,
    showSplitView,
    hideSplitView,
    clearSelection,
    setExplorerConnectionId,
  };
}
